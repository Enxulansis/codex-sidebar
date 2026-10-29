import {describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ThreadHistory} from '../src/codex-prototype/thread-history';
import {Projection} from '../src/codex-prototype/state';
import {Session} from '../src/codex-prototype/session';
import {Store} from '../src/codex-prototype/storage';
import {DISABLED_MCP,DISABLED_PLUGINS} from '../src/codex-prototype/tools';
import type {Transport} from '../src/codex-prototype/rpc';
import type {Thread} from '../src/codex-prototype/protocol/v2/Thread';
import type {Turn} from '../src/codex-prototype/protocol/v2/Turn';
const message=(id:string,text=id)=>({type:'agentMessage' as const,id,text,phase:null,memoryCitation:null,delivery:null,questions:null});
const turn=(id:string,itemsView='full',status='completed',items=[message('item-'+id)])=>({id,itemsView,status,items,error:null} as Turn);
const thread=(id='a',historyMode='paginated')=>({id,historyMode,cwd:'root',turns:[],status:{type:'idle'}} as unknown as Thread);
const page=(data:Turn[],nextCursor:string|null=null)=>({data,nextCursor,backwardsCursor:data.length?'reverse-anchor':null});
const rpc=(request:ReturnType<typeof vi.fn>)=>({request} as unknown as Transport);
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};}
function setup(){const history=new ThreadHistory(),projection=new Projection();history.reset(thread());projection.snapshot(thread());return{history,projection};}

