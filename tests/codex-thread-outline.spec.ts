import {describe,it,expect,vi} from 'vitest';
import {ThreadOutline,OUTLINE_BATCH_PAGES} from '../src/codex-prototype/thread-outline';
import {ThreadHistory} from '../src/codex-prototype/thread-history';
import {Projection} from '../src/codex-prototype/state';
import {layoutRail,contentToRail,railToContent} from '../src/codex-prototype/display/turn-rail-layout';
import type {Thread} from '../src/codex-prototype/protocol/v2/Thread';
import type {Turn} from '../src/codex-prototype/protocol/v2/Turn';
import type {Transport} from '../src/codex-prototype/rpc';
const turn=(id:string)=>({id,status:'completed',itemsView:'summary',items:[{type:'userMessage',id:'user-'+id,content:[{type:'text',text:'用户问题 '+id}]}],error:null} as Turn);
const thread=(id='a',historyMode='paginated')=>({id,historyMode,turns:[]} as unknown as Thread);
const page=(data:Turn[],nextCursor:string|null=null)=>({data,nextCursor,backwardsCursor:null});
function setup(){const outline=new ThreadOutline(),projection=new Projection();projection.snapshot({...thread(),turns:[turn('latest')]});outline.reset(thread(),projection);return{outline,projection};}
const rpc=(request:ReturnType<typeof vi.fn>)=>({request} as unknown as Transport);
describe('public turn outline identity and bounded metadata scan',()=>{
 it('starts with disclosed projected nodes, then builds an ordered complete public ID table without loading body',async()=>{
  const f=setup();expect(f.outline.snapshot(f.projection)).toMatchObject({complete:false,hasMore:null});
  const request=vi.fn().mockResolvedValueOnce(page([turn('latest'),turn('middle')],'older')).mockResolvedValueOnce(page([turn('first')]));await f.outline.scan(rpc(request),f.projection,()=>true);
  expect(f.outline.snapshot(f.projection)).toMatchObject({complete:true,hasMore:false});expect(f.outline.snapshot(f.projection).nodes.map(v=>v.turnId)).toEqual(['first','middle','latest']);expect(f.outline.snapshot(f.projection).nodes[0]).toMatchObject({itemId:'user-first',label:'用户问题 first',loaded:false});expect([...f.projection.turns.keys()]).toEqual(['latest']);expect(request.mock.calls[0][1]).toMatchObject({itemsView:'summary',sortDirection:'desc'});
 });
 it('leaves the remainder explicit after the maximum batch and resumes with the exact cursor',async()=>{
  const f=setup(),request=vi.fn(async(_method,params)=>{const n=Number(params.cursor??0);return page([turn('t-'+(100-n))],String(n+1));});await f.outline.scan(rpc(request),f.projection,()=>true);
  expect(request).toHaveBeenCalledTimes(OUTLINE_BATCH_PAGES);expect(f.outline.snapshot(f.projection)).toMatchObject({complete:false,hasMore:true});await f.outline.scan(rpc(request),f.projection,()=>true);expect(request.mock.calls[OUTLINE_BATCH_PAGES][1].cursor).toBe(String(OUTLINE_BATCH_PAGES));
 });
 it('does not claim complete on a repeated cursor, malformed page or invalidation',async()=>{
  const f=setup(),request=vi.fn().mockResolvedValueOnce(page([turn('latest')],'repeat')).mockResolvedValueOnce(page([turn('first')],'repeat'));await f.outline.scan(rpc(request),f.projection,()=>true);expect(f.outline.error).toContain('未推进');expect(f.outline.snapshot(f.projection).complete).toBe(false);f.outline.invalidate('外部变化');expect(f.outline.snapshot(f.projection)).toMatchObject({complete:false,hasMore:null,error:'外部变化'});
 });
 it('uses a verified legacy full list without a speculative pagination call',async()=>{
  const f=setup();f.outline.reset(thread('a','legacy'),f.projection);const request=vi.fn();await f.outline.scan(rpc(request),f.projection,()=>true);expect(request).not.toHaveBeenCalled();expect(f.outline.snapshot(f.projection).complete).toBe(true);
 });
 it.each(['duplicate-final','missing-backwards'])('does not claim a full table for %s',async kind=>{
  const f=setup(),request=vi.fn().mockResolvedValueOnce(page([turn('latest')],'next')).mockResolvedValueOnce(kind==='duplicate-final'?page([turn('latest')]):{data:[turn('first')],nextCursor:null});
  await f.outline.scan(rpc(request),f.projection,()=>true);expect(f.outline.snapshot(f.projection).complete).toBe(false);expect(f.outline.error).not.toBe('');
 });
 it('drops an old scan after thread switch and never binds its IDs under the new thread',async()=>{
  const f=setup();let release!:(v:any)=>void;const request=vi.fn(()=>new Promise(r=>release=r));const task=f.outline.scan(rpc(request),f.projection,()=>true);f.projection.snapshot(thread('b'));f.outline.reset(thread('b'),f.projection);release(page([turn('old')]));await task;expect(f.outline.snapshot(f.projection).nodes).toEqual([]);expect(f.outline.loading).toBe(false);
 });
});
describe('outline body coverage follows public item pagination without claiming turn success',()=>{
 it.each(['summary','notLoaded'] as const)('keeps an existing %s projection pending even when it contains a user summary',itemsView=>{
  const f=setup();f.projection.snapshot({...thread(),turns:[{...turn('one'),itemsView}]});
  expect(f.outline.snapshot(f.projection).nodes).toEqual([{turnId:'one',itemId:'user-one',label:'用户问题 one',loaded:false,status:'completed'}]);
 });
 it('keeps partial body pending until the exact public item continuation reaches its end',async()=>{
  const f=setup(),history=new ThreadHistory();history.reset(thread());f.projection.snapshot(thread());
  const request=vi.fn().mockResolvedValueOnce(page([{...turn('one'),items:[]}]))
   .mockResolvedValueOnce({data:[{turnId:'one',item:turn('first').items[0]}],nextCursor:'body-tail',backwardsCursor:null})
   .mockResolvedValueOnce({data:[{turnId:'one',item:turn('last').items[0]}],nextCursor:null,backwardsCursor:'body-head'});
  expect(await history.older(rpc(request),f.projection,()=>true)).toBe(true);expect(f.outline.snapshot(f.projection).nodes[0]).toMatchObject({turnId:'one',loaded:false});
  expect(await history.items(rpc(request),f.projection,'one',()=>true)).toBe(true);expect([...f.projection.items.keys()]).toEqual(['user-first']);expect(history.snapshot(f.projection)).toMatchObject({incompleteTurns:['one'],complete:false});expect(f.outline.snapshot(f.projection).nodes[0]).toMatchObject({itemId:'user-first',loaded:false});
  expect(await history.items(rpc(request),f.projection,'one',()=>true)).toBe(true);expect(request.mock.calls[2][1]).toMatchObject({threadId:'a',turnId:'one',cursor:'body-tail',sortDirection:'asc'});expect([...f.projection.items.keys()]).toEqual(['user-first','user-last']);expect(history.snapshot(f.projection)).toMatchObject({incompleteTurns:[],complete:true});expect(f.outline.snapshot(f.projection).nodes[0]).toMatchObject({itemId:'user-first',loaded:true,status:'completed'});
 });
 it.each(['completed','failed','interrupted','inProgress'] as const)('reports full item coverage independently of the actual %s turn status',status=>{
  const f=setup();f.projection.snapshot({...thread(),turns:[{...turn('one'),itemsView:'full',status}]});expect(f.outline.snapshot(f.projection).nodes[0]).toMatchObject({loaded:true,status});
 });
 it('retains pending coverage and partial items when a later item page has a foreign identity',async()=>{
  const f=setup(),history=new ThreadHistory();history.reset(thread());f.projection.snapshot({...thread(),turns:[{...turn('one'),items:[]}]});
  const request=vi.fn().mockResolvedValueOnce({data:[{turnId:'one',item:turn('first').items[0]}],nextCursor:'tail',backwardsCursor:null}).mockResolvedValueOnce({data:[{turnId:'other',item:turn('foreign').items[0]}],nextCursor:null,backwardsCursor:null});
  expect(await history.items(rpc(request),f.projection,'one',()=>true)).toBe(true);expect(await history.items(rpc(request),f.projection,'one',()=>true)).toBe(false);expect(history.error).toContain('身份');expect([...f.projection.items.keys()]).toEqual(['user-first']);expect(f.outline.snapshot(f.projection).nodes[0]).toMatchObject({itemId:'user-first',loaded:false});
 });
 it('cannot promote the next thread from a delayed prior item completion',async()=>{
  const f=setup(),history=new ThreadHistory();history.reset(thread());f.projection.snapshot({...thread(),turns:[{...turn('one'),items:[]}]});let release!:(value:unknown)=>void;
  const task=history.items(rpc(vi.fn(()=>new Promise(r=>release=r))),f.projection,'one',()=>true);f.projection.snapshot({...thread('b'),turns:[{...turn('one'),items:[]}]});history.reset(thread('b'));f.outline.reset(thread('b'),f.projection);release({data:[{turnId:'one',item:turn('late').items[0]}],nextCursor:null,backwardsCursor:null});
  expect(await task).toBe(false);expect(f.projection.threadId).toBe('b');expect([...f.projection.items.keys()]).toEqual([]);expect(history.snapshot(f.projection).incompleteTurns).toEqual(['one']);expect(f.outline.snapshot(f.projection).nodes[0]).toMatchObject({turnId:'one',loaded:false});
 });
});
describe('DSH proportional rail mapping with real measured content geometry',()=>{
 it('does not advance the content axis for unloaded prefix nodes',()=>{
  const layout=layoutRail([undefined,undefined,0,1000],[true,true,false,false],500,2000,400);expect(layout.offsets).toEqual([0,0,0,1000]);expect(contentToRail(layout,0,1600)).toBe(layout.y[2]);expect(layout.thumbLen).toBeGreaterThanOrEqual(32);expect(layout.thumbLen).toBeLessThanOrEqual(72);
 });
 it('keeps the end continuous and the forward/reverse mapping monotonic at clamped last anchors',()=>{
  const layout=layoutRail([0,100,900,980],[false,false,false,false],500,1000,400),max=600;let prior=-1;
  for(let top=0;top<=max;top+=1){const y=contentToRail(layout,top,max);expect(y).toBeGreaterThanOrEqual(prior);expect(railToContent(layout,y,max)).toBeCloseTo(top,5);prior=y;}
  expect(railToContent(layout,Number.MAX_SAFE_INTEGER,max)).toBe(max);expect(railToContent(layout,200,0)).toBe(0);
 });
 it('fits a short rail to the viewport and makes a long rail independently scrollable',()=>{
  const short=layoutRail([0,400],[false,false],500,800,400),long=layoutRail(Array.from({length:100},(_,i)=>i*400),Array(100).fill(false),500,40000,400);expect(short.contentH).toBe(500);expect(long.contentH).toBeGreaterThan(500);expect(short.y.every(Number.isFinite)).toBe(true);expect(long.y.at(-1)).toBeGreaterThan(long.y[0]);
 });
});
