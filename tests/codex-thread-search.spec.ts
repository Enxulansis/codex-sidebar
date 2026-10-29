import {describe,it,expect,vi} from 'vitest';
import {parseSearchQuery,matchSearchText} from '../src/codex-prototype/search-query';
import {publicItemSearchSources} from '../src/codex-prototype/codex-search-text';
import {ThreadSearch,SEARCH_HIT_LIMIT} from '../src/codex-prototype/thread-search';
import type {Transport} from '../src/codex-prototype/rpc';
import {Session} from '../src/codex-prototype/session';
import {Store} from '../src/codex-prototype/storage';
import {ThreadCatalog,THREAD_CATALOG_KEY} from '../src/codex-prototype/thread-catalog';
import {EventEmitter} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root='D:/owned-search-root';
const agent=(id:string,text:string)=>({id,type:'agentMessage',text,phase:'final_answer'});
const turn=(id:string,text=id,itemsView='full',status='completed')=>({id,itemsView,status,items:[agent('item-'+id,text)],error:null});
function setup(sources:any={a:{mode:'paginated',turns:[turn('one','中文问题 HELLO hello'),turn('two','中文问题 不用'),turn('three','最新正文')]}}){
 const request=vi.fn(async(method:string,params:any)=>{
  const source=sources[params.threadId];if(!source)throw Error('no owned source');
  if(method==='thread/read')return{thread:{id:params.threadId,cwd:source.cwd??root,historyMode:source.mode,name:'标题 '+params.threadId,turns:params.includeTurns?source.turns:[]}};
  const offset=Number(params.cursor??0);if(method==='thread/turns/list'){const all=[...source.turns].reverse(),data=all.slice(offset,offset+2);return{data,nextCursor:offset+data.length<all.length?String(offset+data.length):null,backwardsCursor:data.length?'back':null};}
  if(method==='thread/items/list'){const all=source.items?.[params.turnId]??[],data=all.slice(offset,offset+2).map((item:any)=>({turnId:params.turnId,item}));return{data,nextCursor:offset+data.length<all.length?String(offset+data.length):null,backwardsCursor:data.length?'back':null};}
  throw Error('Forbidden search request '+method);
 });const search=new ThreadSearch({request} as unknown as Transport,root);return{search,request};
}
async function all(search:ThreadSearch){for(let i=0;i<100&&search.snapshot().hasMore;i++)await search.runBatch();expect(search.snapshot().done).toBe(true);}
describe('DSH literal search semantics over verified public content',()=>{
 it('uses public turn seconds for user/assistant search time and leaves missing source time absent',async()=>{const known={...turn('known','needle'),startedAt:2,completedAt:5,items:[{id:'user',type:'userMessage',content:[{type:'text',text:'needle'}]},agent('answer','needle')]},unknown={...turn('unknown','needle'),startedAt:null,completedAt:null},f=setup({a:{mode:'paginated',turns:[known,unknown]}});f.search.start('needle',['a'],'thread',false,()=>true);await all(f.search);const hits=f.search.snapshot().hits;expect(hits.find(v=>v.itemId==='answer')).toMatchObject({timeMs:5000});expect(hits.find(v=>v.itemId==='user')).toMatchObject({timeMs:2000});expect(hits.find(v=>v.turnId==='unknown')).not.toHaveProperty('timeMs');});
 it('retains word-boundary minus exclusions and literal substring/case matching',()=>{
  expect(parseSearchQuery('  hello world -不用 a-b ')).toEqual({include:'hello world a-b',excludes:['不用']});
  expect(matchSearchText([{kind:'正文',text:'HELLO hello'}],parseSearchQuery('hello'))).toMatchObject({total:2,kind:'正文'});expect(matchSearchText([{kind:'正文',text:'hello 不用'}],parseSearchQuery('hello -不用'))).toBeUndefined();expect(matchSearchText([{kind:'正文',text:'anything'}],parseSearchQuery('-不用'))).toBeUndefined();
 });
 it('never searches private reasoning/unknown JSON and keeps tools opt-in',()=>{
  expect(publicItemSearchSources({id:'r',type:'reasoning',summary:['secret']} as any,true)).toEqual([]);expect(publicItemSearchSources({id:'unknown',type:'future',secret:'body'} as any,true)).toEqual([]);
  const command={id:'c',type:'commandExecution',command:'Write-Output test',aggregatedOutput:'public output'} as any;expect(publicItemSearchSources(command)).toEqual([]);expect(publicItemSearchSources(command,true)).toEqual([{kind:'工具',field:'调用',text:'Write-Output test'},{kind:'工具',field:'结果',text:'public output'}]);expect(matchSearchText(publicItemSearchSources(command,true),parseSearchQuery('public output'))).toMatchObject({field:'结果'});
 });
 it('searches all actual public pages in newest-first order without a title-search shortcut',async()=>{
  const f=setup();f.search.start('中文问题 -不用',['a'],'thread',false,()=>true);await all(f.search);const state=f.search.snapshot();expect(state.complete).toBe(true);expect(state.hits.map(v=>v.turnId)).toEqual(['one']);expect(state.scannedTurns).toBe(3);expect(f.request.mock.calls.every(c=>['thread/read','thread/turns/list'].includes(c[0]))).toBe(true);expect(f.request.mock.calls.some(c=>c[0]==='thread/turns/list'&&c[1].cursor==='2')).toBe(true);
 });
 it('hydrates summary items through their own real cursor before claiming full-text coverage',async()=>{
  const f=setup({a:{mode:'paginated',turns:[turn('one','','summary')],items:{one:[agent('first','nonmatch'),agent('middle','nonmatch'),agent('last','hidden full needle')]}}});f.search.start('needle',['a'],'thread',false,()=>true);await all(f.search);expect(f.search.snapshot()).toMatchObject({complete:true,hits:[{itemId:'last',incomplete:false}]});expect(f.request.mock.calls.some(c=>c[0]==='thread/items/list'&&c[1].cursor==='2')).toBe(true);
 });
 it('keeps cross-workspace or missing sources explicit rather than reporting no matches',async()=>{
  const f=setup({a:{mode:'legacy',turns:[turn('one','needle')],cwd:'D:/foreign'},b:{mode:'legacy',turns:[turn('two','needle')]}});f.search.start('needle',['a','b'],'workspace',false,()=>true);await all(f.search);expect(f.search.snapshot()).toMatchObject({complete:false,scannedThreads:2});expect(f.search.snapshot().failures[0].threadId).toBe('a');expect(f.search.snapshot().hits.map(v=>v.threadId)).toEqual(['b']);expect(f.request.mock.calls.some(c=>c[0]==='thread/resume'||c[0]==='turn/start')).toBe(false);
 });
 it('does not claim completeness for running or partially returned legacy history',async()=>{
  const f=setup({a:{mode:'legacy',turns:[turn('one','needle','summary'),turn('running','needle','full','inProgress')]}});f.search.start('needle',['a'],'thread',false,()=>true);await all(f.search);expect(f.search.snapshot().complete).toBe(false);expect(f.search.snapshot().hits.every(hit=>hit.incomplete)).toBe(true);expect(f.request.mock.calls.every(c=>c[0]==='thread/read')).toBe(true);
 });
 it('bounds legacy processing per batch without rereading the full snapshot on continuation',async()=>{
  const f=setup({a:{mode:'legacy',turns:Array.from({length:450},(_,i)=>turn('t'+i,'no match'))}});f.search.start('needle',['a'],'thread',false,()=>true);await f.search.runBatch();expect(f.search.snapshot().hasMore).toBe(true);expect(f.search.snapshot().scannedTurns).toBe(200);await all(f.search);expect(f.search.snapshot().complete).toBe(true);expect(f.request).toHaveBeenCalledTimes(2);
 });
 it('drops delayed old-query data after a new query wins',async()=>{
  const f=setup(),original=f.request.getMockImplementation()!;let release!:(v:any)=>void;f.request.mockReturnValueOnce(new Promise(r=>release=r));f.search.start('old',['a'],'thread',false,()=>true);const old=f.search.runBatch();f.search.start('最新',['a'],'thread',false,()=>true);await all(f.search);release(await original('thread/read',{threadId:'a',includeTurns:false}));await old;expect(f.search.snapshot()).toMatchObject({query:'最新',complete:true,hits:[{turnId:'three'}]});
 });
 it('retains a cancellation/stale flag and never turns a partial snapshot into current official data',async()=>{
  const f=setup();f.search.start('hello',['a'],'thread',false,()=>true);await all(f.search);f.search.markStale('a');expect(f.search.snapshot()).toMatchObject({stale:true,complete:false});f.search.cancel();expect(f.search.snapshot()).toMatchObject({complete:false,done:true,error:'搜索已取消；结果仅覆盖已读范围'});
 });
 it('rejects repeated last pages and preserves already verified matches as incomplete',async()=>{
  const f=setup();f.request.mockImplementation(async(method:string,params:any)=>method==='thread/read'?{thread:{id:'a',cwd:root,historyMode:'paginated',turns:[]}}:({data:[turn('one','needle')],nextCursor:params.cursor?null:'repeat',backwardsCursor:'back'}));f.search.start('needle',['a'],'thread',false,()=>true);await all(f.search);expect(f.search.snapshot()).toMatchObject({complete:false,hits:[{turnId:'one'}]});expect(f.search.snapshot().failures[0].reason).toContain('未推进');
 });
 it('marks the result cap as incomplete and does not invent a full-match total',async()=>{
  const source={...turn('one'),items:Array.from({length:SEARCH_HIT_LIMIT+1},(_,i)=>agent('i'+i,'needle'))},f=setup({a:{mode:'legacy',turns:[source]}});f.search.start('needle',['a'],'thread',false,()=>true);await all(f.search);expect(f.search.snapshot()).toMatchObject({limited:true,complete:false});expect(f.search.snapshot().hits).toHaveLength(SEARCH_HIT_LIMIT);
 });
 it('makes no requests for a query containing only exclusions',async()=>{
  const f=setup();f.search.start('-排除',['a'],'thread',false,()=>true);await f.search.runBatch();expect(f.request).not.toHaveBeenCalled();expect(f.search.snapshot().complete).toBe(false);
 });
  it('does not claim a verified current thread when none is available',async()=>{
   const f=setup();f.search.start('needle',[],'thread',false,()=>true);await f.search.runBatch();expect(f.search.snapshot()).toMatchObject({done:true,complete:false,totalThreads:0});expect(f.search.snapshot().error).toContain('当前会话尚未核对');expect(f.request).not.toHaveBeenCalled();
  });
  it.each(['legacy','paginated'])('rejects duplicate turn identities within %s snapshots',async mode=>{
   const f=setup({a:{mode,turns:[turn('same','needle'),turn('same','different')]}});f.search.start('needle',['a'],'thread',false,()=>true);await all(f.search);expect(f.search.snapshot()).toMatchObject({complete:false,hits:[]});expect(f.search.snapshot().failures).toHaveLength(1);
  });
  it.each(['thread/turns/list','thread/items/list'])('drops the delayed %s response after cancellation',async blocked=>{
   const f=setup({a:{mode:'paginated',turns:[turn('one','','summary')],items:{one:[agent('hidden','needle')]}}}),original=f.request.getMockImplementation()!;let release!:(value:any)=>void,entered!:(value?:unknown)=>void;const waiting=new Promise(r=>entered=r);
   f.request.mockImplementation(async(method:string,params:any)=>{const value=await original(method,params);if(method===blocked){entered();return new Promise(r=>release=()=>r(value));}return value;});
   f.search.start('needle',['a'],'thread',false,()=>true);const pending=f.search.runBatch();await waiting;f.search.cancel();release(undefined);await pending;expect(f.search.snapshot()).toMatchObject({complete:false,done:true,hits:[]});
  });
 it('removes only the acknowledged deleted thread from retained query results and stops pending reads',async()=>{
  const f=setup({a:{mode:'legacy',turns:[turn('a','needle')]},b:{mode:'legacy',turns:[turn('b','needle')]}});f.search.start('needle',['a','b'],'workspace',false,()=>true);await all(f.search);f.search.forget('a');expect(f.search.snapshot().hits.map(hit=>hit.threadId)).toEqual(['b']);expect(f.search.snapshot()).toMatchObject({done:true,stale:true,complete:false});
 });
});
describe('production Session public search ownership and lifecycle',()=>{
 function session(){
  const f=setup(),transport=new EventEmitter() as any;transport.request=f.request;const dir=mkdtempSync(join(tmpdir(),'codex-prototype-search-sim-')),store=new Store(join(dir,'ledger.json'));
  for(const id of ['a','archived','deleted','pending'])store.own(id);store.select('a');
  const data={order:[],sort:'persisted',entries:[{id:'a',archived:false},{id:'archived',archived:true},{id:'deleted',archived:false,deleted:true},{id:'pending',archived:false,pending:{kind:'delete'}}].map(v=>({title:v.id,updatedAt:1,observed:true,...v}))},catalog=new ThreadCatalog({get:<T>(key:string,fallback:T)=>(key===THREAD_CATALOG_KEY?data:fallback) as T,update:async()=>{}});
  const s=new Session(transport,root,store,catalog);s.projection.snapshot({id:'a',cwd:root,historyMode:'paginated',turns:[]} as any);return{...f,s,transport,store};
 }
 it('searches only active acknowledged task-owned threads and preserves selection, attempts and execution state',async()=>{
  const f=session(),before=f.store.read();await f.s.searchHistory('中文','thread',false,4,()=>true);expect(f.s.search.snapshot()).toMatchObject({requestId:4,complete:true});expect(f.store.read()).toEqual(before);
  await f.s.searchHistory('中文','workspace',false,5,()=>true);expect(f.s.search.snapshot()).toMatchObject({totalThreads:1,complete:true});expect(f.request.mock.calls.every(c=>c[1].threadId==='a')).toBe(true);expect(f.s.projection.threadId).toBe('a');
 });
 it('marks query-period results stale after public content changes without overwriting them as fresh',async()=>{
  const f=session();await f.s.searchHistory('中文','thread',false,1,()=>true);f.transport.emit('notification',{method:'item/completed',params:{threadId:'a',turnId:'one',item:agent('item-one','changed')}});expect(f.s.search.snapshot()).toMatchObject({stale:true,complete:false});expect(f.s.search.snapshot().hits.length).toBeGreaterThan(0);expect(f.store.read().attempts).toEqual([]);
 });
  it('marks uncertain management and newly discovered workspace scope stale before reporting completeness',async()=>{
   const f=session();await f.s.searchHistory('中文','workspace',false,1,()=>true);vi.spyOn(f.s.catalog!,'mutate').mockRejectedValue(Error('response unknown'));
   await expect(f.s.manageThread('archive','a',()=>true)).rejects.toThrow('response unknown');expect(f.s.search.snapshot()).toMatchObject({stale:true,complete:false});
   await f.s.searchHistory('中文','workspace',false,2,()=>true);f.transport.emit('notification',{method:'thread/unarchived',params:{threadId:'archived'}});expect(f.s.search.snapshot()).toMatchObject({stale:true,complete:false});
   await f.s.searchHistory('中文','workspace',false,3,()=>true);vi.spyOn(f.s.catalog!,'list').mockResolvedValue(undefined);await f.s.refreshThreads();expect(f.s.search.snapshot()).toMatchObject({stale:true,complete:false});
  });
  it('ignores cancellation carrying an old query request ID',async()=>{
   const f=session(),original=f.request.getMockImplementation()!;let release!:(value:any)=>void;f.request.mockReturnValueOnce(new Promise(r=>release=r));const pending=f.s.searchHistory('中文','thread',false,2,()=>true);f.s.cancelSearch(1);expect(f.s.search.snapshot()).toMatchObject({requestId:2,hasMore:true});f.s.cancelSearch(2);release(await original('thread/read',{threadId:'a',includeTurns:false}));await pending;expect(f.s.search.snapshot()).toMatchObject({requestId:2,done:true,complete:false,hits:[]});
  });
});
