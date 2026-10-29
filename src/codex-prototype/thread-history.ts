import type {Transport} from './rpc';
import type {Projection} from './state';
import type {Thread} from './protocol/v2/Thread';
import type {Turn} from './protocol/v2/Turn';
import type {ThreadItem} from './protocol/v2/ThreadItem';
import type {ThreadTurnsListResponse} from './protocol/v2/ThreadTurnsListResponse';
import type {ThreadItemsListResponse} from './protocol/v2/ThreadItemsListResponse';
import {validHistoryMaximum,type HistoryPreferences} from './history-preferences';

export const HISTORY_TURN_PAGE=20,HISTORY_ITEM_PAGE=100;
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256;
const cursor=(value:unknown):value is string|null=>value===null||typeof value==='string'&&value.length>0;
const item=(value:any):value is ThreadItem=>value&&id(value.id)&&typeof value.type==='string'&&!!value.type;
export const validHistoryTurn=(value:any):value is Turn=>value&&id(value.id)&&Array.isArray(value.items)&&value.items.every(item)&&new Set(value.items.map((i:ThreadItem)=>i.id)).size===value.items.length&&['inProgress','completed','interrupted','failed'].includes(value.status)&&['full','summary','notLoaded'].includes(value.itemsView);
type ItemWindow={cursor:string|null;seen:Set<string>;items:ThreadItem[]};