describe('public cursor history, without private logs or model calls',()=>{
 it('loads descending pages into chronological rows and preserves an explicit end marker',async()=>{
  const f=setup(),request=vi.fn().mockResolvedValueOnce(page([turn('four'),turn('three')],'older')).mockResolvedValueOnce(page([turn('two'),turn('one')]));
  expect(await f.history.older(rpc(request),f.projection,()=>true)).toBe(true);expect([...f.projection.turns.keys()]).toEqual(['three','four']);expect(f.history.snapshot(f.projection)).toMatchObject({hasMore:true,complete:false,loadedTurns:2});
  await f.history.older(rpc(request),f.projection,()=>true);expect([...f.projection.items.values()].map(v=>v.turnId)).toEqual(['one','two','three','four']);expect(request.mock.calls[1][1]).toMatchObject({threadId:'a',cursor:'older',sortDirection:'desc',itemsView:'full'});expect(f.history.snapshot(f.projection)).toMatchObject({hasMore:false,complete:true});await f.history.older(rpc(request),f.projection,()=>true);expect(request).toHaveBeenCalledTimes(2);
 });
 it.each(['',{},undefined])('does not turn an invalid cursor %j into a complete history',async nextCursor=>{
  const f=setup();expect(await f.history.older(rpc(vi.fn().mockResolvedValue({...page([turn('one')]),nextCursor})),f.projection,()=>true)).toBe(false);expect(f.projection.turns.size).toBe(0);expect(f.history.snapshot(f.projection)).toMatchObject({hasMore:null,complete:false});
 });
 it('retains the prior window and continuation after a repeated cursor or failed read',async()=>{
  const f=setup(),request=vi.fn().mockResolvedValueOnce(page([turn('two')],'same')).mockResolvedValueOnce(page([turn('one')],'same')).mockRejectedValueOnce(Error('read failed'));
  await f.history.older(rpc(request),f.projection,()=>true);await f.history.older(rpc(request),f.projection,()=>true);expect(f.history.error).toContain('未推进');expect([...f.projection.turns.keys()]).toEqual(['two']);
  await f.history.older(rpc(request),f.projection,()=>true);expect(f.history.error).toBe('read failed');expect(f.history.snapshot(f.projection).hasMore).toBe(true);
 });
 it('does not turn an overlapping or empty continuation tail into false full coverage',async()=>{
  const f=setup(),request=vi.fn().mockResolvedValueOnce(page([turn('one')],'next')).mockResolvedValueOnce(page([turn('one')])).mockResolvedValueOnce(page([]));
  await f.history.older(rpc(request),f.projection,()=>true);for(let i=0;i<2;i++){await f.history.older(rpc(request),f.projection,()=>true);expect(f.history.snapshot(f.projection)).toMatchObject({hasMore:true,complete:false});expect(f.history.error).toContain('没有新回合');}
 });
 it('drops a response after a document expires and after another thread is selected',async()=>{
  const f=setup(),hold=deferred(),request=vi.fn(()=>hold.promise);let live=true;const pending=f.history.older(rpc(request),f.projection,()=>live);live=false;hold.resolve(page([turn('old')]));expect(await pending).toBe(false);expect(f.projection.turns.size).toBe(0);
  const second=deferred();request.mockReturnValueOnce(second.promise);live=true;const other=f.history.older(rpc(request),f.projection,()=>live);f.history.reset(thread('b'));f.projection.snapshot(thread('b'));second.resolve(page([turn('old')]));expect(await other).toBe(false);expect(f.projection.threadId).toBe('b');expect(f.history.snapshot(f.projection).hasMore).toBeNull();
 });
 it('keeps live deltas and terminal notifications when an older latest-page read returns late',async()=>{
  const f=setup(),hold=deferred(),request=vi.fn(()=>hold.promise);const pending=f.history.older(rpc(request),f.projection,()=>true,true);
  f.projection.apply({method:'turn/started',params:{threadId:'a',turn:turn('live','full','inProgress',[])}} as any);
  f.projection.apply({method:'item/started',params:{threadId:'a',turnId:'live',item:message('new','')}} as any);
  f.projection.apply({method:'item/agentMessage/delta',params:{threadId:'a',turnId:'live',itemId:'new',delta:'new delta'}} as any);
  hold.resolve(page([turn('live','full','inProgress',[message('new','stale')]),turn('old')]));await pending;
  expect((f.projection.items.get('new')!.item as any).text).toBe('new delta');expect([...f.projection.turns.keys()]).toEqual(['old','live']);
 });
 it('updates the latest observed turn after a fresh authoritative read if no live event intervenes',async()=>{
  const f=setup();f.projection.snapshot({...thread(),turns:[turn('one','full','inProgress',[message('item-one','old')])]});
  await f.history.older(rpc(vi.fn().mockResolvedValue(page([turn('one','full','completed',[message('item-one','final')])]))),f.projection,()=>true,true);
  expect(f.projection.activeTurn()).toBeUndefined();expect((f.projection.items.get('item-one')!.item as any).text).toBe('final');
 });
 it('rejects cross-turn item identity collisions atomically',async()=>{
  const f=setup();f.projection.snapshot({...thread(),turns:[turn('two','full','completed',[message('same')])]});
  await f.history.older(rpc(vi.fn().mockResolvedValue(page([turn('one','full','completed',[message('same')])]))),f.projection,()=>true);
  expect(f.history.error).toContain('冲突');expect([...f.projection.turns.keys()]).toEqual(['two']);expect(f.history.snapshot(f.projection).hasMore).toBeNull();
 });
 it('keeps summary/notLoaded explicit and pages actual item entries before declaring a full turn',async()=>{
  const f=setup(),request=vi.fn().mockResolvedValueOnce(page([turn('one','summary','completed',[])]));await f.history.older(rpc(request),f.projection,()=>true);
  expect(f.history.snapshot(f.projection)).toMatchObject({hasMore:false,incompleteTurns:['one'],complete:false});
  request.mockResolvedValueOnce({data:[{turnId:'one',item:message('a')}],nextCursor:'items-2',backwardsCursor:'back'}).mockResolvedValueOnce({data:[{turnId:'one',item:message('b')}],nextCursor:null,backwardsCursor:'back'});
  await f.history.items(rpc(request),f.projection,'one',()=>true);expect(f.projection.turns.get('one')?.itemsView).toBe('summary');expect(f.history.snapshot(f.projection).complete).toBe(false);
  await f.history.items(rpc(request),f.projection,'one',()=>true);expect(request.mock.calls[2][1]).toMatchObject({turnId:'one',cursor:'items-2',sortDirection:'asc'});expect([...f.projection.items.keys()]).toEqual(['a','b']);expect(f.history.snapshot(f.projection).complete).toBe(true);
 });
 it('rejects foreign item pages and does not hydrate a running turn',async()=>{
  const f=setup();f.projection.snapshot({...thread(),turns:[turn('one','notLoaded','completed',[]),turn('running','notLoaded','inProgress',[])]});const request=vi.fn().mockResolvedValue({data:[{turnId:'foreign',item:message('bad')}],nextCursor:null,backwardsCursor:'back'});
  expect(await f.history.items(rpc(request),f.projection,'running',()=>true)).toBe(false);expect(request).not.toHaveBeenCalled();await f.history.items(rpc(request),f.projection,'one',()=>true);expect(f.history.error).toContain('身份');expect(f.projection.items.has('bad')).toBe(false);
 });
 it('never labels an unknown history mode as legacy and clears coverage after invalidation',()=>{
  const f=setup();expect(()=>f.history.reset(thread('a','unknown'))).toThrow('未知');expect(f.history.snapshot(f.projection)).toMatchObject({hasMore:null,complete:false});f.history.reset(thread());f.history.invalidate('history changed');expect(f.history.snapshot(f.projection)).toMatchObject({hasMore:null,error:'history changed',complete:false});
 });
 it('does not call an active full view a final complete history',async()=>{
  const f=setup();await f.history.older(rpc(vi.fn().mockResolvedValue(page([turn('running','full','inProgress')]))),f.projection,()=>true);expect(f.history.snapshot(f.projection)).toMatchObject({hasMore:false,complete:false});
 });
});

