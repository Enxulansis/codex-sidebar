import {describe,it,expect,vi,afterEach} from 'vitest';
import {EventEmitter} from 'node:events';import {mkdtempSync} from 'node:fs';import {rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Session} from '../src/codex-prototype/session';import {Store} from '../src/codex-prototype/storage';import {DISABLED_MCP,DISABLED_PLUGINS} from '../src/codex-prototype/tools';
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const agent=(id:string,text=id)=>({id,type:'agentMessage',text,phase:'final_answer',questions:null,memoryCitation:null,delivery:null});
const turn=(thread:string,index:number)=>({id:thread+'-'+index,status:'completed',itemsView:'full',items:[agent('item-'+thread+'-'+index)],error:null});
// Isolate the existing bounded return-window contract with page-only opening.
// Full initial loading has separate production Session/page/budget coverage.
const pageOnly=()=>({loadAll:false,maxMessages:3000});
function fixture(count=60,preferences=pageOnly){
 const root=mkdtempSync(join(tmpdir(),'codex-read-window-')),store=new Store(join(root,'ledger.json')),rpc=new EventEmitter() as any,scenes=new Map<string,any[]>(),scans=new Map<string,number>();let mode='paginated';
 for(const id of ['a','b','c','d','e','f']){store.own(id);scenes.set(id,Array.from({length:count},(_,i)=>turn(id,i)));}
 const metadata=(id:string)=>({id,cwd:root,historyMode:mode,status:{type:'idle'},turns:[]});
 rpc.request=vi.fn(async(method:string,p:any)=>{
  if(method==='config/read')return{config:{features:{apps:false},apps:{_default:{enabled:false}},mcp_servers:Object.fromEntries(DISABLED_MCP.map(n=>[n,{enabled:false}])),plugins:Object.fromEntries(DISABLED_PLUGINS.map(n=>[n,{enabled:false}]))}};
  if(method==='mcpServerStatus/list')return{data:DISABLED_MCP.map(name=>({name,runtimeStatus:'disabled',tools:{},resources:[],resourceTemplates:[]})),nextCursor:null};
  if(method==='thread/read')return{thread:{...metadata(p.threadId),turns:p.includeTurns?structuredClone(scenes.get(p.threadId)):[]}};
  if(method==='thread/resume')return{thread:metadata(p.threadId),cwd:root};
  if(method==='thread/turns/list'){
   let offset=0,scan=scans.get(p.threadId)??0;
   if(p.cursor){const parts=p.cursor.split(':').map(Number);expect(parts[0]).toBe(scan);offset=parts[1];}else{scan++;scans.set(p.threadId,scan);}
   const data=structuredClone(scenes.get(p.threadId)!.toReversed().slice(offset,offset+p.limit)),next=offset+data.length;
   return{data,nextCursor:next<scenes.get(p.threadId)!.length?scan+':'+next:null,backwardsCursor:data.length?'back':null};
  }
  throw Error('Unexpected '+method);
 });rpc.dispose=vi.fn(async()=>{});const session=new Session(rpc,root,store,undefined,undefined,undefined,undefined,undefined,preferences);cleanup.push(async()=>{await session.dispose();await rm(root,{recursive:true,force:true});});
 const settled=()=>vi.waitFor(()=>{expect(session.history.loading).toBe(false);expect(session.status.startsWith('正在重读原阅读窗口')).toBe(false);});
 return{session,rpc,store,scenes,root,metadata,settled,restore:async(id:string)=>{await session.restore(id);await settled();},setMode:(v:string)=>mode=v,pages:()=>rpc.request.mock.calls.filter((c:any)=>c[0]==='thread/turns/list'),event:(method:string,params:any)=>rpc.emit('notification',{method,params})};
}
async function read(f:ReturnType<typeof fixture>,id='a',older=2){await f.restore(id);for(let i=0;i<older;i++)expect(await f.session.loadOlderHistory()).toBe(true);}
describe('same-connection bounded public reading range restoration',()=>{
 it('keeps full opening distinct from the bounded saved return range and reads fresh public bodies under either preference',async()=>{
  let loadAll=false;const f=fixture(200,()=>({loadAll,maxMessages:500}));await read(f,'a',4);expect(f.session.projection.turns.size).toBe(100);await f.restore('b');f.scenes.get('a')![0].items[0].text='fresh full-opening body';loadAll=true;const before=f.pages().length;await f.restore('a');expect(f.session.projection.turns.size).toBe(200);expect((f.session.projection.items.get('item-a-0')!.item as any).text).toBe('fresh full-opening body');expect(f.session.history.snapshot(f.session.projection)).toMatchObject({hasMore:false,complete:true});expect(f.pages().length-before).toBe(11);loadAll=false;await f.restore('b');expect(f.session.projection.turns.size).toBe(20);expect(f.session.history.snapshot(f.session.projection).hasMore).toBe(true);expect(f.store.read().attempts).toEqual([]);
 });
 it('returns to the previously read range using only new-scan cursors and freshly read content',async()=>{
  const f=fixture();await read(f);expect(f.session.projection.turns.size).toBe(60);await f.restore('b');f.scenes.get('a')![0].items[0].text='fresh public replacement';const before=f.pages().length;
  await f.restore('a');expect([...f.session.projection.turns.keys()]).toEqual(f.scenes.get('a')!.map(t=>t.id));expect((f.session.projection.items.get('item-a-0')!.item as any).text).toBe('fresh public replacement');
  const calls=f.pages().slice(before).map((c:any)=>c[1]);expect(calls).toHaveLength(4);expect(calls.slice(0,2).map((p:any)=>p.cursor)).toEqual([null,null]);expect(calls.slice(2).map((p:any)=>p.cursor)).toEqual(['4:20','4:40']);expect(f.session.status).toContain('重读原阅读窗口');expect(f.store.read().attempts).toEqual([]);
 });
 it('does not render cached bodies while the new public range read is still pending',async()=>{
  const f=fixture();await read(f);await f.restore('b');const original=f.rpc.request.getMockImplementation();let release!:(v:any)=>void,waiting=false;
  f.rpc.request.mockImplementation(async(method:string,p:any)=>{if(method==='thread/turns/list'&&p.threadId==='a'&&p.cursor){waiting=true;return new Promise(r=>release=async()=>r(await original(method,p)));}return original(method,p);});
  const task=f.restore('a');await vi.waitFor(()=>expect(waiting).toBe(true));expect(f.session.projection.items.has('item-a-0')).toBe(false);expect(f.session.isOperating).toBe(false);await expect(f.session.send('expired page',undefined,[],[],()=>false)).rejects.toThrow('失效');
  // Release each actually requested continuation, without starting another restore.
  await release(undefined);await vi.waitFor(()=>expect(f.session.projection.turns.size).toBe(40));await release(undefined);await task;expect(f.session.projection.items.has('item-a-0')).toBe(true);
 });
 it('does not revive a removed or changed historical row, and exposes a changed former boundary',async()=>{
  const f=fixture();await read(f);await f.restore('b');f.scenes.set('a',f.scenes.get('a')!.filter(t=>t.id!=='a-0'&&t.id!=='a-20'));f.scenes.get('a')![0].items=[agent('new-item','current source')];
  await f.restore('a');expect(f.session.projection.turns.size).toBe(58);expect(f.session.projection.items.has('item-a-0')).toBe(false);expect(f.session.projection.items.has('item-a-20')).toBe(false);expect(f.session.projection.items.has('item-a-1')).toBe(false);expect(f.session.projection.items.get('new-item')?.item).toMatchObject({text:'current source'});expect(f.session.status).toContain('原窗口边界已变化');expect(f.session.history.snapshot(f.session.projection)).toMatchObject({hasMore:false,complete:true});
 });
 it('keeps a failed optional window page explicit and permits one ordinary manual retry',async()=>{
  const f=fixture();await read(f);await f.restore('b');const original=f.rpc.request.getMockImplementation();let failed=false;
  f.rpc.request.mockImplementation((method:string,p:any)=>{if(method==='thread/turns/list'&&p.threadId==='a'&&p.cursor&&!failed){failed=true;throw Error('window page unavailable');}return original(method,p);});
  await f.restore('a');expect(f.session.projection.turns.size).toBe(20);expect(f.session.history.snapshot(f.session.projection)).toMatchObject({hasMore:true,complete:false,error:'window page unavailable'});expect(f.session.status).toContain('原窗口补读未完成');expect(f.session.sendOutcomeUncertain).toBe(false);expect(await f.session.loadOlderHistory()).toBe(true);expect(f.session.projection.turns.size).toBe(40);
 });
 it.each(['item/completed','turn/completed','thread/reverted','thread/archived','thread/deleted','thread/unarchived'])('invalidates the inactive range on %s without importing a foreign payload',async method=>{
  const f=fixture();await read(f);await f.restore('b');f.event(method,{threadId:'a',turnId:'a-0',item:agent('FOREIGN','do not import'),turn:turn('a',0)});const before=f.pages().length;await f.restore('a');expect(f.pages().length-before).toBe(2);expect(f.session.projection.turns.size).toBe(20);expect(f.session.projection.items.has('FOREIGN')).toBe(false);
 });
 it('evicts the least recently used range beyond four sessions',async()=>{
  const f=fixture();await read(f);for(const id of ['b','c','d','e'])await f.restore(id);const before=f.pages().length;await f.restore('a');expect(f.pages().length-before).toBe(2);expect(f.session.projection.turns.size).toBe(20);
 });
 it('bounds the restored range to the last 160 already read turns without changing first-open page size',async()=>{
  const f=fixture(200);await read(f,'a',9);expect(f.session.projection.turns.size).toBe(200);await f.restore('b');const before=f.pages().length;await f.restore('a');expect(f.session.projection.turns.size).toBe(160);expect([...f.session.projection.turns.keys()][0]).toBe('a-40');expect(f.pages().length-before).toBe(9);expect(f.pages().every((c:any)=>c[1].limit===20&&c[1].itemsView==='full')).toBe(true);expect(f.session.history.snapshot(f.session.projection).hasMore).toBe(true);
 });
 it('does not automatically chase a displaced boundary beyond eight current public pages',async()=>{
  const f=fixture();await read(f);await f.restore('b');f.scenes.set('a',Array.from({length:260},(_,i)=>turn('a',i)));const before=f.pages().length;
  await f.restore('a');expect(f.pages().length-before).toBe(9);expect(f.session.projection.turns.size).toBe(160);expect(f.session.projection.turns.has('a-0')).toBe(false);expect(f.session.history.snapshot(f.session.projection)).toMatchObject({hasMore:true,complete:false});expect(f.session.status).toContain('原窗口尚未到达');expect(f.session.history.error).toContain('可手动继续');
 });
 it('retains an unmatched running notice and live deltas but pauses for recovery without adopting its turn',async()=>{
  const f=fixture();await read(f);await f.restore('b');const original=f.rpc.request.getMockImplementation();let changed=false;
  f.rpc.request.mockImplementation(async(method:string,p:any)=>{const result=await original(method,p);if(method==='thread/turns/list'&&p.threadId==='a'&&p.cursor&&!changed){changed=true;f.event('turn/started',{threadId:'a',turn:{...turn('a',100),status:'inProgress',items:[]}});f.event('item/started',{threadId:'a',turnId:'a-100',item:agent('live','')});f.event('item/agentMessage/delta',{threadId:'a',turnId:'a-100',itemId:'live',delta:'new delta'});}return result;});
  await f.restore('a');expect(f.session.busy).toBe(false);expect(f.session.sendOutcomeUncertain).toBe(true);expect(f.session.status).toContain('当前归属待核对');expect((f.session.projection.items.get('live')!.item as any).text).toBe('new delta');expect(f.session.projection.turns.has('a-0')).toBe(false);expect(f.store.read().attempts).toEqual([]);expect(f.rpc.request.mock.calls.some((c:any)=>c[0]==='turn/interrupt')).toBe(false);const terminal=vi.fn();f.session.on('queue-terminal',terminal);f.event('turn/completed',{threadId:'a',turn:{...turn('a',100),items:[]}});expect(f.session.busy).toBe(false);expect(f.session.sendOutcomeUncertain).toBe(true);expect(terminal).not.toHaveBeenCalled();
 });
 it('discards a late optional window page after destructive invalidation without reporting successful range recovery',async()=>{
  const f=fixture();await read(f);await f.restore('b');const original=f.rpc.request.getMockImplementation();let release!:(v:any)=>void,waiting=false;
  f.rpc.request.mockImplementation(async(method:string,p:any)=>{if(method==='thread/turns/list'&&p.threadId==='a'&&p.cursor){waiting=true;return new Promise(r=>release=async()=>r(await original(method,p)));}return original(method,p);});
  const result=f.restore('a');await vi.waitFor(()=>expect(waiting).toBe(true));f.event('thread/reverted',{threadId:'a'});await release(undefined);await result;expect(f.session.sendOutcomeUncertain).toBe(true);expect(f.session.status).not.toContain('已重读原阅读窗口');expect(f.session.projection.items.has('item-a-0')).toBe(false);expect(f.session.history.snapshot(f.session.projection)).toMatchObject({hasMore:null,complete:false});expect(f.store.read().attempts).toEqual([]);
 });
 it.each(['navigation','canceled-send','cancel'])('lets %s permanently take over an optional range read before its late response',async action=>{
  const f=fixture();await read(f);await f.restore('b');const original=f.rpc.request.getMockImplementation();let release!:(v:any)=>Promise<void>,held=false;
  f.rpc.request.mockImplementation(async(method:string,p:any)=>{if(method==='thread/turns/list'&&p.threadId==='a'&&p.cursor&&!held){held=true;return new Promise(r=>release=async()=>r(await original(method,p)));}return original(method,p);});
  const task=f.restore('a');await vi.waitFor(()=>expect(held).toBe(true));expect(f.session.isOperating).toBe(false);
  if(action==='navigation'){f.session.cancelNavigation();expect(await f.session.materialize('a-0','item-a-0',()=>true)).toMatchObject({status:'waiting'});}
  else if(action==='canceled-send'){let checks=0;expect(await f.session.send('preparation canceled',undefined,[],[],()=>++checks===1)).toBe(false);}
  else await f.session.cancel();
  await release(undefined);await task;expect(f.session.projection.turns.size).toBe(20);expect(f.session.projection.items.has('item-a-0')).toBe(false);expect(f.store.read().attempts).toEqual([]);expect(f.rpc.request.mock.calls.some((c:any)=>c[0]==='turn/start')).toBe(false);
  expect(await f.session.materialize('a-0','item-a-0',()=>true)).toMatchObject({status:'loaded',itemId:'item-a-0'});
 });
 it('never lets a late unmatched start steal a local active attempt or erase its cancellation for queue completion',async()=>{
  const f=fixture(20);await f.restore('a');const original=f.rpc.request.getMockImplementation(),owned={...turn('a',100),id:'owned-active',status:'inProgress',items:[]};
  f.rpc.request.mockImplementation((method:string,p:any)=>method==='turn/start'?Promise.resolve({turn:owned}):method==='turn/interrupt'?Promise.resolve({}):original(method,p));
  expect(await f.session.send('synthetic owned input')).toBe(true);expect(f.session.busy).toBe(true);await f.session.cancel();const terminal=vi.fn();f.session.on('queue-terminal',terminal);const late={...turn('a',99),id:'unknown-old',status:'inProgress',items:[]};
  f.event('turn/started',{threadId:'a',turn:late});expect(f.session.busy).toBe(true);expect(f.session.sendOutcomeUncertain).toBe(true);expect(f.session.projection.activeTurn()).toBe('owned-active');
  f.event('turn/completed',{threadId:'a',turn:{...late,status:'completed'}});expect(terminal).not.toHaveBeenCalled();expect(f.session.busy).toBe(true);
  f.event('turn/completed',{threadId:'a',turn:{...owned,status:'completed'}});expect(terminal).toHaveBeenCalledExactlyOnceWith({threadId:'a',turnId:'owned-active',status:'completed',canceled:true});expect(f.session.busy).toBe(false);
  const attempts=f.store.read().attempts;expect(attempts).toHaveLength(1);expect(attempts[0]).toMatchObject({turnId:'owned-active',status:'completed'});expect(f.rpc.request.mock.calls.filter((c:any)=>c[0]==='turn/start')).toHaveLength(1);expect(f.rpc.request.mock.calls.filter((c:any)=>c[0]==='turn/interrupt')).toHaveLength(1);
 });
 it.each(['config/read','thread/resume','mcpServerStatus/list'])('does not clear an unmatched running notice received during restore %s',async phase=>{
  const f=fixture(20);await f.restore('b');const original=f.rpc.request.getMockImplementation();let release!:()=>Promise<void>,held=false;
  f.rpc.request.mockImplementation((method:string,p:any)=>{if(method===phase&&!held){held=true;return new Promise(r=>release=async()=>r(await original(method,p)));}return original(method,p);});
  const task=f.session.restore('a'),rejected=expect(task).rejects.toThrow(/失效|核对/);await vi.waitFor(()=>expect(held).toBe(true));const unknown={...turn('a',100),id:'unmatched-during-restore',status:'inProgress',items:[]};f.event('turn/started',{threadId:'a',turn:unknown});await release();await rejected;
  expect(f.session.sendOutcomeUncertain).toBe(true);expect(f.session.toolCheck.verified).toBe(false);expect(f.session.status).not.toBe('历史已恢复');expect(f.store.read().attempts).toEqual([]);expect(f.rpc.request.mock.calls.some((c:any)=>c[0]==='turn/interrupt'||c[0]==='turn/start')).toBe(false);
 });
 it('does not carry an in-memory range through a new connection or legacy hydration',async()=>{
  const f=fixture();await read(f);await f.restore('b');await f.session.dispose();const next=new Session(f.rpc,f.root,f.store,undefined,undefined,undefined,undefined,undefined,pageOnly);cleanup.push(()=>next.dispose());const before=f.pages().length;await next.restore('a');expect(f.pages().length-before).toBe(2);expect(next.projection.turns.size).toBe(20);await next.restore('b');f.setMode('legacy');await next.restore('a');expect(next.projection.turns.size).toBe(60);expect(next.history.snapshot(next.projection).mode).toBe('legacy');
 });
});
