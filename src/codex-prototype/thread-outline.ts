import type {Transport} from './rpc';
import type {Projection} from './state';
import type {Thread} from './protocol/v2/Thread';
import type {Turn} from './protocol/v2/Turn';
import type {ThreadItem} from './protocol/v2/ThreadItem';
import type {SearchCache,CachedNode} from './search-cache';
import type {ThreadTurnsListResponse} from './protocol/v2/ThreadTurnsListResponse';
import {validHistoryTurn} from './thread-history';

export const OUTLINE_PAGE_SIZE=100,OUTLINE_BATCH_PAGES=8;
/** loaded is public full-item coverage, independent of turn success and visible DOM geometry. */
export type OutlineNode={turnId:string;itemId?:string;label:string;loaded:boolean;status:string;cached?:true};
export function publicOutlineNode(turn:Turn,items:ThreadItem[],loaded:boolean,status=turn.status):OutlineNode{
 const user=items.find(item=>item.type==='userMessage'),text=user?.type==='userMessage'?user.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):'';
 const target=items.find(item=>item.type==='userMessage')??items.find(item=>item.type!=='reasoning');
 return{turnId:turn.id,...(target?{itemId:target.id}:{}),label:text.trim().slice(0,100)||'回合 · '+turn.id.slice(0,8),loaded,status};
}
/** Ordered real turn IDs from a public summary scan. Never manufactures DSH event/stop sequences. */
export class ThreadOutline {
 private thread='';private mode='unknown';private epoch=0;private rows:Turn[]=[];private started=false;private next:string|null=null;private seen=new Set<string>();
 loading=false;error='';private cached:CachedNode[]=[];
 constructor(private cache?:SearchCache){}
 reset(thread:Thread,projection:Projection){this.epoch++;this.thread=thread.id;this.mode=thread.historyMode;this.rows=thread.historyMode==='legacy'?[...projection.turns.values()]:[];this.cached=this.cache&&typeof thread.cwd==='string'&&this.cache.matches(thread.cwd)?this.cache.nodes(thread.id).toReversed():[];this.started=thread.historyMode==='legacy';this.next=null;this.seen.clear();this.loading=false;this.error='';}
 invalidate(reason:string){this.epoch++;this.rows=[];this.cached=[];this.started=false;this.next=null;this.seen.clear();this.loading=false;this.error=reason;}
 snapshot(projection:Projection){
  const loaded=[...projection.turns.values()],rows=this.started?[...this.rows]:loaded;
  if(this.started&&rows.length){const anchor=loaded.findIndex(v=>v.id===rows.at(-1)!.id);if(anchor>=0)rows.push(...loaded.slice(anchor+1).filter(v=>!rows.some(row=>row.id===v.id)));}
  const nodes:OutlineNode[]=rows.map(turn=>{
   const live=projection.turns.get(turn.id),items=live?[...projection.items.values()].filter(v=>v.turnId===turn.id).map(v=>v.item):turn.items;
   return publicOutlineNode(turn,items,live?.itemsView==='full',live?.status??turn.status);
  });
  if(!this.started&&this.cached.length){const fresh=new Map(nodes.map(n=>[n.turnId,n])),merged=this.cached.map((node):OutlineNode=>fresh.get(node.turnId)??{...node,loaded:false,status:'unknown',cached:true}),seen=new Set(merged.map(n=>n.turnId));merged.push(...nodes.filter(n=>!seen.has(n.turnId)));return{nodes:merged,loading:this.loading,error:this.error,complete:false,hasMore:null,scope:'本地缓存节点尚未核实；仅已加载节点来自本次公开读取，请准备完整轨道核对'};}
  return{nodes,loading:this.loading,error:this.error,complete:this.started&&!this.next,hasMore:this.started?!!this.next:null,scope:this.started&&!this.next?'公开回合表已读到开头':'节点范围尚未完整；编号仅表示当前列表位置'};
 }
 async scan(rpc:Transport,projection:Projection,current:()=>boolean){
  if(this.mode!=='paginated'||this.loading||this.started&&!this.next)return;
  const epoch=this.epoch,threadId=this.thread,valid=()=>current()&&epoch===this.epoch&&projection.threadId===threadId;this.loading=true;this.error='';
  try{
   for(let count=0;count<OUTLINE_BATCH_PAGES;count++){
    const cursor=this.next,page=await rpc.request<'thread/turns/list',ThreadTurnsListResponse>('thread/turns/list',{threadId,cursor,limit:OUTLINE_PAGE_SIZE,sortDirection:'desc',itemsView:'summary'});
    if(!valid())return;
    if(!page||!Array.isArray(page.data)||!page.data.every(validHistoryTurn)||new Set(page.data.map(t=>t.id)).size!==page.data.length||!(page.nextCursor===null||typeof page.nextCursor==='string'&&!!page.nextCursor)||!(page.backwardsCursor===null||typeof page.backwardsCursor==='string'&&!!page.backwardsCursor))throw Error('回合表公开分页格式无效');
    const ids=new Set(this.rows.map(t=>t.id)),older=[...page.data].reverse().filter(t=>!ids.has(t.id));
    if(page.nextCursor&&(page.nextCursor===cursor||this.seen.has(page.nextCursor)||!older.length))throw Error('回合表游标未推进，未声明全量');
    if(cursor&&!older.length)throw Error('回合表后续页没有新回合，未声明全量');
    this.rows=[...older,...this.rows];this.started=true;this.next=page.nextCursor;if(cursor)this.seen.add(cursor);if(!this.next)return;
   }
  }catch(error){if(valid())this.error=error instanceof Error?error.message:String(error);}
  finally{if(epoch===this.epoch)this.loading=false;}
 }
}
