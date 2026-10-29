import {randomUUID,createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {DisplayStateStorage} from './display-settings';
import {validSearchTimeMs,validSearchAttachment,type SearchSource} from './search-query';

export const SEARCH_CACHE_KEY='codexPrototype.searchCache.v1';
export const CACHE_THREADS=8,CACHE_ENTRIES=2000,CACHE_NODES=2000,CACHE_TEXT=4000,CACHE_SOURCES=8;
export const CACHE_THREAD_BYTES=1024*1024,CACHE_TOTAL_BYTES=8*1024*1024;
export type CachedNode={turnId:string;itemId?:string;label:string};
export type CachedEntry={turnId:string;itemId:string;sources:SearchSource[];timeMs?:number};
export type SearchCacheRecord={threadId:string;title:string;snapshotId:string;capturedAtMs:number;limited:boolean;entries:CachedEntry[];nodes:CachedNode[]};
type File={version:1;workspace:string;records:SearchCacheRecord[]};
const workspaceKey=(root:string)=>createHash('sha256').update(resolve(root).toLowerCase()).digest('hex');
const id=(v:unknown):v is string=>typeof v==='string'&&!!v&&v.length<=256;
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));
const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v),'utf8');
function validNode(v:unknown):v is CachedNode{return plain(v)&&keys(v,['turnId','itemId','label'])&&id(v.turnId)&&(v.itemId===undefined||id(v.itemId))&&typeof v.label==='string'&&v.label.length<=100;}
function validSource(v:unknown):v is SearchSource{return plain(v)&&keys(v,['kind','text','field','incomplete','file'])&&['正文','图片','文件','工具'].includes(v.kind as string)&&typeof v.text==='string'&&v.text.length<=CACHE_TEXT&&(v.field===undefined||v.field==='调用'||v.field==='结果')&&(v.incomplete===undefined||typeof v.incomplete==='boolean')&&(v.file===undefined||validSearchAttachment(v.file));}
function validEntry(v:unknown):v is CachedEntry{return plain(v)&&keys(v,['turnId','itemId','sources','timeMs'])&&id(v.turnId)&&id(v.itemId)&&(v.timeMs===undefined||validSearchTimeMs(v.timeMs))&&Array.isArray(v.sources)&&v.sources.length>0&&v.sources.length<=CACHE_SOURCES&&v.sources.every(validSource);}
function validRecord(v:unknown):v is SearchCacheRecord{
 if(!plain(v)||!keys(v,['threadId','title','snapshotId','capturedAtMs','limited','entries','nodes'])||!id(v.threadId)||typeof v.title!=='string'||v.title.length>256||typeof v.snapshotId!=='string'||!/^[0-9a-f-]{36}$/.test(v.snapshotId)||!Number.isSafeInteger(v.capturedAtMs)||(v.capturedAtMs as number)<0||typeof v.limited!=='boolean'||!Array.isArray(v.entries)||v.entries.length>CACHE_ENTRIES||!v.entries.every(validEntry)||!Array.isArray(v.nodes)||v.nodes.length>CACHE_NODES||!v.nodes.every(validNode))return false;
 return new Set(v.nodes.map(n=>n.turnId)).size===v.nodes.length&&new Set(v.entries.map(e=>JSON.stringify([e.turnId,e.itemId]))).size===v.entries.length&&bytes(v)<=CACHE_THREAD_BYTES;
}

/** One local capture, never a server revision. Node and text snapshots commit together. */
export class SearchCacheCapture{
 readonly value:SearchCacheRecord;
 private size=4096;private entries=new Set<string>();private nodes=new Set<string>();
 constructor(threadId:string,title:string,readonly epoch:number){this.value={threadId,title:title.slice(0,256),snapshotId:randomUUID(),capturedAtMs:Date.now(),limited:false,entries:[],nodes:[]};}
 private room(value:unknown){const n=bytes(value)+1;if(this.size+n>CACHE_THREAD_BYTES){this.value.limited=true;return false;}this.size+=n;return true;}
 node(node:CachedNode){if(!validNode(node)){this.value.limited=true;return;}if(this.nodes.has(node.turnId))return;if(this.value.nodes.length>=CACHE_NODES||!this.room(node)){this.value.limited=true;return;}this.nodes.add(node.turnId);this.value.nodes.push({...node});}
 entry(turnId:string,itemId:string,sources:readonly SearchSource[],timeMs?:number){
  const key=JSON.stringify([turnId,itemId]);if(this.entries.has(key)||!sources.length)return;
  if(!id(turnId)||!id(itemId)||this.value.entries.length>=CACHE_ENTRIES){this.value.limited=true;return;}
  const safe:SearchSource[]=[];for(const source of sources.slice(0,CACHE_SOURCES)){if(typeof source.text!=='string'||!['正文','图片','文件','工具'].includes(source.kind))continue;safe.push({kind:source.kind,text:source.text.slice(0,CACHE_TEXT),...(source.field?{field:source.field}:{}),...(source.incomplete||source.text.length>CACHE_TEXT?{incomplete:true}:{}),...(source.file?{file:{...source.file}}:{})});}
  if(sources.length>CACHE_SOURCES)this.value.limited=true;
  const entry={turnId,itemId,sources:safe,...(validSearchTimeMs(timeMs)?{timeMs}:{})};if(!safe.length)return;if(!validEntry(entry)){this.value.limited=true;return;}
  if(!this.room(entry))return;this.entries.add(key);this.value.entries.push(entry);
 }
}

