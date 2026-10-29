/** DSH file actions adapted to current saved drafts and the owned workspace. */
import {readFile,writeFile} from 'node:fs/promises';
import {extname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {draftFileId,type DraftFile} from './draft-store-types';
import {checkDraftFile} from './attachment-files';
import {assertWorkspaceFiles,ownedPath} from './storage';
import {fileDropScript} from '../system-clipboard';
import {runFormulaScript} from './formula-export-host';
import {exportCarriers} from './export-carriers';
import type {MessageFileSources} from './message-file-sources';import type {ThreadItem} from './protocol/v2/ThreadItem';

export type FileActionKind='open'|'name'|'path'|'copy'|'save';
export type FileActionRequest={type:'file-action';id:number;threadId:string;connectionId:number;fileId:string;kind:FileActionKind;source?:'draft'|'body';turnId?:string;itemId?:string};
export type FileActionOwner={threadId:string;connectionId:number;files:DraftFile[];source?:'draft'|'body';turnId?:string;itemId?:string};
export {EXPORT_CARRIER_CAP as FILE_EXPORT_CAP} from './export-carriers';
const TEXT_FILE=/\.(md|txt|csv|json|yml|yaml|css|html|xml|js|ts|py|log|rs|go|java|c|cpp|h)$/i;
export class InvalidDraftFile extends Error {readonly invalidFile=true;}
export function bodyFileOwner(owner:{threadId:string;connectionId:number;items:{turnId:string;item:ThreadItem}[]},sources:MessageFileSources,m:FileActionRequest):FileActionOwner|undefined{const row=owner.items.find(row=>row.turnId===m.turnId&&row.item.id===m.itemId);if(m.source!=='body'||!row||row.item.type!=='userMessage')return;const clientId=row.item.clientId;if(!clientId||owner.items.filter(value=>value.item.type==='userMessage'&&value.item.clientId===clientId).length!==1)return;const files=sources.lookup(owner.threadId,row.turnId,row.item);return{threadId:owner.threadId,connectionId:owner.connectionId,source:'body',turnId:row.turnId,itemId:row.item.id,files};}
export class FileActionHost {
 private busy=false;
 constructor(private root:string,private owner:(request:FileActionRequest)=>FileActionOwner|undefined,
  private chooseTarget:(name:string)=>Promise<string|undefined>,
  private writeText:(text:string)=>PromiseLike<void>,
  private openText:(path:string,current:()=>Promise<void>)=>Promise<void>,
  private native=runFormulaScript,
  private openFile?: (path:string,current:()=>Promise<void>)=>Promise<void>){}
 private current(m:FileActionRequest){
  const owner=this.owner(m),body=m.source==='body';
  if(!owner||!Number.isSafeInteger(m.id)||m.id<1||m.threadId!==owner.threadId||m.connectionId!==owner.connectionId||typeof m.fileId!=='string'||m.fileId.length>8300||!['open','name','path','copy','save'].includes(m.kind))throw Error('文件草稿身份已失效');
  if(body){if(owner.source!=='body'||typeof m.turnId!=='string'||!m.turnId||m.turnId.length>256||typeof m.itemId!=='string'||!m.itemId||m.itemId.length>256||owner.turnId!==m.turnId||owner.itemId!==m.itemId)throw Error('正文文件消息身份已失效');}
  else if(m.source!==undefined&&m.source!=='draft'||owner.source==='body'||m.turnId||m.itemId)throw Error('文件来源类型不匹配');
  const file=owner.files.find(v=>draftFileId(v)===m.fileId);
  if(!file)throw Error('文件附件已移除');return {...file};
 }
 async handle(m:FileActionRequest):Promise<'opened'|'copied'|'saved'|'canceled'>{
  const source=this.current(m);if(this.busy)throw Error('上一项文件操作尚未结束');this.busy=true;
  const identity=()=>{const now=this.current(m);if(now.name!==source.name||now.size!==source.size)throw Error('文件附件已改变');};
  const checked=async()=>{identity();try{await checkDraftFile(this.root,source);}catch{throw new InvalidDraftFile('附件缺失、内容已变化或不符合工作区限制；请移除后重新附加。');}identity();};
  try{
   await assertWorkspaceFiles(this.root);await checked();
   if(m.kind==='name'||m.kind==='path'){identity();await this.writeText(m.kind==='name'?source.name:source.path);identity();return 'copied';}
   if(m.kind==='open'){
    const open=TEXT_FILE.test(source.name)?this.openText:this.openFile;if(!open)throw Error('当前宿主未接入此格式的文件预览；原文件保留。');
    await open(source.path,checked);await checked();return 'opened';
   }
   const bytes=await readFile(source.path);identity();
   if(bytes.length!==source.size||createHash('sha256').update(bytes).digest('hex')!==source.sha256)throw new InvalidDraftFile('附件内容已变化，请重新附加。');
   if(m.kind==='save'){
    const target=await this.chooseTarget(source.name);if(!target)return 'canceled';await checked();
    const safe=await ownedPath(this.root,target),rel=relative(this.root,safe);
    if(rel.split(/[\\/]/)[0]!.toLowerCase().startsWith('.codex-')||extname(safe).toLowerCase()!==extname(source.name).toLowerCase())throw Error('请保存在当前工作区内，并保持原文件扩展名；不能覆盖附件存储。');
    identity();await writeFile(safe,bytes);identity();return 'saved';
   }
   return await exportCarriers(this.root).copy('file',source.name,bytes,checked,path=>this.native(fileDropScript([path])));
  }finally{
   this.busy=false;
  }
 }
}
