import {isAbsolute,relative,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {DisplayStateStorage} from './display-settings';

export const ATTACHMENT_RETENTION_KEY='codexPrototype.attachmentRetention.v1';
export const RETAINED_PATH_CAP=4096;
type Record={id:string;paths:string[]};
type Data={version:1;threads:Record[];forks:Record[]};
const validThread=(id:unknown):id is string=>typeof id==='string'&&!!id&&id.length<=256;
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const managed=new RegExp('^\\.codex-attachments/('+uuid+')/(?:derived/|animated/)?[^/]+$','i');
/** Only imported UUID groups are ever eligible for managed cleanup. Other workspace images stay external references. */
export function attachmentGroup(root:string,path:string):string|undefined{
 if(typeof path!=='string'||path.length>4096||!isAbsolute(path))return;
 const match=relative(resolve(root),resolve(path)).replace(/\\/g,'/').match(managed);return match?.[1]?.toLowerCase();
}
/** Conservative local source protection, not a message/history ledger or proof that a dispatch succeeded. */
export class AttachmentRetention{
 private records=new Map<string,string[]>();private forks=new Map<string,string[]>();private tail:Promise<unknown>=Promise.resolve();private blocked='';private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage,private root:string){
  const raw=storage.get<unknown>(ATTACHMENT_RETENTION_KEY,undefined);if(raw===undefined)return;
  if(!this.valid(raw)){this.blocked='附件留存记录无法读取；原数据保留，未清理文件';return;}
  this.records=new Map(raw.threads.map(record=>[record.id,[...record.paths]]));
  this.forks=new Map(raw.forks.map(record=>[record.id,[...record.paths]]));
 }
 private valid(value:any):value is Data{
  if(value?.version!==1||!Array.isArray(value.threads)||!Array.isArray(value.forks)||value.threads.length+value.forks.length>RETAINED_PATH_CAP)return false;
  return [value.threads,value.forks].every(records=>new Set(records.map((record:any)=>record?.id)).size===records.length&&records.every((record:any)=>validThread(record?.id)&&Array.isArray(record.paths)&&record.paths.length>0&&new Set(record.paths).size===record.paths.length&&record.paths.every((path:unknown)=>typeof path==='string'&&!!attachmentGroup(this.root,path))))&&value.forks.every((record:Record)=>new RegExp('^'+uuid+'$','i').test(record.id))&&[...value.threads,...value.forks].reduce((sum:number,record:Record)=>sum+record.paths.length,0)<=RETAINED_PATH_CAP;
 }
 private check(id?:string){if(this.blocked)throw Error(this.blocked);if(id!==undefined&&(!validThread(id)||this.forgotten.has(id)))throw Error('附件留存线程无效或已永久删除');}
 private change<T>(id:string|undefined,edit:(next:Map<string,string[]>,forks:Map<string,string[]>)=>T){
  const task=this.tail.then(async()=>{this.check(id);const next=new Map([...this.records].map(([thread,paths])=>[thread,[...paths]])),forks=new Map([...this.forks].map(([token,paths])=>[token,[...paths]])),result=edit(next,forks),records=(map:Map<string,string[]>)=>[...map].map(([key,paths])=>({id:key,paths})),value:Data={version:1,threads:records(next),forks:records(forks)};if(!this.valid(value))throw Error('附件留存引用已达4096项上限，未发送或丢弃已有来源');try{await this.storage.update(ATTACHMENT_RETENTION_KEY,value);}catch(error){this.blocked='附件留存保存未确认；未发送，停止自动清理，请重新加载后核对';throw error;}this.records=next;this.forks=forks;return result;});this.tail=task.catch(()=>{});return task;
 }
 /** Persist before reserving a model attempt or handing paths to turn/start or turn/steer. */
 retain(id:string,paths:readonly string[]){
  const managedPaths=[...new Set(paths.filter(path=>attachmentGroup(this.root,path)).map(path=>resolve(path)))];if(!managedPaths.length)return Promise.resolve();
  return this.change(id,next=>{next.set(id,[...new Set([...(next.get(id)??[]),...managedPaths])]);});
 }
 /** Persist before fork RPC: an unknown child may survive even after its parent's acknowledged deletion. */
 beginFork(source:string){return this.change(source,(next,forks)=>{const paths=next.get(source);if(!paths?.length)return;const token=randomUUID();forks.set(token,[...paths]);return token;});}
 /** Keep the complete source set conservatively, including unloaded history beyond the chosen prefix. */
 finishFork(token:string|undefined,target:string){if(!token)return Promise.resolve();return this.change(target,(next,forks)=>{const paths=forks.get(token);if(!paths)throw Error('分支附件留存标识已失效');next.set(target,[...new Set([...(next.get(target)??[]),...paths])]);forks.delete(token);});}
 cancelFork(token:string|undefined){if(!token)return Promise.resolve();return this.change(undefined,(_next,forks)=>{forks.delete(token);});}
 async snapshot(){await this.tail;this.check();const copy=(map:Map<string,string[]>)=>new Map([...map].map(([key,paths])=>[key,[...paths]]));return{threads:copy(this.records),unresolvedForks:copy(this.forks)};}
 /** Caller must already hold an acknowledged permanent-delete tombstone. Archive never calls this. */
 forget(id:string){
  if(!validThread(id))return Promise.reject(Error('附件留存线程无效'));this.forgotten.add(id);
  return this.change(undefined,next=>{next.delete(id);});
 }
}
