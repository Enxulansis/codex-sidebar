import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Session} from '../src/codex-prototype/session';import {Store} from '../src/codex-prototype/storage';import {RpcRequestRejected} from '../src/codex-prototype/rpc';
import {CompactionHost} from '../src/codex-prototype/compaction-host';import {DISABLED_MCP,DISABLED_PLUGINS} from '../src/codex-prototype/tools';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const turn=(id='old',status='completed',items:any[]=[])=>({id,status,items,itemsView:'full',error:null,durationMs:null});
const item={type:'contextCompaction',id:'compact-item'};
function deferred<T=unknown>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};}
function fixture(options:{limit?:number;configGate?:Promise<unknown>;policy?:string}={}){
 const root=mkdtempSync(join(tmpdir(),'codex-compact-'));roots.push(root);const store=new Store(join(root,'ledger.json'),options.limit??12);store.own('a');
 if(options.policy)vi.spyOn(store,'dispatchReason').mockReturnValue(options.policy);
 const rpc=Object.assign(new EventEmitter(),{request:vi.fn(),respond:vi.fn(),reject:vi.fn(),dispose:vi.fn(async()=>{})}),ack=deferred(),config={config:{features:{apps:false},apps:{_default:{enabled:false}},mcp_servers:Object.fromEntries(DISABLED_MCP.map(name=>[name,{enabled:false}])),plugins:Object.fromEntries(DISABLED_PLUGINS.map(name=>[name,{enabled:false}]))}};
 const thread={id:'a',cwd:root,historyMode:'legacy',turns:[turn()]};
 rpc.request.mockImplementation(async(method:string,params:any)=>{
  if(method==='config/read'){if(options.configGate)await options.configGate;return config;}
  if(method==='mcpServerStatus/list')return{data:DISABLED_MCP.map(name=>({name,runtimeStatus:'disabled',tools:{},resources:[],resourceTemplates:[]})),nextCursor:null};
  if(method==='thread/compact/start')return ack.promise;
  if(method==='turn/interrupt')return{};
  if(method==='thread/read')return{thread};
  if(method==='thread/resume')return{thread,cwd:root,model:'m',reasoningEffort:'low'};
  if(method==='thread/start')return{thread:{...thread,id:'b'},cwd:root,model:'m',reasoningEffort:'low'};
  throw Error('Unexpected synthetic request '+method+' '+JSON.stringify(params));
 });
 const session=new Session(rpc as never,root,store);session.on('change',()=>{});session.projection.snapshot(thread as never);session.toolCheck={verified:true,threadId:'a',reason:'initial synthetic check'};session.model='m';
 const pause=vi.fn(),terminal=vi.fn();session.on('queue-pause',pause);session.on('queue-terminal',terminal);
 const emit=(method:string,params:object)=>rpc.emit('notification',{method,params:{threadId:'a',...params}});
 const callCount=(method:string)=>rpc.request.mock.calls.filter(([name])=>name===method).length;
 const startTurn=(id='maintenance')=>emit('turn/started',{turn:turn(id,'inProgress')});
 const startItem=(id='maintenance')=>emit('item/started',{turnId:id,item});
 const finishItem=(id='maintenance')=>emit('item/completed',{turnId:id,item});
 const finishTurn=(id='maintenance',status='completed',items:any[]=[])=>emit('turn/completed',{turn:turn(id,status,items)});
 return{root,store,rpc,ack,config,thread,session,pause,terminal,emit,callCount,startTurn,startItem,finishItem,finishTurn};
}
async function begin(f:ReturnType<typeof fixture>,current:()=>boolean=()=>true){const result=f.session.compact(current);await vi.waitFor(()=>expect(f.callCount('thread/compact/start')).toBe(1));return{result};}
describe('manual compaction through the production Session and real temporary ledger',()=>{
 it('reserves exactly once after a fresh isolation check and sends only threadId; ACK does not finish',async()=>{
  const f=fixture(),{result}=await begin(f);expect(f.rpc.request.mock.calls.slice(0,3).map(([method])=>method)).toEqual(['config/read','mcpServerStatus/list','thread/compact/start']);
  expect(f.rpc.request.mock.calls[2]![1]).toEqual({threadId:'a'});expect(f.store.read().attempts).toMatchObject([{purpose:'compact',status:'compact:requesting'}]);expect(f.pause).toHaveBeenCalledOnce();
  f.ack.resolve({});await result;expect(f.session.compactionView()).toMatchObject({phase:'accepted',active:true,canStart:false});expect(f.session.busy).toBe(true);expect(f.session.isOperating).toBe(true);expect(f.terminal).not.toHaveBeenCalled();
 });
 it('waits for both an identified completed item and terminal, preserving normal history and model settings',async()=>{
  const f=fixture(),{result}=await begin(f);f.ack.resolve({});await result;f.startTurn();expect(f.session.sendOutcomeUncertain).toBe(false);f.startItem();expect(f.session.compactionView().phase).toBe('running');f.finishItem();expect(f.session.busy).toBe(true);f.finishTurn();
  expect(f.session.compactionView()).toMatchObject({phase:'completed',active:false,canStart:true,turnId:'maintenance'});expect(f.session.busy).toBe(false);expect(f.session.isOperating).toBe(false);expect(f.session.model).toBe('m');expect(f.session.projection.turns.has('old')).toBe(true);expect(f.terminal).not.toHaveBeenCalled();expect(f.callCount('turn/start')).toBe(0);expect(f.store.read().attempts).toMatchObject([{turnId:'maintenance',status:'completed'}]);
 });
 it('handles item/terminal events before ACK and never reopens after the late acceptance',async()=>{
  const f=fixture(),{result}=await begin(f);f.startTurn();f.startItem();f.finishItem();f.finishTurn();expect(f.session.compactionView().phase).toBe('completed');f.ack.resolve({});await result;expect(f.session.compactionView().phase).toBe('completed');expect(f.session.busy).toBe(false);expect(f.callCount('thread/compact/start')).toBe(1);
 });
 it('accepts a complete terminal payload but does not infer item completion from an empty terminal payload',async()=>{
  const f=fixture(),{result}=await begin(f);f.startTurn();f.startItem();f.finishTurn();expect(f.session.compactionView().phase).toBe('running');expect(f.store.read().attempts[0]!.status).toBe('compact:running');expect(f.session.busy).toBe(true);f.finishItem();expect(f.session.compactionView().phase).toBe('completed');expect(f.store.read().attempts[0]!.status).toBe('completed');f.ack.resolve({});await result;
  const other=fixture(),p=await begin(other);other.finishTurn('maintenance','completed',[item]);expect(other.session.compactionView().phase).toBe('completed');other.ack.resolve({});await p.result;
 });
 it.each(['failed','interrupted'])('settles an identified %s terminal without claiming success',async status=>{const f=fixture(),{result}=await begin(f);f.startTurn();f.startItem();f.finishTurn('maintenance',status);expect(f.session.compactionView().phase).toBe(status);expect(f.session.busy).toBe(false);f.ack.resolve({});await result;});
 it('does not adopt old or foreign compaction items or deprecated thread/compacted notices',async()=>{
  const f=fixture(),{result}=await begin(f);f.emit('item/completed',{threadId:'foreign',turnId:'foreign',item});f.emit('item/completed',{turnId:'old',item});f.emit('thread/compacted',{});expect(f.session.compactionView().phase).toBe('requesting');expect(f.store.read().attempts[0]!.turnId).toBeUndefined();f.ack.resolve({});await result;
 });
 it('stops before submission without reserving or interrupting and preserves the confirmed tool check',async()=>{
  const gate=deferred(),f=fixture({configGate:gate.promise}),pending=f.session.compact();await f.session.cancel();expect(f.session.compactionView().phase).toBe('canceled');expect(f.session.toolCheck).toMatchObject({verified:true,reason:'initial synthetic check'});gate.resolve({});await pending;expect(f.store.read().attempts).toHaveLength(0);expect(f.callCount('thread/compact/start')).toBe(0);expect(f.callCount('turn/interrupt')).toBe(0);expect(f.session.busy).toBe(false);
 });
 it('page loss during preparation cancels without any model dispatch',async()=>{const gate=deferred(),f=fixture({configGate:gate.promise});let current=true;const pending=f.session.compact(()=>current);current=false;gate.resolve({});await pending;expect(f.session.compactionView().phase).toBe('canceled');expect(f.store.read().attempts).toHaveLength(0);expect(f.callCount('thread/compact/start')).toBe(0);});
 it('freezes the known-turn baseline at actual dispatch so preparation-era completed turns cannot capture late ownership',async()=>{
  const gate=deferred(),f=fixture({configGate:gate.promise}),result=f.session.compact();f.finishTurn('preparation-era');gate.resolve({});await vi.waitFor(()=>expect(f.callCount('thread/compact/start')).toBe(1));
  f.emit('item/completed',{turnId:'preparation-era',item:{type:'agentMessage',id:'late-normal',text:'late ordinary text'}});f.finishTurn('maintenance','completed',[item]);expect(f.session.compactionView().phase).toBe('completed');f.ack.resolve({});await result;
 });
 it('ignores multiple compaction items from an already known old turn without invalidating the new request',async()=>{
  const f=fixture(),{result}=await begin(f);f.emit('turn/completed',{turn:turn('old','completed',[{type:'contextCompaction',id:'old-1'},{type:'contextCompaction',id:'old-2'}])});expect(f.session.compactionView().phase).toBe('requesting');f.ack.resolve({});await result;
 });
 it('Stop releases a completed turn awaiting a missing item as unknown without interrupting an ended turn',async()=>{
  const f=fixture(),{result}=await begin(f);f.startTurn();f.startItem();f.finishTurn();expect(f.session.busy).toBe(true);await f.session.cancel();expect(f.session.busy).toBe(false);expect(f.session.isOperating).toBe(false);expect(f.session.compactionView().phase).toBe('unknown');expect(f.session.sendOutcomeUncertain).toBe(true);expect(f.callCount('turn/interrupt')).toBe(0);f.ack.resolve({});await result;
 });
 it('Stop before a public item does not interrupt an arbitrary new turn; a later verified item can be stopped once',async()=>{
  const f=fixture(),{result}=await begin(f);f.startTurn();await f.session.cancel();expect(f.callCount('turn/interrupt')).toBe(0);expect(f.session.compactionView().phase).toBe('unknown');expect(f.session.sendOutcomeUncertain).toBe(true);f.startItem();await Promise.resolve();expect(f.rpc.request.mock.calls.filter(([method])=>method==='turn/interrupt')).toEqual([['turn/interrupt',{threadId:'a',turnId:'maintenance'}]]);f.finishItem();f.finishTurn();f.ack.resolve({});await result;expect(f.session.compactionView().phase).toBe('unknown');expect(f.callCount('turn/interrupt')).toBe(1);expect(f.session.sendOutcomeUncertain).toBe(true);
 });
 it('Stop after identification interrupts that exact turn and keeps the lock until its terminal',async()=>{
  const f=fixture(),{result}=await begin(f);f.startTurn();f.startItem();await f.session.cancel();expect(f.session.compactionView().phase).toBe('canceling');expect(f.session.busy).toBe(true);f.finishTurn('maintenance','interrupted');expect(f.session.compactionView().phase).toBe('interrupted');expect(f.session.busy).toBe(false);f.ack.resolve({});await result;expect(f.callCount('turn/interrupt')).toBe(1);
 });
 it('never releases a later new-thread operation when an old ACK returns',async()=>{
  const f=fixture(),{result}=await begin(f);await f.session.cancel();const gate=deferred(),original=f.rpc.request.getMockImplementation()!;f.rpc.request.mockImplementation(async(method:string,params:any)=>{if(method==='config/read')await gate.promise;return original(method,params);});
  const next=f.session.newThread();expect(f.session.isOperating).toBe(true);f.ack.resolve({});await result;expect(f.session.isOperating).toBe(true);gate.resolve({});await next;expect(f.session.projection.threadId).toBe('b');expect(f.session.compactionView().phase).toBeUndefined();
 });
 it('a failed compact interrupt becomes unknown once and public events never automatically retry it',async()=>{
  const f=fixture(),{result}=await begin(f),original=f.rpc.request.getMockImplementation()!;f.rpc.request.mockImplementation(async(method:string,params:any)=>{if(method==='turn/interrupt')throw Error('interrupt rejected');return original(method,params);});
  f.startTurn();f.startItem();await f.session.cancel();expect(f.session.compactionView().phase).toBe('unknown');expect(f.session.busy).toBe(false);f.finishItem();await f.session.cancel();expect(f.callCount('turn/interrupt')).toBe(1);expect(f.session.sendOutcomeUncertain).toBe(true);f.ack.resolve({});await result;
 });
 it('does not revive old compaction ownership after an explicit same-thread restore',async()=>{
  const f=fixture(),{result}=await begin(f);await f.session.cancel();await f.session.restore('a');expect(f.session.sendOutcomeUncertain).toBe(false);f.ack.resolve({});await result;expect(f.session.compactionView().phase).toBeUndefined();f.startTurn();expect(f.session.sendOutcomeUncertain).toBe(true);
 });
 it('reports an explicit rejection without resetting the reservation or retrying',async()=>{
  const f=fixture(),{result}=await begin(f);f.ack.reject(new RpcRequestRejected('not available'));await expect(result).rejects.toThrow('not available');expect(f.session.compactionView().phase).toBe('rejected');expect(f.session.sendOutcomeUncertain).toBe(false);expect(f.session.busy).toBe(false);expect(f.store.read().attempts).toHaveLength(1);expect(f.callCount('thread/compact/start')).toBe(1);
 });
 it.each(['disconnect','ambiguous','malformed'])('keeps %s results unknown and cannot automatically resend',async kind=>{
  const f=fixture(),{result}=await begin(f);if(kind==='disconnect'){f.rpc.emit('disconnect',Error('lost'));f.ack.reject(Error('lost'));}else if(kind==='ambiguous')f.ack.reject(Error('unknown delivery'));else f.ack.resolve({unexpected:true});
  if(kind==='disconnect')await result;else await expect(result).rejects.toThrow();expect(f.session.compactionView().phase).toBe('unknown');expect(f.session.sendOutcomeUncertain).toBe(true);expect(f.session.busy).toBe(false);expect(f.session.isOperating).toBe(false);expect(f.callCount('thread/compact/start')).toBe(1);
 });
 it.each(['thread/archived','thread/reverted','thread/deleted'])('invalidates a submitted operation on %s without stale receipt changes',async method=>{
  const f=fixture(),{result}=await begin(f);f.emit(method,{});const status=f.session.status;f.ack.resolve({});await result;expect(f.session.status).toBe(status);expect(f.session.busy).toBe(false);expect(f.session.isOperating).toBe(false);expect(f.callCount('thread/compact/start')).toBe(1);
 });
 it('multiple new turns make ownership unknown and never interrupt either without verified identity',async()=>{
  const f=fixture(),{result}=await begin(f);f.startTurn('one');f.startTurn('two');expect(f.session.compactionView().phase).toBe('unknown');await f.session.cancel();f.startItem('two');expect(f.callCount('turn/interrupt')).toBe(0);f.ack.resolve({});await result;
 });
 it('does not grant extra approval or user-input requests during compaction',async()=>{
  const f=fixture(),{result}=await begin(f);f.startTurn();f.startItem();f.rpc.emit('request',{id:1,method:'item/commandExecution/requestApproval',params:{threadId:'a',turnId:'maintenance'}});await Promise.resolve();expect(f.rpc.respond).toHaveBeenCalledWith(1,{decision:'decline'});expect(f.session.approvals.size).toBe(0);expect(f.callCount('turn/interrupt')).toBe(1);f.ack.resolve({});await result;
 });
 it('refuses quota/policy/isolation failures before model dispatch without destroying existing attempts',async()=>{
  const exhausted=fixture({limit:1});exhausted.store.reserve('a','text/tool');await expect(exhausted.session.compact()).rejects.toThrow('预算');expect(exhausted.callCount('thread/compact/start')).toBe(0);expect(exhausted.store.read().attempts).toHaveLength(1);
  const policy=fixture({policy:'connection-only'});await expect(policy.session.compact()).rejects.toThrow('connection-only');expect(policy.rpc.request).not.toHaveBeenCalled();
  const bad=fixture();bad.config.config.features.apps=true;await expect(bad.session.compact()).rejects.toThrow('禁用状态');expect(bad.store.read().attempts).toHaveLength(0);expect(bad.callCount('thread/compact/start')).toBe(0);
 });
 it('blocks duplicate compaction, send and steering while the maintenance operation owns the session',async()=>{
  const f=fixture(),{result}=await begin(f);await expect(f.session.compact()).rejects.toThrow('结束');await expect(f.session.send('keep draft')).rejects.toThrow('恢复');expect(f.session.steerableTurnId).toBeUndefined();expect(f.store.read().attempts).toHaveLength(1);f.ack.resolve({});await result;
 });
});
describe('compaction page lease and monotonic requests',()=>{
 it('ignores replayed identifiers and stale owners; a replaced page cannot submit after metadata preparation',async()=>{
  const gate=deferred(),f=fixture({configGate:gate.promise});let current=true;const host=new CompactionHost(()=>({session:f.session,connectionId:3}),()=>current),replies:any[]=[],message={type:'compact',id:1,threadId:'a',connectionId:3};
  const pending=host.handle(message,m=>replies.push(m));current=false;gate.resolve({});await pending;expect(f.callCount('thread/compact/start')).toBe(0);expect(replies).toEqual([]);current=true;await host.handle(message,m=>replies.push(m));expect(f.callCount('thread/compact/start')).toBe(0);
 });
 it('keeps submitted progress across page replacement and suppresses its old receipt',async()=>{
  const f=fixture();let current=true;const host=new CompactionHost(()=>({session:f.session,connectionId:3}),()=>current),replies:any[]=[];
  const pending=host.handle({type:'compact',id:1,threadId:'a',connectionId:3},m=>replies.push(m));await vi.waitFor(()=>expect(f.callCount('thread/compact/start')).toBe(1));current=false;f.ack.resolve({});await pending;expect(replies).toEqual([]);expect(f.session.compactionView().phase).toBe('accepted');f.startTurn();f.startItem();f.finishItem();f.finishTurn();expect(f.session.compactionView().phase).toBe('completed');
 });
});
