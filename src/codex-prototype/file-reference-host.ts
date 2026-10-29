import {lstat,realpath,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import {basename,relative,sep} from 'node:path';
import {assertWorkspaceFiles,ownedPath} from './storage';
import {ATTACHMENT_BYTES} from './attachment-policy';
import {linkSearchPattern,rankLinkCandidate} from '../file-path';
import {fileReference,fileHref,fileReferenceId,textFileReferences,validReferencePath,type FileReference,type ReferenceItem} from './file-reference';
import {IMAGE_SOURCE_BYTES,imageSourceMime,sourceImage} from './image-formats';
import type {ReferenceImageSource} from './reference-image';
// This is the existing bundled parser's narrow public API; no untyped ambient module or new dependency.
type InlineReferenceToken={type:string;content:string;attrGet:(name:string)=>string|null};
const MarkdownIt:new(options:{html:boolean;linkify:boolean;breaks:boolean})=>{inline:{ruler:{disable:(rules:string[])=>void}};parse:(text:string,environment:object)=>{type:string;children?:InlineReferenceToken[]|null}[]}=require('markdown-it');
const referenceMarkdown=new MarkdownIt({html:false,linkify:true,breaks:false});referenceMarkdown.inline.ruler.disable(['escape']);
/** Same Markdown lexer/options as the display vendor, never regex-match arbitrary hidden href text. */
export function itemFileReferences(item:ReferenceItem):Map<string,FileReference>{
 const out=new Map<string,FileReference>(),add=(reference:FileReference|undefined)=>{if(reference)out.set(fileReferenceId(reference),reference);};
 if((item.type==='agentMessage'||item.type==='plan')&&typeof item.text==='string'){
  for(const token of referenceMarkdown.parse(item.text,{})){if(token.type!=='inline')continue;let linked=false;for(const child of token.children??[]){
   if(child.type==='link_open'){linked=true;add(fileHref(child.attrGet('href')));}else if(child.type==='link_close')linked=false;
   else if(!linked&&child.type==='code_inline')add(fileReference(child.content));else if(!linked&&child.type==='text')for(const match of textFileReferences(child.content))add(match.reference);
  }}
 }else if(item.type==='commandExecution'&&typeof item.aggregatedOutput==='string'){
  for(const match of textFileReferences(item.aggregatedOutput))add(match.reference);
 }else if(item.type==='fileChange'&&Array.isArray(item.changes))for(const change of item.changes){
  if(!change||typeof change!=='object')continue;const path=(change as any).path,kind=(change as any).kind;
  if(validReferencePath(path))add({path});if(kind?.type==='update'&&validReferencePath(kind.move_path))add({path:kind.move_path});
 }return out;
}
export type FileReferenceOwner={threadId:string;connectionId:number;items:{turnId:string;item:ReferenceItem}[]};
export type FileReferenceRequest={type:'file-reference-open';id:number;threadId:string;connectionId:number;turnId:string;itemId:string;referenceId:string};
export type OpenReferencedText=(path:string,current:()=>Promise<void>,line?:number)=>Promise<void>;
export type OpenReferencedFile=(path:string,current:()=>Promise<void>)=>Promise<void>;
const TEXT_FILE=/\.(md|txt|csv|json|yml|yaml|css|html|xml|js|ts|py|log|rs|go|java|c|cpp|h|ini)$/i;
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const safePart=(part:string)=>!/^\.codex-/i.test(part)&&!/^\.git$/i.test(part)&&!(/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part));
/** Public reference identity is checked before and after every await; images remain read-only snapshots. */
export class FileReferenceHost {
 private latest=0;
 constructor(private root:string,private owner:()=>FileReferenceOwner|undefined,private active:()=>boolean,private openText:OpenReferencedText,private find:(pattern:string)=>PromiseLike<readonly string[]> =async()=>[],private openFile?:OpenReferencedFile){}
 async handle(m:any,post:(reply:object)=>unknown):Promise<boolean>{
  if(m?.type!=='file-reference-open')return false;
  if(!this.active()||!Number.isSafeInteger(m.id)||m.id<1||m.id<=this.latest)return true;
  const id=this.latest=m.id,expires=Date.now()+15000;let deliveryAttempted=false,canonicalRoot='';
  const live=()=>{const owner=this.owner();return this.active()&&id===this.latest&&!!owner&&owner.threadId===m.threadId&&owner.connectionId===m.connectionId;};
  const source=()=>{
   if(!live()||Date.now()>expires||!Number.isSafeInteger(m.connectionId)||typeof m.turnId!=='string'||!m.turnId||m.turnId.length>256||typeof m.itemId!=='string'||!m.itemId||m.itemId.length>256||typeof m.referenceId!=='string'||m.referenceId.length>8300)throw Error('文件引用的页面、线程或请求身份已失效');
   const rows=this.owner()!.items.filter(row=>row.turnId===m.turnId&&row.item.id===m.itemId);if(rows.length!==1)throw Error('文件引用消息已缺失或不唯一');
   const reference=itemFileReferences(rows[0]!.item).get(m.referenceId);if(!reference)throw Error('文件引用已改变或不属于此消息');return reference;
  };
  const safe=async(path:string)=>{if(!validReferencePath(path))throw Error('文件路径格式不支持');const target=await ownedPath(this.root,path);source();if(relative(this.root,target).split(/[\\/]/).some(part=>!safePart(part)))throw Error('内部存储或设备路径不允许从正文打开');try{const actual=await realpath(target);source();if(actual!==canonicalRoot&&!actual.startsWith(canonicalRoot+sep))throw Error('文件物理来源超出拥有的工作区');if(relative(canonicalRoot,actual).split(/[\\/]/).some(part=>!safePart(part)))throw Error('文件物理来源属于内部存储或设备路径，未打开');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return target;};
  try{
   const reference=source();await assertWorkspaceFiles(this.root);canonicalRoot=await realpath(this.root);source();let path=await safe(reference.path);
   try{await lstat(path);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const pattern=linkSearchPattern(reference.path);if(!pattern||/[\[\]{}!]/.test(reference.path))throw Error('引用文件不存在，未猜测其它来源');
    const matches=await this.find(pattern);source();if(matches.length>=30)throw Error('后缀查找结果达到上限，内容不完整；请使用完整的工作区相对路径');
    const candidates:string[]=[];for(const value of matches){const candidate=await safe(value);if(!candidates.includes(candidate))candidates.push(candidate);}
    candidates.sort((a,b)=>rankLinkCandidate(this.root,a)-rankLinkCandidate(this.root,b));
    if(candidates.length!==1)throw Error(candidates.length?'文件路径匹配多处；请使用完整的工作区相对路径，未自动猜选':'引用文件不存在；受控工作区后缀查找没有匹配');path=candidates[0]!;
   }
   const name=basename(path),imageMime=imageSourceMime(name),initial=await lstat(path,{bigint:true});source();
   if(!initial.isFile()||initial.isSymbolicLink()||initial.ino<=0n||initial.size<0n)throw Error('引用目标不是可核验的普通文件');
   const delegated=(!imageMime&&!TEXT_FILE.test(name)&&name.includes('.'))||!!imageMime&&initial.size>BigInt(IMAGE_SOURCE_BYTES),limit=imageMime?IMAGE_SOURCE_BYTES:ATTACHMENT_BYTES;
   if(!delegated&&initial.size>BigInt(limit))throw Error('引用文本超过5 MiB，未载入编辑器');
   const current=async()=>{source();const now=await lstat(await safe(path),{bigint:true});source();if(!now.isFile()||now.isSymbolicLink()||stamp(now)!==stamp(initial))throw Error('引用文件在打开期间已改变，未确认打开');};
   if(delegated){
    if(!this.openFile)throw Error('当前宿主未接入 VS Code 文件编辑器；超过25 MiB的图片、PDF及其它格式未打开');
    await current();await this.openFile(path,current);await current();
    if(live()){deliveryAttempted=true;await post({type:'file-reference-result',id,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,itemId:m.itemId,referenceId:m.referenceId,ok:true,result:'delegated'});}return true;
   }
   if(imageMime){
    await current();const handle=await open(path,'r');let image:ReferenceImageSource;
    try{source();if(stamp(await handle.stat({bigint:true}))!==stamp(initial))throw Error('图片引用句柄与当前文件身份不一致');await current();const bytes=Buffer.alloc(Math.min(Number(initial.size)+1,limit+1));let size=0;
     while(size<bytes.length){const result=await handle.read(bytes,size,bytes.length-size,size);source();if(!result.bytesRead)break;size+=result.bytesRead;}
     if(size!==Number(initial.size)||stamp(await handle.stat({bigint:true}))!==stamp(initial))throw Error('图片引用在读取期间已改变');await current();const content=bytes.subarray(0,size),info=sourceImage(name,content);image={name,mime:info.mime,size,sha256:createHash('sha256').update(content).digest('hex'),base64:content.toString('base64'),animated:info.animated};
    }finally{await handle.close();}await current();
    if(live()){deliveryAttempted=true;await post({type:'file-reference-result',id,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,itemId:m.itemId,referenceId:m.referenceId,ok:true,result:'image',image});}return true;
   }
   await current();await this.openText(path,current,reference.line);await current();
   if(live()){deliveryAttempted=true;await post({type:'file-reference-result',id,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,itemId:m.itemId,referenceId:m.referenceId,ok:true,result:'opened'});}
  }catch(error){if(!deliveryAttempted&&live())try{await post({type:'file-reference-result',id,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,itemId:m.itemId,referenceId:m.referenceId,ok:false,error:error instanceof Error?error.message:'文件引用打开失败'});}catch{/* Delivery unknown: never retry or invent a second outcome. */}}
  return true;
 }
}