/** Workspace-local Memento snapshot. All reads are provisional; no cursor, raw item, media or credentials. */
export class SearchCache{
 private records:SearchCacheRecord[]=[];private epochs=new Map<string,number>();private removed=new Set<string>();private suppressed=new Set<string>();
 private tail:Promise<unknown>=Promise.resolve();private corrupt=false;private failure='';private wrongWorkspace=false;private workspace:string;
 constructor(private storage:DisplayStateStorage,root:string){
  this.workspace=workspaceKey(root);
  const raw=storage.get<unknown>(SEARCH_CACHE_KEY,undefined);if(raw===undefined)return;
  if(plain(raw)&&typeof raw.workspace==='string'&&raw.workspace!==this.workspace){this.wrongWorkspace=true;this.corrupt=true;return;}
  if(!plain(raw)||!keys(raw,['version','workspace','records'])||raw.version!==1||raw.workspace!==this.workspace||!Array.isArray(raw.records)||raw.records.length>CACHE_THREADS||!raw.records.every(validRecord)||new Set(raw.records.map(r=>r.threadId)).size!==raw.records.length||bytes(raw)>CACHE_TOTAL_BYTES){this.corrupt=true;return;}
  this.records=structuredClone(raw.records);
 }
 matches(root:string){return this.workspace===workspaceKey(root);}
 notice(){return this.wrongWorkspace?'本地搜索缓存工作区身份不一致，原值保留；公开查询仍可使用':this.corrupt?'本地搜索缓存格式未核对，原值保留；公开查询仍可使用':this.failure;}
 read(threadId:string){if(this.corrupt||this.removed.has(threadId)||this.suppressed.has(threadId))return;const record=this.records.find(r=>r.threadId===threadId);return record?structuredClone(record):undefined;}
 nodes(threadId:string){if(this.corrupt||this.removed.has(threadId)||this.suppressed.has(threadId))return[];return structuredClone(this.records.find(r=>r.threadId===threadId)?.nodes??[]);}
 begin(threadId:string,title:string){if(!id(threadId))throw Error('缓存线程身份无效');const epoch=(this.epochs.get(threadId)??0)+1;this.epochs.set(threadId,epoch);return new SearchCacheCapture(threadId,title,epoch);}
 invalidate(threadId:string){if(this.epochs.has(threadId)||this.records.some(r=>r.threadId===threadId))this.epochs.set(threadId,(this.epochs.get(threadId)??0)+1);}
 async save(capture:SearchCacheCapture,current:()=>boolean){
  if(this.corrupt)return false;const value={...structuredClone(capture.value),snapshotId:randomUUID(),capturedAtMs:Date.now()},valid=()=>current()&&!this.removed.has(value.threadId)&&this.epochs.get(value.threadId)===capture.epoch;
  if(!valid()||!validRecord(value))return false;
  return this.enqueue(async()=>{
   if(!valid())return false;const next=[value,...this.records.filter(r=>r.threadId!==value.threadId&&!this.removed.has(r.threadId)&&!this.suppressed.has(r.threadId))].slice(0,CACHE_THREADS);
   while(bytes({version:1,workspace:this.workspace,records:next})>CACHE_TOTAL_BYTES)next.pop();
   await this.storage.update(SEARCH_CACHE_KEY,{version:1,workspace:this.workspace,records:next} satisfies File);this.failure='';if(valid())this.suppressed.delete(value.threadId);this.records=next.filter(r=>!this.removed.has(r.threadId)&&!this.suppressed.has(r.threadId));return valid();
  });
 }
 forget(threadId:string){
  if(!id(threadId))return Promise.reject(Error('缓存线程身份无效'));this.removed.add(threadId);return this.discard(threadId);
 }
 discard(threadId:string){
  if(!id(threadId))return Promise.reject(Error('缓存线程身份无效'));this.invalidate(threadId);this.suppressed.add(threadId);this.records=this.records.filter(r=>r.threadId!==threadId);
  if(this.corrupt)return Promise.reject(Error(this.notice()));
  return this.enqueue(async()=>{const next=this.records.filter(r=>r.threadId!==threadId&&!this.removed.has(r.threadId)&&!this.suppressed.has(r.threadId));await this.storage.update(SEARCH_CACHE_KEY,{version:1,workspace:this.workspace,records:next} satisfies File);this.failure='';this.records=next;});
 }
 private enqueue<T>(run:()=>Promise<T>){const task=this.tail.then(run).catch(error=>{this.failure='本地搜索缓存保存未确认；公开查询仍可使用';throw error;});this.tail=task.catch(()=>{});return task;}
 async flush(){await this.tail;if(this.failure)throw Error(this.failure);}
}
