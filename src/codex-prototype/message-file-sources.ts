import {createHash,randomUUID} from 'node:crypto';import {lstat} from 'node:fs/promises';import {resolve,basename} from 'node:path';
import type {DisplayStateStorage} from './display-settings';import {validFiles,draftFileId,type DraftFile} from './draft-store-types';import {attachmentGroup} from './attachment-retention';import {attachmentKind} from './attachment-policy';import {checkDraftFile,fileReferenceText} from './attachment-files';import {ownedPath} from './storage';
import type {UserInput} from './protocol/v2/UserInput';import type {ThreadItem} from './protocol/v2/ThreadItem';import type {DisplayFile} from './message-file-types';
import {validSkillIdentity} from './skill-reference';
import {matchesDocumentInput} from './document-input';
import {validClientMessageId} from './send-request';
import {ATTACHMENT_COUNT} from './attachment-policy';
export const MESSAGE_FILE_SOURCES_KEY='codexPrototype.messageFileSources.v1',MESSAGE_FILE_RECORD_CAP=4096;
type Row={turnId:string;item:ThreadItem};
type Source={threadId:string;clientId:string;inputSha256:string;files:DraftFile[];expectedTurnId?:string;binding?:{turnId:string;itemId:string}};
const identifier=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256;
const clientId=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
/** Match only an explicit client-message ID plus the actual public input shape. Never parse file paths out of text. */
export function fileInputFingerprint(input:UserInput[]):string{
 if(!Array.isArray(input)||!input.length||input.length>ATTACHMENT_COUNT+3)throw Error('附件关联输入格式无效');
 const content=input.map(value=>{if(value?.type==='text'&&typeof value.text==='string'&&value.text.length<=100000&&Array.isArray(value.text_elements)&&!value.text_elements.length)return['text',value.text];if(value?.type==='localImage'&&typeof value.path==='string'&&value.path.length<=4096){const path=resolve(value.path);return['localImage',process.platform==='win32'?path.toLowerCase():path];}if(value?.type==='skill'&&validSkillIdentity(value)){const path=resolve(value.path);return['skill',value.name,process.platform==='win32'?path.toLowerCase():path];}throw Error('附件关联输入类型尚未核对');});
 return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
export class MessageFileSources{
 private records:Source[]=[];private tail:Promise<unknown>=Promise.resolve();private blocked='';private forgotten=new Set<string>();private health=new Map<string,{stamp:string;unavailable?:string}>();
 constructor(private storage:DisplayStateStorage,private root:string){const raw=storage.get<unknown>(MESSAGE_FILE_SOURCES_KEY,undefined);if(raw===undefined)return;if(!this.valid(raw)){this.blocked='正文附件来源记录无法读取；原数据保留，文件卡暂不可用';return;}this.records=structuredClone(raw.records);}
 private valid(value:any):value is {version:1;records:Source[]}{return value?.version===1&&Array.isArray(value.records)&&value.records.length<=MESSAGE_FILE_RECORD_CAP&&new Set(value.records.filter((v:any)=>v?.binding).map((v:any)=>JSON.stringify([v.threadId,v.binding.turnId,v.binding.itemId]))).size===value.records.filter((v:any)=>v?.binding).length&&new Set(value.records.map((v:any)=>JSON.stringify([v?.threadId,v?.clientId]))).size===value.records.length&&value.records.every((v:any)=>identifier(v?.threadId)&&clientId(v.clientId)&&/^[a-f0-9]{64}$/.test(v.inputSha256??'')&&validFiles(v.files)&&v.files.length>0&&v.files.every((file:DraftFile)=>{try{return !!attachmentGroup(this.root,file.path)&&attachmentKind(file.name)==='file'&&(process.platform==='win32'?basename(file.path).toLowerCase()===file.name.toLowerCase():basename(file.path)===file.name);}catch{return false;}})&&(v.expectedTurnId===undefined||identifier(v.expectedTurnId))&&(v.binding===undefined||identifier(v.binding?.turnId)&&identifier(v.binding?.itemId)&&(!v.expectedTurnId||v.binding.turnId===v.expectedTurnId)));}
 private check(thread?:string){if(this.blocked)throw Error(this.blocked);if(thread!==undefined&&(!identifier(thread)||this.forgotten.has(thread)))throw Error('正文附件线程无效或已永久删除');}
 private serial<T>(fn:()=>Promise<T>){const task=this.tail.then(fn);this.tail=task.catch(()=>{});return task;}
 private async save(records:Source[]){const value={version:1 as const,records};if(!this.valid(value))throw Error('正文附件来源格式或容量无法核对，原记录未覆盖');try{await this.storage.update(MESSAGE_FILE_SOURCES_KEY,value);}catch(error){this.blocked='正文附件来源保存未确认；原文件保留，请Reload后核对，未自动重发';throw error;}this.records=records;const keep=new Set(records.flatMap(r=>r.files.map(draftFileId)));for(const key of this.health.keys())if(!keep.has(key))this.health.delete(key);}
 prepare(threadId:string,input:UserInput[],files:DraftFile[],expectedTurnId?:string,providedId?:string):Promise<string|undefined>{if(!files.length)return Promise.resolve(undefined);return this.serial(async()=>{this.check(threadId);if(!validFiles(files)||expectedTurnId!==undefined&&!identifier(expectedTurnId)||providedId!==undefined&&!validClientMessageId(providedId))throw Error('正文附件来源无效');for(const file of files)await checkDraftFile(this.root,file);this.check(threadId);if(this.records.length>=MESSAGE_FILE_RECORD_CAP)throw Error('正文附件来源已达4096条上限，未丢弃已有记录');const id=providedId??randomUUID();if(this.records.some(record=>record.threadId===threadId&&record.clientId===id))throw Error('消息来源标识已使用，未重复提交');const record:Source={threadId,clientId:id,inputSha256:fileInputFingerprint(input),files:structuredClone(files),...(expectedTurnId?{expectedTurnId}:{})};await this.save([...this.records,record]);return id;});}
 verify(thread:string,id:string|undefined,input:UserInput[]){if(!id)return;this.check(thread);const record=this.records.find(v=>v.threadId===thread&&v.clientId===id);if(!record||record.inputSha256!==fileInputFingerprint(input))throw Error('待发送附件与来源快照已变化，未提交');}
 drop(thread:string,id:string|undefined){if(!id)return Promise.resolve();return this.serial(async()=>{this.check(thread);await this.save(this.records.filter(v=>v.threadId!==thread||v.clientId!==id||!!v.binding));});}
 async attachmentReferences(){await this.tail;this.check();return this.records.flatMap(record=>record.files.map(file=>({owner:JSON.stringify([record.threadId,record.clientId]),path:file.path})));}
 private matches(record:Source,row:Row){try{return row.item.type==='userMessage'&&row.item.clientId===record.clientId&&(!record.expectedTurnId||row.turnId===record.expectedTurnId)&&fileInputFingerprint(row.item.content)===record.inputSha256;}catch{return false;}}
 lookup(thread:string,turnId:string,item:ThreadItem):DraftFile[]{this.check(thread);const source=this.records.find(v=>v.threadId===thread&&v.binding?.turnId===turnId&&v.binding.itemId===item.id);return source&&this.matches(source,{turnId,item})?structuredClone(source.files):[];}
 private async display(file:DraftFile):Promise<DisplayFile>{
  const id=draftFileId(file);try{const path=await ownedPath(this.root,file.path),info=await lstat(path,{bigint:true});if(info.isSymbolicLink()||!info.isFile()||info.size!==BigInt(file.size))throw Error('文件缺失、大小变化或来源不再可用');const stamp=[info.ino,info.dev,info.size,info.mtimeNs,info.ctimeNs].join(':');let cached=this.health.get(id);if(cached?.stamp!==stamp){try{await checkDraftFile(this.root,file);cached={stamp};}catch{cached={stamp,unavailable:'文件内容已变化，原附件引用不可用'};}this.health.set(id,cached);}return{...file,...(cached.unavailable?{unavailable:cached.unavailable}:{})};}
  catch{return{...file,unavailable:'文件缺失、大小变化或路径不再可用'};}
 }
 /** Bind only a unique public echo. No text-tail fallback, nearest turn or array-position identity. */
 project(thread:string,rows:Row[]):Promise<{files:Map<string,DisplayFile[]>;referenceIndexes:Map<string,number>;notice:string;waiting:number}>{return this.serial(async()=>{
  const result={files:new Map<string,DisplayFile[]>(),referenceIndexes:new Map<string,number>(),notice:'',waiting:0};try{this.check(thread);const byClient=new Map<string,Row[]>();for(const row of rows)if(row.item.type==='userMessage'&&row.item.clientId){const values=byClient.get(row.item.clientId)??[];values.push(row);byClient.set(row.item.clientId,values);}
   let conflicts=0,changed=false;const next=this.records.map(record=>{if(record.threadId!==thread)return record;const candidates=byClient.get(record.clientId)??[],row=candidates[0];if(!candidates.length){if(!record.binding)result.waiting++;return record;}if(candidates.length!==1||!row||!this.matches(record,row)){conflicts++;return record;}if(record.binding){if(record.binding.turnId!==row.turnId||record.binding.itemId!==row.item.id)conflicts++;return record;}changed=true;return{...record,binding:{turnId:row.turnId,itemId:row.item.id}};});
   if(changed)await this.save(next);
   for(const record of this.records){
    if(record.threadId!==thread||!record.binding)continue;
    const candidates=byClient.get(record.clientId)??[],row=candidates[0];
    if(candidates.length!==1||!row||record.binding.turnId!==row.turnId||record.binding.itemId!==row.item.id||!this.matches(record,row))continue;
    const index=row.item.type==='userMessage'?row.item.content.length-1:-1,input=row.item.type==='userMessage'?row.item.content[index]:undefined;
    const textIncluded=input?.type==='text'&&matchesDocumentInput(input.text,record.files);
    result.files.set(row.item.id,await Promise.all(record.files.map(async file=>({...await this.display(file),...(textIncluded?{textIncluded:true}:{})}))));
    if(input?.type==='text'&&(input.text===fileReferenceText(record.files.map(file=>({name:file.name,path:resolve(file.path)})))||textIncluded))result.referenceIndexes.set(row.item.id,index);
   }
   if(conflicts)result.notice='附件记录与消息不一致；请重新加载会话核对，原文件已保留。';return result;
  }catch(error){return{...result,files:new Map(),referenceIndexes:new Map(),notice:error instanceof Error?error.message:'正文附件来源暂不可用'};}
 });}
 fork(source:string,child:string,rows:Row[]){return this.serial(async()=>{this.check(source);this.check(child);const copied:Source[]=[];for(const record of this.records.filter(v=>v.threadId===source)){const matches=rows.filter(row=>this.matches(record,row));if(matches.length===1){const row=matches[0]!,next={...structuredClone(record),threadId:child,binding:{turnId:row.turnId,itemId:row.item.id}};const existing=this.records.find(v=>v.threadId===child&&v.clientId===record.clientId);if(existing){if(JSON.stringify(existing)!==JSON.stringify(next))throw Error('分支附件来源身份冲突，未覆盖');}else copied.push(next);}}if(copied.length)await this.save([...this.records,...copied]);});}
 forget(thread:string){if(!identifier(thread))return Promise.reject(Error('正文附件线程无效'));this.forgotten.add(thread);return this.serial(async()=>{this.check();await this.save(this.records.filter(v=>v.threadId!==thread));});}
}
