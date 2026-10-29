import {describe,expect,it,vi} from 'vitest';
import {ThreadOutline} from '../src/codex-prototype/thread-outline';
import {ThreadHistory} from '../src/codex-prototype/thread-history';
import {Projection} from '../src/codex-prototype/state';
import type {Thread} from '../src/codex-prototype/protocol/v2/Thread';
import type {Turn} from '../src/codex-prototype/protocol/v2/Turn';
import type {Transport} from '../src/codex-prototype/rpc';
const turn=(id:string,itemsView:Turn['itemsView']='full',status:Turn['status']='completed',text=id)=>({id,status,itemsView,items:[{type:'userMessage',id:'user-'+id,content:[{type:'text',text}]}],error:null} as Turn);
const thread=(id='a',turns:Turn[]=[])=>({id,historyMode:'paginated',turns} as Thread);
const page=(data:Turn[],nextCursor:string|null=null)=>({data,nextCursor,backwardsCursor:null});
const rpc=(request:ReturnType<typeof vi.fn>)=>({request} as unknown as Transport);
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};}
function fixture(){const projection=new Projection(),history=new ThreadHistory(),outline=new ThreadOutline();projection.snapshot(thread('a',[turn('t3')]));history.reset(thread());outline.reset(thread(),projection);return{projection,history,outline};}
const ids=(f:ReturnType<typeof fixture>)=>f.outline.snapshot(f.projection).nodes.map(n=>n.turnId);
describe('public outline, body pages and live notifications interleaving',()=>{
 it('keeps a new live turn and hydrated target while an older summary scan finishes',async()=>{
  const f=fixture(),head=deferred(),tail=deferred(),request=vi.fn().mockReturnValueOnce(head.promise).mockReturnValueOnce(tail.promise);
  const scan=f.outline.scan(rpc(request),f.projection,()=>true);head.resolve(page([turn('t3','summary'),turn('t2','summary')],'older'));
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));expect(ids(f)).toEqual(['t2','t3']);expect(f.outline.snapshot(f.projection).complete).toBe(false);
  const body=deferred(),bodyRequest=vi.fn(()=>body.promise),loading=f.history.older(rpc(bodyRequest),f.projection,()=>true,true);
  f.projection.apply({method:'turn/started',params:{threadId:'a',turn:turn('t4','full','inProgress','live t4')}} as any);
  body.resolve(page([turn('t3','summary','completed','stale t3'),turn('t2','summary')],'body-older'));expect(await loading).toBe(true);
  expect(f.projection.turns.get('t3')?.itemsView).toBe('full');expect(f.projection.items.get('user-t3')?.item).toMatchObject({content:[{text:'t3'}]});
  const items=vi.fn().mockResolvedValue({data:[{turnId:'t2',item:turn('t2','full','completed','hydrated t2').items[0]}],nextCursor:null,backwardsCursor:null});
  expect(await f.history.items(rpc(items),f.projection,'t2',()=>true)).toBe(true);tail.resolve(page([turn('t1','summary')]));await scan;
  expect(ids(f)).toEqual(['t1','t2','t3','t4']);expect(new Set(ids(f)).size).toBe(4);expect(f.outline.snapshot(f.projection)).toMatchObject({complete:true,loading:false});
  expect(f.outline.snapshot(f.projection).nodes.find(n=>n.turnId==='t2')).toMatchObject({loaded:true,label:'hydrated t2',itemId:'user-t2'});
  expect(f.outline.snapshot(f.projection).nodes.find(n=>n.turnId==='t4')).toMatchObject({loaded:true,status:'inProgress',label:'live t4'});expect(f.history.snapshot(f.projection).complete).toBe(false);
 });
 it.each(['old-first','new-first'])('does not let an old same-thread scan finish the replacement generation (%s)',async order=>{
  const f=fixture(),old=deferred(),fresh=deferred();const oldTask=f.outline.scan(rpc(vi.fn(()=>old.promise)),f.projection,()=>true);
  f.outline.invalidate('connection replaced');f.projection.snapshot(thread('a',[turn('current')]));f.outline.reset(thread(),f.projection);const freshTask=f.outline.scan(rpc(vi.fn(()=>fresh.promise)),f.projection,()=>true);
  if(order==='old-first'){old.resolve(page([turn('stale')]));await oldTask;expect(f.outline.loading).toBe(true);expect(ids(f)).toEqual(['current']);fresh.resolve(page([turn('current')]));await freshTask;}
  else{fresh.resolve(page([turn('current')]));await freshTask;old.resolve(page([turn('stale')]));await oldTask;}
  expect(ids(f)).toEqual(['current']);expect(f.outline.snapshot(f.projection)).toMatchObject({complete:true,loading:false,error:''});
 });
 it('keeps successful summary pages and exact continuation after a malformed tail, without duplicates on retry',async()=>{
  const f=fixture(),request=vi.fn().mockResolvedValueOnce(page([turn('t3','summary'),turn('t2','summary')],'older')).mockResolvedValueOnce(page([turn('bad'),turn('bad')]));
  await f.outline.scan(rpc(request),f.projection,()=>true);expect(ids(f)).toEqual(['t2','t3']);expect(f.outline.snapshot(f.projection)).toMatchObject({complete:false,hasMore:true});expect(f.outline.error).not.toBe('');
  const retry=vi.fn().mockResolvedValue(page([turn('t2','summary'),turn('t1','summary')]));await f.outline.scan(rpc(retry),f.projection,()=>true);expect(retry.mock.calls[0]![1]).toMatchObject({cursor:'older',threadId:'a'});expect(ids(f)).toEqual(['t1','t2','t3']);expect(f.outline.snapshot(f.projection)).toMatchObject({complete:true,error:''});
 });
 it('rejects a superseded body page while a completed outline remains only a table coverage claim',async()=>{
  const f=fixture();f.projection.snapshot(thread('a',[turn('t3','summary')]));await f.outline.scan(rpc(vi.fn().mockResolvedValue(page([turn('t3','summary')]))),f.projection,()=>true);
  const delayed=deferred(),loading=f.history.items(rpc(vi.fn(()=>delayed.promise)),f.projection,'t3',()=>true);
  f.projection.apply({method:'turn/completed',params:{threadId:'a',turn:turn('t3','full','failed','new authoritative body')}} as any);
  delayed.resolve({data:[{turnId:'t3',item:turn('t3','full','completed','stale body').items[0]}],nextCursor:null,backwardsCursor:null});expect(await loading).toBe(false);
  expect(f.history.error).toContain('状态已变化');expect(f.outline.snapshot(f.projection).nodes[0]).toMatchObject({turnId:'t3',loaded:true,status:'failed',label:'new authoritative body'});expect(f.outline.snapshot(f.projection).complete).toBe(true);
 });
 it('does not resurrect a late tail after cancellation and explicit invalidation',async()=>{
  const f=fixture(),tail=deferred(),request=vi.fn().mockResolvedValueOnce(page([turn('t3','summary')],'tail')).mockReturnValueOnce(tail.promise);let current=true;
  const task=f.outline.scan(rpc(request),f.projection,()=>current);await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));current=false;f.outline.invalidate('deleted or archived');tail.resolve(page([turn('stale')]));await task;
  expect(ids(f)).toEqual(['t3']);expect(f.outline.snapshot(f.projection)).toMatchObject({complete:false,hasMore:null,loading:false,error:'deleted or archived'});expect(f.projection.items.has('user-stale')).toBe(false);
 });
});
