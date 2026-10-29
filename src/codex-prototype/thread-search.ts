import {resolve} from 'node:path';
import type {Transport} from './rpc';
import type {Thread} from './protocol/v2/Thread';
import type {Turn} from './protocol/v2/Turn';
import type {ThreadItem} from './protocol/v2/ThreadItem';
import type {ThreadReadResponse} from './protocol/v2/ThreadReadResponse';
import type {ThreadTurnsListResponse} from './protocol/v2/ThreadTurnsListResponse';
import type {ThreadItemsListResponse} from './protocol/v2/ThreadItemsListResponse';
import {validHistoryTurn} from './thread-history';
import {parseSearchQuery,matchSearchText,type SearchQuery,type SearchHit} from './search-query';
import type {SearchCache,SearchCacheCapture} from './search-cache';
import {publicOutlineNode} from './thread-outline';
import {publicItemSearchSources} from './codex-search-text';
import {SearchHitBudget,SEARCH_HIT_LIMIT,TOOL_HITS_PER_THREAD} from './search-hit-budget';
import {publicTurnTimeMs} from './turn-display-metrics';

export const SEARCH_BATCH_REQUESTS=12,SEARCH_BATCH_TURNS=200;export {SEARCH_HIT_LIMIT} from './search-hit-budget';
export type {SearchHit} from './search-query';
export type SearchAvailability='active'|'archived'|'unavailable';
type Work={threadId:string;sourceVersion:number;metadata?:Thread;capture?:SearchCacheCapture;turns:Turn[];turnIndex:number;next:string|null;cursor:string|null;seen:Set<string>;turnIds:Set<string>;itemCursor:string|null;itemSeen:Set<string>;itemIds:Set<string>;items:ThreadItem[];stage:'metadata'|'legacy'|'turns'|'process'|'items'};
const opaque=(value:unknown)=>value===null||typeof value==='string'&&value.length>0;
/** Query-period public snapshots. Search never resumes/executes another thread or adopts ownership. */
export class ThreadSearch {
 private epoch=0;private query:SearchQuery={include:'',excludes:[]};private threads:string[]=[];private threadIndex=0;private work:Work|undefined;private current:()=>boolean=()=>false;private includeTools=false;
 private hits=new SearchHitBudget(SEARCH_HIT_LIMIT);private failures:{threadId:string;reason:string}[]=[];private incomplete=false;private done=true;private limited=false;private stale=false;
 private cached:SearchHit[]=[];private cachedThreads=new Set<string>();
 private scopeIds:string[]=[];private sourceStates=new Map<string,SearchAvailability>();private sourceVersions=new Map<string,number>();
 raw='';scope:'thread'|'workspace'='thread';loading=false;error='';scannedTurns=0;private requestId=0;
 get generation(){return this.epoch;}
 // The optional proof is the same immutable thread/start receipt while it remains
 // valid on the current connection. Empty metadata.turns alone is never proof.
 constructor(private rpc:Transport,private root:string,private cache?:SearchCache,private liveEmptyStart?:(threadId:string)=>Thread|undefined,private availability?:(threadId:string)=>SearchAvailability){if(cache&&!cache.matches(root))throw Error('搜索缓存工作区身份不一致');}
 start(raw:string,threads:readonly string[],scope:'thread'|'workspace',includeTools:boolean,current:()=>boolean,requestId=0){
  if(typeof raw!=='string'||raw.length>160||!['thread','workspace'].includes(scope)||threads.some(id=>typeof id!=='string'||!id||id.length>256))throw Error('搜索条件或会话范围无效');
  this.epoch++;this.requestId=requestId;this.raw=raw;this.query=parseSearchQuery(raw);this.scopeIds=[...new Set(threads)];this.sourceStates=new Map(this.scopeIds.map(id=>[id,this.sourceState(id)]));this.sourceVersions.clear();this.threads=this.scopeIds.filter(id=>this.sourceStates.get(id)==='active');this.threadIndex=0;this.work=undefined;this.current=current;this.scope=scope;this.includeTools=includeTools;this.hits=new SearchHitBudget(SEARCH_HIT_LIMIT);this.failures=[];this.incomplete=false;this.limited=false;this.stale=false;this.loading=false;this.error='';this.scannedTurns=0;this.done=!this.threads.length||!this.query.include;
  this.cachedThreads.clear();this.cached=[];if(this.query.include)for(const threadId of this.scopeIds)this.addCached(threadId,this.sourceStates.get(threadId)!);
  if(!this.query.include)this.error='请输入要查找的文字，不能只输入排除词';
  else if(scope==='thread'&&!this.threads.length)this.error='当前会话尚未核对，无法读取其全文';
 }
 private sourceState(threadId:string):SearchAvailability{return this.availability?.(threadId)??'active';}
 private addCached(threadId:string,state:SearchAvailability){
  if(state==='unavailable'||state==='archived'&&this.scope!=='workspace')return;
  const record=this.cache?.read(threadId);if(!record)return;if(state==='active')this.cachedThreads.add(threadId);
  const hits=new SearchHitBudget(SEARCH_HIT_LIMIT);for(const hit of this.cached)hits.add(hit);
  for(const entry of record.entries){const match=matchSearchText(entry.sources.filter(s=>this.includeTools||s.kind!=='工具'),this.query);if(match)hits.add({threadId,title:record.title,turnId:entry.turnId,itemId:entry.itemId,...match,incomplete:match.incomplete===true,cached:true,...(state==='archived'?{archived:true as const}:{}),cachedAtMs:record.capturedAtMs,...(entry.timeMs===undefined?{}:{timeMs:entry.timeMs})});}this.cached=hits.values();
 }
 private syncSources(){for(const threadId of this.scopeIds){const state=this.sourceState(threadId);if(state===this.sourceStates.get(threadId))continue;this.sourceStates.set(threadId,state);this.sourceVersions.set(threadId,(this.sourceVersions.get(threadId)??0)+1);this.cache?.invalidate(threadId);this.hits.forget(threadId);this.cached=this.cached.filter(hit=>hit.threadId!==threadId);this.cachedThreads.delete(threadId);if(this.query.include)this.addCached(threadId,state);this.stale=true;this.incomplete=true;}}
 private readable(work:Work){return this.sourceState(work.threadId)==='active'&&work.sourceVersion===(this.sourceVersions.get(work.threadId)??0);}
 availabilityChanged(){this.syncSources();}
 cancel(reason='搜索已取消；结果仅覆盖已读范围'){this.epoch++;this.loading=false;this.done=true;this.incomplete=true;this.error=reason;}
 markStale(threadId:string){this.cache?.invalidate(threadId);if(this.threads.includes(threadId)&&this.raw&&!this.stale){this.stale=true;this.incomplete=true;return true;}return false;}
 markScopeChanged(){if(this.scope==='workspace'&&this.raw){this.stale=true;this.incomplete=true;}}
 async discardCache(threadId:string){this.cached=this.cached.filter(h=>h.threadId!==threadId);this.cachedThreads.delete(threadId);try{await this.cache?.discard(threadId);}catch{/* The cache notice remains visible; a failed cache write does not replay public reads. */}}
 forget(threadId:string,reason='会话历史已删除，搜索结果已失效；请重新查询'){this.scopeIds=this.scopeIds.filter(id=>id!==threadId);this.hits.forget(threadId);this.cached=this.cached.filter(h=>h.threadId!==threadId);this.cachedThreads.delete(threadId);if(this.threads.includes(threadId)){this.cancel(reason);this.hits.forget(threadId);this.stale=true;}}
 snapshot(){this.syncSources();const combined=new SearchHitBudget(SEARCH_HIT_LIMIT);for(const hit of [...this.hits.values(),...this.cached])combined.add(hit);const archivedCachedThreads=new Set(this.cached.filter(hit=>hit.archived).map(hit=>hit.threadId)).size;return{archivedCachedThreads,requestId:this.requestId,query:this.raw,scope:this.scope,includeTools:this.includeTools,hits:structuredClone(combined.values()),loading:this.loading,done:this.done,hasMore:!this.done,complete:!!this.query.include&&this.done&&!this.error&&!this.failures.length&&!this.incomplete&&!this.limited&&!this.stale&&!this.cachedThreads.size&&!archivedCachedThreads,limited:this.limited,stale:this.stale,error:this.error,cacheNotice:[this.cachedThreads.size?'本地缓存尚未核实，公开读取会逐项替换；缓存不代表当前完整历史':'',this.cache?.notice()??''].filter(Boolean).join('；'),failures:structuredClone(this.failures),scannedThreads:this.threadIndex,totalThreads:this.threads.length,scannedTurns:this.scannedTurns,source:'查询期间通过Codex公开历史读取及当前连接的新建空会话回执核对；不是实时全局索引。工作区只读取本任务已确认活动会话；归档仅显示已有本地缓存，已删除和状态未确认会话不检索'};}
 private checked(thread:Thread,id:string){if(thread.id!==id||typeof thread.cwd!=='string'||resolve(thread.cwd).toLowerCase()!==resolve(this.root).toLowerCase()||!['legacy','paginated'].includes(thread.historyMode))throw Error('搜索会话的身份、工作区或历史模式未核对');}
 private add(turn:Turn,items:ThreadItem[],partial:boolean){
  const work=this.work!,metadata=work.metadata!;if(partial)this.incomplete=true;
  const node=publicOutlineNode(turn,items,false);work.capture?.node({turnId:node.turnId,label:node.label,...(node.itemId?{itemId:node.itemId}:{})});
  for(const item of [...items].reverse()){
   this.cached=this.cached.filter(h=>h.threadId!==work.threadId||h.turnId!==turn.id||h.itemId!==item.id);
   const timeMs=publicTurnTimeMs(turn,item.type==='agentMessage'),sources=publicItemSearchSources(item,this.includeTools),truncated=sources.some(source=>source.incomplete);work.capture?.entry(turn.id,item.id,partial?sources.map(s=>({...s,incomplete:true})):sources,timeMs);if(truncated){this.incomplete=true;this.error='部分公开字段超出搜索范围；截断字段不能完整核对排除词，结果未完整';}const match=matchSearchText(sources,this.query);if(!match)continue;
   this.hits.add({threadId:work.threadId,title:(metadata.name||metadata.preview||'会话').slice(0,256),turnId:turn.id,itemId:item.id,...match,...(timeMs===undefined?{}:{timeMs}),incomplete:partial||match.incomplete===true});
   if(this.hits.bodyCount>=SEARCH_HIT_LIMIT){this.limited=true;this.done=true;this.incomplete=true;this.error='正文/附件命中已达500条，本次结果未完整；请缩小查询范围';return;}
   if(this.hits.limited){this.limited=true;this.incomplete=true;this.error='正文/附件优先；每会话工具最多'+TOOL_HITS_PER_THREAD+'条、全文总共最多500条，本次结果未完整';}
  }
  this.scannedTurns++;
 }
 private async persist(work:Work|undefined,valid:()=>boolean,partial=false){if(!work?.capture||!valid()||!this.readable(work)||partial&&this.cache?.read(work.threadId))return;if(partial)work.capture.value.limited=true;try{await this.cache?.save(work.capture,()=>valid()&&this.readable(work));}catch{/* Cache failure is visible separately; public query results are retained. */}}
 private async finishThread(valid:()=>boolean,failed=false){const work=this.work;await this.persist(work,valid,failed);if(!valid()||work!==this.work)return;if(!failed&&work){this.cached=this.cached.filter(h=>h.threadId!==work.threadId);this.cachedThreads.delete(work.threadId);}this.threadIndex++;this.work=undefined;if(this.threadIndex>=this.threads.length)this.done=true;}
 async runBatch(){
  if(this.done||this.loading)return;const epoch=this.epoch,valid=()=>epoch===this.epoch&&this.current();this.loading=true;
  try{
   for(let reads=0,processed=0;reads<SEARCH_BATCH_REQUESTS&&processed<SEARCH_BATCH_TURNS&&!this.done;){
    if(!valid()){if(epoch===this.epoch)this.cancel('页面或连接已变化，搜索暂停；请重新查询');return;}
    this.syncSources();const threadId=this.threads[this.threadIndex]!;
    const work=this.work??={threadId,sourceVersion:this.sourceVersions.get(threadId)??0,turns:[],turnIndex:0,next:null,cursor:null,seen:new Set(),turnIds:new Set(),itemCursor:null,itemSeen:new Set(),itemIds:new Set(),items:[],stage:'metadata'};
    try{
     if(!this.readable(work)){this.threadIndex++;this.work=undefined;if(this.threadIndex>=this.threads.length)this.done=true;continue;}
     if(work.stage==='metadata'){
      const empty=this.liveEmptyStart?.(work.threadId);
      if(empty){
       this.checked(empty,work.threadId);const cached=this.cache?.read(work.threadId);
       if(!Array.isArray(empty.turns)||empty.turns.length||empty.status?.type==='active'||cached&&(cached.limited||cached.entries.length||cached.nodes.length))throw Error('新建空会话回执与当前状态或已有搜索内容不一致，请重新核对');
       // Count the logical source without persisting an unmaterialized history.
       // Activity during the await revokes this proof and falls through to normal
       // public reads on the next iteration, never to a fabricated empty page.
       await this.finishThread(()=>valid()&&this.liveEmptyStart?.(work.threadId)===empty);processed++;continue;
      }
      reads++;const read=await this.rpc.request<'thread/read',ThreadReadResponse>('thread/read',{threadId:work.threadId,includeTurns:false});if(!valid())return;this.syncSources();if(!this.readable(work))continue;this.checked(read.thread,work.threadId);work.metadata=read.thread;if(this.cache)work.capture=this.cache.begin(work.threadId,(read.thread.name||read.thread.preview||'会话').slice(0,256));work.stage=read.thread.historyMode==='legacy'?'legacy':'turns';continue;
     }
     if(work.stage==='legacy'){
      reads++;const read=await this.rpc.request<'thread/read',ThreadReadResponse>('thread/read',{threadId:work.threadId,includeTurns:true});if(!valid())return;this.syncSources();if(!this.readable(work))continue;this.checked(read.thread,work.threadId);if(read.thread.historyMode!=='legacy'||!Array.isArray(read.thread.turns)||!read.thread.turns.every(validHistoryTurn)||new Set(read.thread.turns.map(t=>t.id)).size!==read.thread.turns.length)throw Error('旧模式公开正文格式未核对');
      work.turns=[...read.thread.turns].reverse();work.turnIndex=0;work.next=null;work.stage='process';continue;
     }
     if(work.stage==='turns'){
      reads++;const page=await this.rpc.request<'thread/turns/list',ThreadTurnsListResponse>('thread/turns/list',{threadId:work.threadId,cursor:work.cursor,limit:20,sortDirection:'desc',itemsView:'full'});if(!valid())return;this.syncSources();if(!this.readable(work))continue;
      if(!page||!Array.isArray(page.data)||!page.data.every(validHistoryTurn)||!opaque(page.nextCursor)||!opaque(page.backwardsCursor)||new Set(page.data.map(t=>t.id)).size!==page.data.length)throw Error('搜索回合分页格式无效');
      if(page.nextCursor&&(page.nextCursor===work.cursor||work.seen.has(page.nextCursor)||!page.data.length)||work.cursor&&page.data.every(t=>work.turnIds.has(t.id)))throw Error('搜索回合分页未推进，结果未完整');
      if(work.cursor)work.seen.add(work.cursor);work.next=page.nextCursor;work.turns=page.data.filter(t=>!work.turnIds.has(t.id));for(const turn of work.turns)work.turnIds.add(turn.id);work.turnIndex=0;work.stage='process';continue;
     }
     if(work.stage==='process'){
      const turn=work.turns[work.turnIndex];if(!turn){if(work.next){work.cursor=work.next;work.stage='turns';}else await this.finishThread(valid);continue;}
      if(turn.itemsView==='full'||turn.status==='inProgress'||work.metadata!.historyMode==='legacy'){this.add(turn,turn.items,turn.itemsView!=='full'||turn.status==='inProgress');work.turnIndex++;processed++;continue;}
      work.itemCursor=null;work.itemSeen.clear();work.itemIds.clear();work.items=[];work.stage='items';continue;
     }
     const turn=work.turns[work.turnIndex]!;reads++;const page=await this.rpc.request<'thread/items/list',ThreadItemsListResponse>('thread/items/list',{threadId:work.threadId,turnId:turn.id,cursor:work.itemCursor,limit:100,sortDirection:'asc'});if(!valid())return;this.syncSources();if(!this.readable(work))continue;
     if(!page||!Array.isArray(page.data)||!opaque(page.nextCursor)||!opaque(page.backwardsCursor)||!page.data.every(row=>row.turnId===turn.id&&typeof row.item?.id==='string'&&!!row.item.id&&typeof row.item.type==='string'))throw Error('搜索回合正文身份或格式无效');
     if(page.nextCursor&&(page.nextCursor===work.itemCursor||work.itemSeen.has(page.nextCursor)||!page.data.length))throw Error('搜索正文游标未推进');
     for(const row of page.data){if(work.itemIds.has(row.item.id))throw Error('搜索正文页重复消息，未确认完整');work.itemIds.add(row.item.id);work.items.push(row.item);}
     if(work.itemCursor&&!page.data.length)throw Error('搜索正文后续页为空，完整性未核对');
     if(work.itemCursor)work.itemSeen.add(work.itemCursor);work.itemCursor=page.nextCursor;if(!page.nextCursor){this.add(turn,work.items,false);work.turnIndex++;processed++;work.stage='process';}
    }catch(error){if(!valid())return;this.syncSources();if(!this.readable(work))continue;this.failures.push({threadId:work.threadId,reason:(error instanceof Error?error.message:String(error)).slice(0,300)});this.incomplete=true;await this.finishThread(valid,true);}
   }
  }finally{if(this.done)await this.persist(this.work,valid,true);if(epoch===this.epoch)this.loading=false;}
 }
}