describe('production Session restores the declared public history mode',()=>{
 function session(mode='paginated',preferences={loadAll:false,maxMessages:3000}){
  const root=mkdtempSync(join(tmpdir(),'codex-prototype-history-sim-')),store=new Store(join(root,'ledger.json')),transport=new EventEmitter() as any;store.own('a');const metadata={...thread('a',mode),cwd:root};
  transport.request=vi.fn(async(method:string,params:any)=>{
   if(method==='config/read')return{config:{features:{apps:false},apps:{_default:{enabled:false}},mcp_servers:Object.fromEntries(DISABLED_MCP.map(n=>[n,{enabled:false}])),plugins:Object.fromEntries(DISABLED_PLUGINS.map(n=>[n,{enabled:false}]))}};
   if(method==='mcpServerStatus/list')return{data:DISABLED_MCP.map(name=>({name,runtimeStatus:'disabled',tools:{},resources:[],resourceTemplates:[]})),nextCursor:null};
   if(method==='thread/read')return{thread:{...metadata,turns:params.includeTurns?[turn('one')]:[]}};
   if(method==='thread/resume')return{thread:{...metadata,turns:[]},cwd:root};
   if(method==='thread/turns/list')return page(params.cursor?[turn('older')]:[turn('one')],params.cursor?null:'older');
   throw Error('Unexpected '+method);
  });const s=new Session(transport,root,store,undefined,undefined,undefined,undefined,undefined,()=>({...preferences}));return{s,transport,metadata,store};
 }
 it('reads the available public pages on open when full initial loading is enabled, without sending',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:3000});await f.s.restore('a');expect([...f.s.projection.turns.keys()]).toEqual(['older','one']);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({hasMore:false,complete:true});expect(f.transport.request.mock.calls.filter((c:any)=>c[0]==='thread/turns/list')).toHaveLength(3);expect(f.store.read().attempts).toEqual([]);
 });
 it('hydrates completed summary bodies through real item pages during full initial loading',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:3000}),original=f.transport.request.getMockImplementation();f.transport.request.mockImplementation((method:string,params:any)=>method==='thread/turns/list'?Promise.resolve(page([turn('one','summary','completed',[])])):method==='thread/items/list'?Promise.resolve({data:[{turnId:'one',item:message(params.cursor?'b':'a')}],nextCursor:params.cursor?null:'more-items',backwardsCursor:'back'}):original(method,params));await f.s.restore('a');expect([...f.s.projection.items.keys()]).toEqual(['a','b']);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({hasMore:false,incompleteTurns:[],complete:true});expect(f.store.read().attempts).toEqual([]);
 });
 it('retains a successful initial page when a later automatic read fails and lets an explicit retry continue',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:3000}),original=f.transport.request.getMockImplementation();let fail=true;f.transport.request.mockImplementation((method:string,params:any)=>method==='thread/turns/list'&&params.cursor&&fail?Promise.reject(Error('合成后续页失败')):original(method,params));await f.s.restore('a');expect([...f.s.projection.turns.keys()]).toEqual(['one']);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({hasMore:true,complete:false,error:'合成后续页失败'});fail=false;await f.s.loadOlderHistory();expect([...f.s.projection.turns.keys()]).toEqual(['older','one']);expect(f.s.history.error).toBe('');expect(f.store.read().attempts).toEqual([]);
 });
 it('stops initial reads at the configured public-entry budget while manual pages remain available',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:500}),original=f.transport.request.getMockImplementation(),rows=Array.from({length:24},(_,i)=>turn('t'+i,'full','completed',Array.from({length:25},(_,j)=>message('item-'+i+'-'+j))));f.transport.request.mockImplementation((method:string,params:any)=>{if(method!=='thread/turns/list')return original(method,params);const start=Number(params.cursor??0),end=Math.min(rows.length,start+20);return Promise.resolve(page(rows.slice().reverse().slice(start,end),end<rows.length?String(end):null));});await f.s.restore('a');expect(f.s.projection.items.size).toBe(500);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({loadedTurns:20,hasMore:true,complete:false,initialLimit:500});expect(f.transport.request.mock.calls.filter((c:any)=>c[0]==='thread/turns/list')).toHaveLength(2);await f.s.loadOlderHistory();expect(f.s.projection.items.size).toBe(600);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({loadedTurns:24,hasMore:false,complete:true});expect(f.s.history.snapshot(f.s.projection).initialLimit).toBeUndefined();expect(f.store.read().attempts).toEqual([]);
 });
 it('counts empty public turns toward the initial budget instead of reading unbounded empty pages',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:500}),original=f.transport.request.getMockImplementation(),rows=Array.from({length:520},(_,i)=>turn('empty-'+i,'full','completed',[]));f.transport.request.mockImplementation((method:string,params:any)=>{if(method!=='thread/turns/list')return original(method,params);const start=Number(params.cursor??0),end=Math.min(rows.length,start+20);return Promise.resolve(page(rows.slice().reverse().slice(start,end),end<rows.length?String(end):null));});await f.s.restore('a');expect(f.s.projection.items.size).toBe(0);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({loadedTurns:500,hasMore:true,complete:false,initialLimit:500});expect(f.transport.request.mock.calls.filter((c:any)=>c[0]==='thread/turns/list')).toHaveLength(26);expect(f.store.read().attempts).toEqual([]);
 });
 it('retains a dense complete page past the automatic threshold instead of truncating a public turn',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:500}),original=f.transport.request.getMockImplementation(),rows=Array.from({length:24},(_,i)=>turn('dense-'+i,'full','completed',Array.from({length:100},(_,j)=>message('dense-'+i+'-'+j))));f.transport.request.mockImplementation((method:string,params:any)=>{if(method!=='thread/turns/list')return original(method,params);const start=Number(params.cursor??0),end=Math.min(rows.length,start+20);return Promise.resolve(page(rows.slice().reverse().slice(start,end),end<rows.length?String(end):null));});await f.s.restore('a');expect(f.s.projection.items.size).toBe(2000);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({loadedTurns:20,hasMore:true,initialLimit:500});expect(f.transport.request.mock.calls.filter((c:any)=>c[0]==='thread/turns/list')).toHaveLength(2);expect([...f.s.projection.turns.values()].every(t=>t.items.length===100)).toBe(true);expect(f.store.read().attempts).toEqual([]);
 });
 it('does not bypass restore checks after an initial page failure, and recovers through an explicit full restore',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:3000}),original=f.transport.request.getMockImplementation();let fail=true;f.transport.request.mockImplementation((method:string,params:any)=>method==='thread/turns/list'&&fail?Promise.reject(Error('首个公开分页失败')):original(method,params));await expect(f.s.restore('a')).rejects.toThrow('首个公开分页失败');expect(f.s.sendOutcomeUncertain).toBe(true);expect(f.s.toolCheck.verified).toBe(false);expect(f.transport.request.mock.calls.some((c:any)=>c[0]==='thread/resume')).toBe(false);fail=false;expect(await f.s.loadOlderHistory()).toBe(true);expect(f.s.sendOutcomeUncertain).toBe(true);expect(f.s.toolCheck.verified).toBe(false);await expect(f.s.send('不发送')).rejects.toThrow('恢复');expect(f.store.read().attempts).toEqual([]);await f.s.restore('a');expect(f.s.sendOutcomeUncertain).toBe(false);expect(f.s.toolCheck.verified).toBe(true);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({complete:true,loadedTurns:2});expect(f.store.read().attempts).toEqual([]);
 });
 it('does not hydrate a running partial turn or label its history complete during initial loading',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:3000}),original=f.transport.request.getMockImplementation();f.transport.request.mockImplementation((method:string,params:any)=>method==='thread/turns/list'?Promise.resolve(page([turn('running','summary','inProgress',[])])):original(method,params));await f.s.restore('a');expect(f.s.history.snapshot(f.s.projection)).toMatchObject({hasMore:false,incompleteTurns:['running'],complete:false});expect(f.transport.request.mock.calls.some((c:any)=>c[0]==='thread/items/list')).toBe(false);expect(f.s.busy).toBe(true);expect(f.store.read().attempts).toEqual([]);
 });
 it('rejects an automatic page after history invalidation without resurrecting coverage or send readiness',async()=>{
  const f=session('paginated',{loadAll:true,maxMessages:3000}),original=f.transport.request.getMockImplementation(),hold=deferred();f.transport.request.mockImplementation((method:string,params:any)=>method==='thread/turns/list'&&params.cursor?hold.promise:original(method,params));const task=f.s.restore('a'),rejected=expect(task).rejects.toThrow(/失效|核对/);await vi.waitFor(()=>expect(f.s.history.loading).toBe(true));await vi.waitFor(()=>expect(f.transport.request.mock.calls.some((c:any)=>c[0]==='thread/turns/list'&&c[1].cursor)).toBe(true));f.transport.emit('notification',{method:'thread/reverted',params:{threadId:'a'}});hold.resolve(page([turn('older')]));await rejected;expect(f.s.projection.turns.has('older')).toBe(false);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({hasMore:null,complete:false});expect(f.s.toolCheck.verified).toBe(false);expect(f.store.read().attempts).toEqual([]);
 });
 it('resumes paginated threads without full hydration and loads older history through the real session path',async()=>{
  const f=session();await f.s.restore('a');expect(f.transport.request.mock.calls.filter((c:any)=>c[0]==='thread/read').every((c:any)=>c[1].includeTurns===false)).toBe(true);expect(f.transport.request.mock.calls.find((c:any)=>c[0]==='thread/resume')[1].excludeTurns).toBe(true);
  expect(f.s.history.snapshot(f.s.projection).hasMore).toBe(true);await f.s.loadOlderHistory();expect([...f.s.projection.turns.keys()]).toEqual(['older','one']);expect(f.store.read().attempts).toHaveLength(0);expect(f.store.read().selected).toBe('a');
 });
 it('keeps a pending item page valid when 0.163 read-state metadata arrives without content changes',async()=>{
  const f=session(),original=f.transport.request.getMockImplementation(),hold=deferred();
  f.transport.request.mockImplementation((method:string,params:any)=>method==='thread/turns/list'?Promise.resolve(page([turn('one','summary','completed',[])])):method==='thread/items/list'?hold.promise:original(method,params));
  await f.s.restore('a');const revision=f.s.projection.revision,loading=f.s.loadTurnItems('one',()=>true);
  f.transport.emit('notification',{method:'thread/readState/changed',params:{threadId:'a',readState:{firstUnread:null,revision:'synthetic-read-state'}}});
  expect(f.s.projection.revision).toBe(revision);
  hold.resolve({data:[{turnId:'one',item:message('item-one','hydrated')}],nextCursor:null,backwardsCursor:'back'});await loading;
  expect(f.s.history.error).toBe('');expect((f.s.projection.items.get('item-one')?.item as any)?.text).toBe('hydrated');expect(f.s.history.snapshot(f.s.projection).complete).toBe(true);
  expect(f.transport.request.mock.calls.some((c:any)=>c[0]==='turn/start')).toBe(false);expect(f.store.read().attempts).toEqual([]);
 });
 it('materializes a real target using public older pages without sending a turn',async()=>{
  const f=session();await f.s.restore('a');expect(await f.s.materialize('older','item-older',()=>true)).toMatchObject({status:'loaded',itemId:'item-older'});expect(f.store.read().attempts).toEqual([]);
  expect(await f.s.materialize('one','item-older',()=>true)).toMatchObject({status:'unavailable'});
 });
 it('reports a target reached on the final allowed page, then bounds a further unresolved batch',async()=>{
  const f=session(),original=f.transport.request.getMockImplementation();f.transport.request.mockImplementation((method:string,params:any)=>method==='thread/turns/list'?Promise.resolve(page([turn('n'+(Number(params.cursor??9)))],Number(params.cursor??9)>0?String(Number(params.cursor??9)-1):null)):original(method,params));
  await f.s.restore('a');expect(await f.s.materialize('n1','item-n1',()=>true)).toMatchObject({status:'loaded'});expect(f.store.read().attempts).toEqual([]);
 });
 it('cancels a pending navigation without merging its late page',async()=>{
  const f=session();await f.s.restore('a');const hold=deferred(),original=f.transport.request.getMockImplementation();f.transport.request.mockImplementation((method:string,params:any)=>method==='thread/turns/list'?hold.promise:original(method,params));
  const task=f.s.materialize('older','item-older',()=>true);await vi.waitFor(()=>expect(f.s.history.loading).toBe(true));f.s.cancelNavigation();hold.resolve(page([turn('older')]));expect(await task).toMatchObject({status:'cancelled'});expect(f.s.projection.turns.has('older')).toBe(false);
 });
 it('keeps legacy public hydration for legacy data and declares no invented pages',async()=>{
  const f=session('legacy');await f.s.restore('a');expect(f.transport.request.mock.calls.some((c:any)=>c[0]==='thread/turns/list')).toBe(false);expect(f.transport.request.mock.calls.some((c:any)=>c[0]==='thread/read'&&c[1].includeTurns)).toBe(true);expect(f.s.history.snapshot(f.s.projection).hasMore).toBe(false);
 });
 it('rejects missing history mode without resume, model calls or budget changes',async()=>{
  const f=session();delete (f.metadata as any).historyMode;await expect(f.s.restore('a')).rejects.toThrow('模式未知');expect(f.transport.request.mock.calls.some((c:any)=>c[0]==='thread/resume'||c[0]==='turn/start')).toBe(false);expect(f.store.read().attempts).toEqual([]);expect(f.s.sendOutcomeUncertain).toBe(true);
 });
 it('invalidates coverage and approvals after an external history mutation notification',async()=>{
  const f=session('legacy');await f.s.restore('a');f.transport.emit('notification',{method:'thread/reverted',params:{threadId:'a'}});expect(f.s.sendOutcomeUncertain).toBe(true);expect(f.s.history.snapshot(f.s.projection)).toMatchObject({hasMore:null,complete:false});await expect(f.s.send('blocked')).rejects.toThrow('恢复');expect(f.store.read().attempts).toEqual([]);
 });
 it.each(['metadata','legacy-body','resume','tools'])('does not resurrect stale legacy history when invalidation arrives during %s',async stage=>{
  const f=session('legacy'),original=f.transport.request.getMockImplementation(),hold=deferred();let held=false,release!:()=>Promise<void>;
  f.transport.request.mockImplementation((method:string,params:any)=>{
   const matches=stage==='metadata'?method==='thread/read'&&!params.includeTurns:stage==='legacy-body'?method==='thread/read'&&params.includeTurns:stage==='resume'?method==='thread/resume':method==='mcpServerStatus/list';
   if(matches&&!held){held=true;release=async()=>hold.resolve(await original(method,params));return hold.promise;}return original(method,params);
  });
  const pending=f.s.restore('a'),rejected=expect(pending).rejects.toThrow(/代次|失效/);await vi.waitFor(()=>expect(held).toBe(true));
  f.transport.emit('notification',{method:'thread/reverted',params:{threadId:'a'}});await release();await rejected;
  expect(f.s.history.snapshot(f.s.projection)).toMatchObject({hasMore:null,complete:false});expect(f.s.sendOutcomeUncertain).toBe(true);expect(f.s.toolCheck.verified).toBe(false);expect(f.store.read().attempts).toEqual([]);
 });
});
