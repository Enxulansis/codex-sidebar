import type {DisplayStateStorage} from './display-settings';
export const RAIL_VIEW_KEY='codexPrototype.railView.v1',RAIL_VIEW_THREADS=32,RAIL_VIEW_RECORDS=200;
export type RailRecord={turnId:string;starred:boolean;note:string;drop?:'hidden'|'merged'};
export type RailChange={action:'star';turnId:string;value:boolean}|{action:'note';turnId:string;value:string}|{action:'drop';turnId:string;value:'hidden'|'merged'|null}|{action:'restore'};
type Saved={threadId:string;records:RailRecord[]};
const identity=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256;
export const validRailRecords=(raw:unknown):raw is RailRecord[]=>Array.isArray(raw)&&raw.length<=RAIL_VIEW_RECORDS&&raw.every(v=>v&&identity(v.turnId)&&typeof v.starred==='boolean'&&typeof v.note==='string'&&v.note.length<=60&&(v.drop===undefined||v.drop==='hidden'||v.drop==='merged'))&&new Set(raw.map(v=>v.turnId)).size===raw.length;
/** Additive display metadata keyed by real public IDs. Never truncates bookmarks silently. */
export class RailViewStore{
 private values:Saved[]=[];private corrupt=false;private tail:Promise<unknown>=Promise.resolve();private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){const raw=storage.get<unknown>(RAIL_VIEW_KEY,undefined);if(raw===undefined)return;if(!Array.isArray(raw)||raw.length>RAIL_VIEW_THREADS||!raw.every(v=>v&&identity(v.threadId)&&validRailRecords(v.records))||new Set(raw.map(v=>v.threadId)).size!==raw.length){this.corrupt=true;return;}this.values=structuredClone(raw);}
 private read(thread:string){if(this.corrupt)throw Error('导航记忆格式未核对，原记录保留');if(!identity(thread)||this.forgotten.has(thread))throw Error('导航会话身份已失效');return structuredClone(this.values.find(v=>v.threadId===thread)?.records??[]);}
 async load(thread:string){await this.tail;return this.read(thread);}
 change(thread:string,change:RailChange,current:()=>boolean){const task=this.tail.then(async()=>{
  if(!current())throw Error('导航视图已失效');let records=this.read(thread);
  if(change.action==='restore')records=records.map(({drop,...record})=>record);else{
   if(!identity(change.turnId))throw Error('导航节点身份无效');const record=records.find(v=>v.turnId===change.turnId)??{turnId:change.turnId,starred:false,note:''};
   if(change.action==='star'&&typeof change.value==='boolean')record.starred=change.value;
   else if(change.action==='note'&&typeof change.value==='string'&&change.value.length<=60)record.note=change.value.trim();
   else if(change.action==='drop'&&(change.value===null||change.value==='hidden'||change.value==='merged')){if(change.value===null)delete record.drop;else record.drop=change.value;}
   else throw Error('导航记忆操作无效');records=records.filter(v=>v.turnId!==change.turnId);records.push(record);
  }
  records=records.filter(v=>v.starred||v.note||v.drop);if(records.length>RAIL_VIEW_RECORDS)throw Error('此会话已有200条导航记忆，请先移除不需要的记录');
  const next=this.values.filter(v=>v.threadId!==thread);if(records.length)next.push({threadId:thread,records});if(next.length>RAIL_VIEW_THREADS)throw Error('导航记忆已覆盖32个会话，请先清理不需要的记录');
  await this.storage.update(RAIL_VIEW_KEY,next);this.values=next;return this.read(thread);
 });this.tail=task.catch(()=>{});return task;}
 forget(thread:string){this.forgotten.add(thread);const task=this.tail.then(async()=>{if(this.corrupt)throw Error('导航记忆格式未核对，原记录保留');const next=this.values.filter(v=>v.threadId!==thread);await this.storage.update(RAIL_VIEW_KEY,next);this.values=next;});this.tail=task.catch(()=>{});return task;}
}
type Owner={threadId:string;connectionId:number;turnIds:readonly string[]};
export async function handleRailView(store:RailViewStore,m:any,post:(m:any)=>unknown,owner:()=>Owner|undefined,active:()=>boolean){
 if(!['rail-view-read','rail-view-change'].includes(m?.type))return false;if(!Number.isSafeInteger(m.id)||m.id<1||!active())return true;
 const current=()=>{const value=owner();return active()&&!!value&&m.threadId===value.threadId&&m.connectionId===value.connectionId;};
 try{if(!current())throw Error('导航会话身份已变化');if(m.type==='rail-view-change'&&(!m.change||m.change.action!=='restore'&&!owner()!.turnIds.includes(m.change.turnId)))throw Error('节点不在已核对的公开回合表内');const records=m.type==='rail-view-read'?await store.load(m.threadId):await store.change(m.threadId,m.change,()=>current()&&(m.change.action==='restore'||!!owner()?.turnIds.includes(m.change.turnId)));if(current())await post({type:'rail-view-result',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:true,records});}
 catch(error){if(active())await post({type:'rail-view-result',id:m.id,threadId:m.threadId,connectionId:m.connectionId,ok:false,error:error instanceof Error?error.message:'导航记忆保存失败'});}return true;
}
