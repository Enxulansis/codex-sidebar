import {resolve} from 'node:path';
import type {Transport} from './rpc';
import type {ThreadReadResponse} from './protocol/v2/ThreadReadResponse';
import type {ThreadTurnsListResponse} from './protocol/v2/ThreadTurnsListResponse';
import type {Thread} from './protocol/v2/Thread';
import type {Turn} from './protocol/v2/Turn';
import {HISTORY_TURN_PAGE,validHistoryTurn} from './thread-history';

export type RevertPreview={count:number;turnId:string;preview:string};
const MAX_REVERT_TURNS=2000;
export function assertRevertThread(thread:Thread,threadId:string,root:string){
 if(!thread||thread.id!==threadId||typeof thread.cwd!=='string'||resolve(thread.cwd).toLowerCase()!==resolve(root).toLowerCase()||thread.historyMode!=='paginated'||thread.status?.type!=='idle')throw Error('回退会话、工作区、分页模式或空闲状态未核对');
}
/** Read only public, complete turns. Bound both work and confirmation scope. */
export async function readRevertRange(rpc:Transport,root:string,threadId:string,turnId:string,itemId:string,current:()=>boolean){
 const check=()=>{if(!current())throw Error('回退准备已失效，未提交');};check();
 const metadata=await rpc.request<'thread/read',ThreadReadResponse>('thread/read',{threadId,includeTurns:false});check();assertRevertThread(metadata.thread,threadId,root);
 let cursor:string|null=null;const cursors=new Set<string>(),seen=new Set<string>(),turns:Turn[]=[];
 while(turns.length<MAX_REVERT_TURNS){
  const page:ThreadTurnsListResponse=await rpc.request<'thread/turns/list',ThreadTurnsListResponse>('thread/turns/list',{threadId,cursor,limit:HISTORY_TURN_PAGE,sortDirection:'desc',itemsView:'full'});check();
  if(!page||!Array.isArray(page.data)||page.data.length>HISTORY_TURN_PAGE||page.nextCursor!==null&&(typeof page.nextCursor!=='string'||!page.nextCursor)||!page.data.length&&page.nextCursor!==null)throw Error('回退范围分页无效');
  for(const turn of page.data){
   if(!validHistoryTurn(turn)||turn.itemsView!=='full'||turn.status==='inProgress'||seen.has(turn.id))throw Error('回退范围不完整或仍在运行');
   seen.add(turn.id);turns.push(turn);
   if(turn.id===turnId){
    const reply=turn.items.find(item=>item.id===itemId&&item.type==='agentMessage');
    if(turn.status!=='completed'||reply?.type!=='agentMessage'||typeof reply.text!=='string')throw Error('所选回复已变化，请重新选择');
    return {turns,preview:{count:turns.length,turnId,preview:reply.text.replace(/\s+/g,' ').slice(0,180)},fingerprint:JSON.stringify(turns)};
   }
  }
  if(page.nextCursor===null)break;
  if(cursors.has(page.nextCursor))throw Error('回退范围游标重复');cursors.add(page.nextCursor);cursor=page.nextCursor;
 }
 throw Error('未在受控范围内找到所选回合；请重新加载或选择更近的回合');
}
