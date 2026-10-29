import type {DisplayStateStorage} from '../display-settings';
import type {PageRow,PageSession,PageState} from '../page-model';
import {ThreadCatalog,THREAD_CATALOG_KEY} from '../thread-catalog';
import {matchSearchText,parseSearchQuery} from '../search-query';
import {FINAL_MARKDOWN,BLOCK_FOLD_MARKDOWN,FORMULA_MARKDOWN} from './fixtures';
import {IMAGE_ASSETS} from './image-assets';
import {HISTORY_LOAD_DEFAULTS,validHistoryMaximum,type HistoryPreferences} from '../history-preferences';

export const OFFLINE_EXPERIENCE_PREFIX='codexPrototype.offlineExperience.v1.';
export const OFFLINE_EXPERIENCE_REASON='离线交互体验：固定合成资料，不连接后端、不发送消息；草稿只保存在本体验中';
const definitions=[['markdown','短历史与排序',FINAL_MARKDOWN,6],['images','图片与公式',FORMULA_MARKDOWN,12],['reading','长历史与阅读恢复',BLOCK_FOLD_MARKDOWN,48]] as const;
const sessions:PageSession[]=definitions.map(([key,title],index)=>({id:'offline-experience-'+key,title:'合成 · '+title,updatedAt:definitions.length-index,archived:false,observed:true}));
const scenes=new Map<string,PageRow[]>(definitions.map(([key,_title,markdown,count],index)=>[sessions[index]!.id,Array.from({length:count},(_,n)=>{
 const turnId='sample-turn-'+(n+1),label=`离线样例 ${n+1} · ${key} · 合成资料`,images=key==='images'&&(n===3||n===count-1)?['wide','transparent','missing','corrupt']:[];
 return [{turnId,complete:true,item:{type:'userMessage',id:'user-'+(n+1),content:[{type:'text',text:label+'，请展示固定内容。'},...images.map(id=>({type:'localImage',path:'',displayImage:IMAGE_ASSETS[id]}))]},displayMeta:{source:'synthetic'}},
  {turnId,complete:true,item:{type:'agentMessage',id:'answer-'+(n+1),text:`## ${label}\n\n搜索词：离线样例、排序、阅读恢复。此内容不是模型回复。\n\n${markdown}`},displayMeta:{source:'synthetic'}}] as PageRow[];
 }).flat()]));