/** Public history cursors only. No private rollout files, invented sequence or cross-thread cache. */
export class ThreadHistory {
 private epoch=0;
 private request=0;
 private next:string|null=null;
 private seen=new Set<string>();
 private itemWindows=new Map<string,ItemWindow>();
 private thread='';
 private mode:'legacy'|'paginated'|undefined;
 private known=false;
 private initialLimit=0;
 loading=false;
 error='';
 loadingTurn='';
 get generation(){return this.epoch;}
 reset(thread:Thread){
  this.epoch++;this.request++;this.thread=thread.id;this.mode=undefined;this.known=false;this.next=null;this.seen.clear();this.itemWindows.clear();this.initialLimit=0;this.loading=false;this.loadingTurn='';this.error='';
  if(!['legacy','paginated'].includes(thread.historyMode))throw Error('公开历史模式未知，未推断为完整历史');
  this.mode=thread.historyMode;
 }
 legacyLoaded(){if(this.mode!=='legacy')throw Error('历史模式不匹配');this.known=true;}
 completeSnapshot(thread:Thread){this.reset(thread);this.known=true;}
 invalidate(reason:string){this.epoch++;this.request++;this.initialLimit=0;this.loading=false;this.loadingTurn='';this.known=false;this.next=null;this.seen.clear();this.itemWindows.clear();this.error=reason;}
 snapshot(projection:Projection){
  const incomplete=[...projection.turns.values()].filter(t=>t.itemsView!=='full').map(t=>t.id);
  return {generation:this.epoch,mode:this.mode??'unknown',loading:this.loading,loadingTurn:this.loadingTurn,error:this.error,hasMore:this.known?!!this.next:null,loadedTurns:projection.turns.size,incompleteTurns:incomplete,complete:this.known&&!this.next&&!incomplete.length&&!projection.activeTurn(),...(this.initialLimit?{initialLimit:this.initialLimit}:{}),scope:this.mode==='legacy'?'Codex legacy公开完整读取':'Codex公开回合分页；未加载或摘要回合不代表全文'};
 }
 /** Opening is a bounded series of the same public page operations. Completed
  * summaries must be hydrated before they can be counted as complete history. */
 async initial(rpc:Transport,projection:Projection,current:()=>boolean,preferences:HistoryPreferences,progress:()=>void,refreshLatest=false){
  if(typeof preferences.loadAll!=='boolean'||!validHistoryMaximum(preferences.maxMessages))throw Error('首开历史设置未核对');
  const {loadAll,maxMessages}=preferences,epoch=this.epoch,valid=()=>current()&&this.epoch===epoch;
  const count=()=>{const present=new Set([...projection.items.values()].map(row=>row.turnId));return projection.items.size+[...projection.turns.keys()].filter(id=>!present.has(id)).length;};
  const limited=()=>{if(count()<maxMessages)return false;this.initialLimit=maxMessages;return true;};
  const first=await this.older(rpc,projection,valid,refreshLatest);progress();if(!first||!valid())return false;if(!loadAll)return true;
  while(valid()){
   for(const turnId of projection.turns.keys()){
    let turn=projection.turns.get(turnId)!;
    while(turn.itemsView!=='full'&&turn.status!=='inProgress'){
     if(limited())return true;
     const loaded=await this.items(rpc,projection,turnId,valid);progress();if(!valid())return false;if(!loaded)return true;turn=projection.turns.get(turnId)!;
    }
   }
   if(!this.next)return true;if(limited())return true;
   const loaded=await this.older(rpc,projection,valid);progress();if(!valid())return false;if(!loaded)return true;
  }
  return false;
 }
 async older(rpc:Transport,projection:Projection,current:()=>boolean,refreshLatest=false){
  if(this.mode!=='paginated'||this.loading||this.loadingTurn||this.known&&!this.next)return false;
  this.initialLimit=0;
  const epoch=this.epoch,request=++this.request,threadId=this.thread,continuation=this.next,revision=projection.revision,valid=()=>current()&&this.epoch===epoch&&this.request===request&&projection.threadId===threadId;
  this.loading=true;this.error='';
  try{
   const page=await rpc.request<'thread/turns/list',ThreadTurnsListResponse>('thread/turns/list',{threadId,cursor:continuation,limit:HISTORY_TURN_PAGE,sortDirection:'desc',itemsView:'full'});
   if(!valid())return false;
   if(!page||!Array.isArray(page.data)||!page.data.every(validHistoryTurn)||new Set(page.data.map(t=>t.id)).size!==page.data.length||!cursor(page.nextCursor)||!cursor(page.backwardsCursor))throw Error('历史分页格式或完整性字段无效；未合并');
   if(page.nextCursor&&(page.nextCursor===continuation||this.seen.has(page.nextCursor)||!page.data.length||!!continuation&&page.data.every(t=>projection.turns.has(t.id))))throw Error('历史游标或内容未推进，已停止；可恢复会话后重新核对');
   if(continuation&&page.data.every(t=>projection.turns.has(t.id)))throw Error('历史后续页没有新回合，覆盖范围未确认；请恢复核对');
   // The server returns newest first. Existing rows (including live deltas) always win overlap.
   projection.prependHistory([...page.data].reverse(),refreshLatest&&projection.revision===revision);
   this.next=page.nextCursor;this.known=true;if(continuation)this.seen.add(continuation);return true;
  }catch(error){if(valid())this.error=error instanceof Error?error.message:String(error);return false;}
  finally{if(this.epoch===epoch&&this.request===request)this.loading=false;}
 }
 async items(rpc:Transport,projection:Projection,turnId:string,current:()=>boolean){
  const source=projection.turns.get(turnId);
  if(this.mode!=='paginated'||this.loading||this.loadingTurn||!source||source.status==='inProgress'||source.itemsView==='full')return false;
  this.initialLimit=0;
  const epoch=this.epoch,request=++this.request,threadId=this.thread,revision=projection.revision,valid=()=>current()&&this.epoch===epoch&&this.request===request&&projection.threadId===threadId;
  const window=this.itemWindows.get(turnId)??{cursor:null,seen:new Set<string>(),items:[]},continuation=window.cursor;
  this.loadingTurn=turnId;this.error='';
  try{
   const page=await rpc.request<'thread/items/list',ThreadItemsListResponse>('thread/items/list',{threadId,turnId,cursor:continuation,limit:HISTORY_ITEM_PAGE,sortDirection:'asc'});
   if(!valid())return false;
   if(projection.revision!==revision||projection.turns.get(turnId)!==source)throw Error('读取期间回合状态已变化，未覆盖新内容；请重试');
   if(!page||!Array.isArray(page.data)||!page.data.every(v=>v.turnId===turnId&&item(v.item))||!cursor(page.nextCursor)||!cursor(page.backwardsCursor))throw Error('回合正文分页身份或格式无效');
   const ids=new Set(window.items.map(v=>v.id));for(const row of page.data){if(ids.has(row.item.id))throw Error('回合正文分页包含重复消息，未合并');ids.add(row.item.id);}
   if(page.nextCursor&&(page.nextCursor===continuation||window.seen.has(page.nextCursor)||!page.data.length))throw Error('回合正文游标未推进，已停止');
   const items=[...window.items,...page.data.map(v=>v.item)];
   projection.hydrateHistoryTurn(turnId,items,page.nextCursor===null);
   window.items=items;window.cursor=page.nextCursor;if(continuation)window.seen.add(continuation);
   if(page.nextCursor)this.itemWindows.set(turnId,window);else this.itemWindows.delete(turnId);return true;
  }catch(error){if(valid())this.error=error instanceof Error?error.message:String(error);return false;}
  finally{if(this.epoch===epoch&&this.request===request)this.loadingTurn='';}
 }
}
