import {open,lstat} from 'node:fs/promises';
import {basename,relative} from 'node:path';
import type {BigIntStats} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertWorkspaceFiles,isInside,ownedPath} from './storage';
import {attachmentKind,ATTACHMENT_BYTES,importAttachment,checkDraftFile} from './attachment-files';
import type {DraftFile} from './draft-store-types';
import type {DisplayStateStorage} from './display-settings';
import type {EditorContextView,EditorSource} from './editor-context-types';

export const EDITOR_ATTACHMENT_KEY='codexPrototype.includeEditorFile.v1';
export type ActiveEditor={scheme:string;path:string;version:number;dirty:boolean};
type Owner={threadId:string;connectionId:number};
const stamp=(s:BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const ordinary=(s:BigIntStats)=>s.isFile()&&!s.isSymbolicLink()&&s.ino>0n&&s.size>0n&&s.size<=BigInt(ATTACHMENT_BYTES);

/** Saved disk snapshot, pinned to one ordinary-file handle before any bytes are read. */
export async function readEditorSnapshot(root:string,editor:ActiveEditor,current:()=>boolean){
 await assertWorkspaceFiles(root);
 if(editor.scheme!=='file'||editor.dirty||!isInside(root,editor.path)||!Number.isSafeInteger(editor.version)||!current())throw Error('活动文件未保存、来源或身份已改变');
 const name=basename(editor.path);if(attachmentKind(name)!=='file')throw Error('活动编辑器文件不是受支持的普通文件；图片请使用图片入口');
 const path=await ownedPath(root,editor.path),initial=await lstat(path,{bigint:true});
 if(!ordinary(initial))throw Error('活动文件不是可核验的非空普通文件，或超过5 MiB');
 const handle=await open(path,'r');
 try{
  const before=await handle.stat({bigint:true});
  if(!current()||!ordinary(before)||stamp(initial)!==stamp(before))throw Error('活动文件打开期间身份已改变，未读取');
  const bytes=Buffer.alloc(Number(before.size)+1);let size=0;
  while(size<bytes.length){if(!current())throw Error('活动文件所属页面或线程已改变');const part=await handle.read(bytes,size,bytes.length-size,size);if(!part.bytesRead)break;size+=part.bytesRead;}
  const after=await handle.stat({bigint:true}),pathAfter=await lstat(await ownedPath(root,path),{bigint:true});
  if(!current()||size!==Number(before.size)||!ordinary(pathAfter)||stamp(before)!==stamp(after)||stamp(before)!==stamp(pathAfter))throw Error('活动文件读取期间内容或身份已改变，未附加');
  return {name,base64:bytes.subarray(0,size).toString('base64'),editorSource:relative(root,path).replaceAll('\\','/')};
 }finally{await handle.close();}
}

/** Workspace preference and editor source checks. Never sends a turn or reads a webview path. */
export class EditorAttachmentHost{
 private enabled=false;private original:unknown;private writing:boolean|undefined;private saving=false;private blocked='';private signature='';private revision=0;
 constructor(private root:string,private storage:DisplayStateStorage,private editor:()=>ActiveEditor|undefined,private changed:()=>void=()=>{},private importFile:typeof importAttachment=importAttachment,private existing:(owner:Owner)=>DraftFile[]=()=>[]){
  const raw=storage.get<unknown>(EDITOR_ATTACHMENT_KEY,undefined);this.original=raw;
  if(raw!==undefined&&typeof raw!=='boolean')this.blocked='附带开关记录无法读取；原记录保留，请窗口Reload后核对';
  else this.enabled=raw===true;
 }
 private fresh(){const actual=this.storage.get<unknown>(EDITOR_ATTACHMENT_KEY,undefined);if(actual!==this.original&&!(this.saving&&actual===this.writing))this.blocked='附带开关记录已变化；未覆盖，请窗口Reload后核对';return !this.blocked;}
 private versioned(value:Omit<EditorContextView,'revision'>):EditorContextView{const signature=JSON.stringify(value);if(signature!==this.signature){this.signature=signature;this.revision++;}return{...value,revision:this.revision};}
 snapshot():EditorContextView{
  this.fresh();const base={enabled:this.blocked?null:this.enabled,saving:this.saving,reason:this.blocked};
  if(this.blocked)return this.versioned(base);
  if(this.saving)return this.versioned({...base,reason:'附带开关正在保存，尚未确认'});
  if(!this.enabled)return this.versioned({...base,reason:'自动附带已关闭；手动附件保留'});
  const e=this.editor();
  if(!e||e.scheme!=='file')return this.versioned({...base,reason:'没有活动的本地文本编辑器'});
  if(!isInside(this.root,e.path))return this.versioned({...base,reason:'活动文件不在本候选拥有的临时工作区，未读取'});
  if(e.dirty)return this.versioned({...base,reason:'活动文件有未保存改动；请先保存，现有附件仍是此前的磁盘快照'});
  if(!Number.isSafeInteger(e.version)||e.version<1)return this.versioned({...base,reason:'活动文件版本无法核对'});
  try{if(attachmentKind(basename(e.path))!=='file')throw Error();}catch{return this.versioned({...base,reason:'此活动文件类型未接入；请使用现有附件入口'});}
  const path=relative(this.root,e.path).replaceAll('\\','/'),source:EditorSource={key:JSON.stringify([path,e.version]),path,name:basename(e.path),version:e.version};
  return this.versioned({...base,reason:'活动文件候选；导入前核验物理来源，只附带已保存磁盘副本并自动替换一个槽',source});
 }
 private async setEnabled(value:boolean,current:()=>boolean){
  if(this.saving||!this.fresh()||!current())throw Error(this.blocked||'附带开关正在保存或页面已失效');
  this.saving=true;this.writing=value;this.changed();
  try{await this.storage.update(EDITOR_ATTACHMENT_KEY,value);if(this.blocked||this.storage.get<unknown>(EDITOR_ATTACHMENT_KEY,undefined)!==value)throw Error('保存回执与存储不符');this.original=value;this.enabled=value;}
  catch{this.blocked='附带开关保存结果未确认；未自动重试，请窗口Reload后核对';throw Error(this.blocked);}
  finally{this.saving=false;this.writing=undefined;this.changed();}
 }
 async handle(m:any,owner:()=>Owner|undefined,active:()=>boolean,post:(reply:any)=>unknown){
  if(m?.type!=='editor-context')return false;
  if(!Number.isSafeInteger(m.id)||m.id<1||!['read','set','import'].includes(m.action))return true;
  const current=()=>{const s=owner();return active()&&!!s&&s.threadId===m.threadId&&s.connectionId===m.connectionId;};
  const reply=(value:object)=>post({type:'editor-context-result',id:m.id,threadId:m.threadId,connectionId:m.connectionId,...value,editorContext:this.snapshot()});
  let deliveryAttempted=false;
  try{
   if(!current())return true;
   if(m.action==='set'){if(typeof m.enabled!=='boolean')throw Error('附带开关值无效');await this.setEnabled(m.enabled,current);if(current())await reply({ok:true});return true;}
   if(m.action==='read'){await reply({ok:true});return true;}
   const source=this.snapshot().source,editor=this.editor();if(!source||!editor||m.sourceKey!==source.key)throw Error('活动文件来源已改变或开关未确认');
   const live=()=>current()&&this.snapshot().source?.key===source.key&&this.editor()?.path===editor.path;
   const bytes=await readEditorSnapshot(this.root,editor,live);
   if(!live())throw Error('活动文件所属线程或来源已失效');
   const digest=createHash('sha256').update(Buffer.from(bytes.base64,'base64')).digest('hex'),prior=this.existing({threadId:m.threadId,connectionId:m.connectionId}).find(file=>file.editorSource===bytes.editorSource&&file.sha256===digest);
   if(prior){await checkDraftFile(this.root,prior);if(live()){deliveryAttempted=true;await reply({ok:true,file:prior,reused:true});}return true;}
   const result=await this.importFile(this.root,bytes.name,bytes.base64,live);
   if(result.kind!=='file'){await result.discard();throw Error('活动文件未返回普通文件来源');}
   if(!live()){await result.discard();return true;}
   deliveryAttempted=true;const delivered=await reply({ok:true,file:{...result.file,editorSource:bytes.editorSource}});
   if(delivered===false)await result.discard();
  }catch(error){if(!deliveryAttempted&&current())try{await reply({ok:false,error:error instanceof Error?error.message:'活动文件附带失败'});}catch{/* Unknown delivery: do not invent success or retry. */}}
  return true;
 }
}