/** Fixed page data only. No Session, transport, model budget or project file reads. */
export class OfflineExperience {
 readonly catalog:ThreadCatalog;
 readonly threads=sessions.map(v=>v.id);
 threadId:string;
 connectionId=0;
 private generation=0;
 private loaded=new Map<string,Set<string>>();
 private initialModes=new Map<string,boolean>();
 private outlines=new Set<string>();
 private search:NonNullable<PageState['search']>={requestId:0,query:'',scope:'workspace',includeTools:false,hits:[],loading:false,done:false,hasMore:false,complete:false,limited:false,stale:false,error:'',failures:[],scannedThreads:0,totalThreads:0,scannedTurns:0,source:'固定合成资料'};
 constructor(private storage:DisplayStateStorage,private historyPreferences:()=>HistoryPreferences=()=>HISTORY_LOAD_DEFAULTS){
  const seed={order:this.threads,entries:sessions,sort:'persisted'};
  this.catalog=new ThreadCatalog({get:<T>(key:string,fallback:T)=>storage.get(key,key===THREAD_CATALOG_KEY?seed as T:fallback),update:(key,value)=>storage.update(key,value)});
  const saved=storage.get<string>('selected','');this.threadId=this.threads.includes(saved)?saved:this.threads[0]!;
  const outlines=storage.get<unknown>('preparedOutlines',[]);if(Array.isArray(outlines))this.outlines=new Set(outlines.filter((id):id is string=>typeof id==='string'&&this.threads.includes(id)));
 }
 rows(threadId=this.threadId){return structuredClone(scenes.get(threadId)??[]);}
 turnIds(threadId=this.threadId){return [...new Set(this.rows(threadId).map(v=>v.turnId))];}
 private initialIds(threadId=this.threadId){const preferences=this.historyPreferences();if(typeof preferences.loadAll!=='boolean'||!validHistoryMaximum(preferences.maxMessages))throw Error('首开历史设置未核对');let ids=this.loaded.get(threadId);if(!ids||this.initialModes.get(threadId)!==preferences.loadAll){const all=this.turnIds(threadId);/* Every fixed scene has fewer than the minimum 500-entry cap. */ids=new Set(preferences.loadAll?all:all.slice(-2));this.loaded.set(threadId,ids);this.initialModes.set(threadId,preferences.loadAll);}return ids;}
 private loadedIds(){return this.loaded.get(this.threadId)??this.initialIds();}
 owns(message:{threadId?:unknown;connectionId?:unknown}){return message.threadId===this.threadId&&message.connectionId===this.connectionId;}
 async select(id:string){if(!this.threads.includes(id))throw Error('合成会话不存在，未读取真实历史');await this.storage.update('selected',id);this.threadId=id;this.generation++;this.initialIds(id);}
 async scanOutline(){const next=new Set(this.outlines).add(this.threadId);await this.storage.update('preparedOutlines',[...next]);this.outlines=next;}
 loadOlder(){this.loaded.set(this.threadId,new Set(this.turnIds()));}
 materialize(turnId:string,itemId?:string){const row=this.rows().find(v=>v.turnId===turnId&&(!itemId||v.item.id===itemId));if(!row)return{status:'unavailable',reason:'该节点不在固定合成资料中'};this.loadedIds().add(turnId);return{status:'loaded',itemId:row.item.id};}
 query(id:number,raw:string,scope:'thread'|'workspace',includeTools:boolean){
  if(!Number.isSafeInteger(id)||id<1||raw.length>160)throw Error('搜索条件无效');
  const query=parseSearchQuery(raw),targets=scope==='thread'?[this.threadId]:this.threads;
  const hits=targets.flatMap(threadId=>this.rows(threadId).flatMap(row=>{
   const text=row.item.type==='agentMessage'?row.item.text:row.item.type==='userMessage'?(row.item.content as {type:string;text?:string}[]).filter(v=>v.type==='text').map(v=>v.text).join('\n'):'';
   const match=typeof text==='string'?matchSearchText([{kind:'正文',text}],query):undefined;
   return match?[{threadId,title:sessions.find(v=>v.id===threadId)!.title,turnId:row.turnId,itemId:row.item.id,...match,incomplete:false}]:[];
  }));
  this.search={requestId:id,query:raw,scope,includeTools,hits,loading:false,done:true,hasMore:false,complete:true,limited:false,stale:false,error:'',failures:[],scannedThreads:targets.length,totalThreads:targets.length,scannedTurns:targets.reduce((sum,id)=>sum+this.turnIds(id).length,0),source:'固定合成资料；仅本离线体验，不含真实历史'};
 }
 snapshot():PageState{
  const loaded=this.loadedIds(),all=this.turnIds(),full=this.outlines.has(this.threadId)||loaded.size===all.length,items=this.rows().filter(v=>loaded.has(v.turnId));
  return {offlinePreview:true,threadId:this.threadId,connectionId:this.connectionId,status:'离线合成资料 · 后端未连接',model:'',ready:false,contentReady:true,busy:false,used:null,limit:null,oldUsed:null,threads:this.threads,threadManagementAvailable:false,localImagesAvailable:false,attachmentImportAvailable:false,searchToolsAvailable:false,dispatchBlockReason:OFFLINE_EXPERIENCE_REASON,toolCheck:{verified:false,reason:OFFLINE_EXPERIENCE_REASON},
   sessionCatalog:{...this.catalog.snapshot(this.threads),scope:'仅三个固定合成会话，与真实 Codex 历史隔离'},
   history:{generation:this.generation,mode:'paginated',loading:false,loadingTurn:'',error:'',hasMore:loaded.size<all.length,loadedTurns:loaded.size,incompleteTurns:[],complete:loaded.size===all.length,scope:'固定合成资料；模拟按回合读取，不代表真实服务分页'},
   outline:{nodes:all.filter(id=>full||loaded.has(id)).map(turnId=>({turnId,itemId:this.rows().find(v=>v.turnId===turnId)!.item.id,label:`离线样例 ${all.indexOf(turnId)+1}`,loaded:loaded.has(turnId),status:'completed'})),loading:false,error:'',complete:full,hasMore:!full,scope:'固定合成资料'},
   search:structuredClone(this.search),items,turns:all.filter(id=>loaded.has(id)).map(id=>({id,status:'completed',itemsView:'full',durationMs:null})),approvals:[],replyActionsEnabled:false,fileReferencesEnabled:false};
 }
}
