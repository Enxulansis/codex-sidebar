import {describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';
import {SearchCache,SEARCH_CACHE_KEY} from '../src/codex-prototype/search-cache';
import {ThreadCatalog} from '../src/codex-prototype/thread-catalog';
import {Session} from '../src/codex-prototype/session';
import {Store} from '../src/codex-prototype/storage';
import {stepSearchWalk,searchHitKey} from '../src/codex-prototype/search-walk';

const root='D:/archive-search-synthetic',turn=(id:string,text:string)=>({id,status:'completed',itemsView:'full',items:[{id:'item-'+id,type:'agentMessage',text,phase:'final_answer'}],error:null});
async function fixture(){
 const values=new Map<string,unknown>(),storage={get:<T>(k:string,fallback:T)=>structuredClone(values.has(k)?values.get(k):fallback)as T,update:vi.fn(async(k:string,v:unknown)=>{values.set(k,structuredClone(v));})};
 const cache=new SearchCache(storage,root),catalog=new ThreadCatalog(storage),store=new Store(join(mkdtempSync(join(tmpdir(),'codex-archive-search-')),'ledger.json'),1);
 const states=new Map(['a','b'].map(id=>[id,{id,cwd:root,name:id,updatedAt:1,historyMode:'paginated',status:{type:'idle'},turns:[],archived:false}]));
 for(const state of states.values()){store.own(state.id);await catalog.observe(state as any);}
 const capture=cache.begin('a','cached title');capture.node({turnId:'old',itemId:'item-old',label:'old'});capture.entry('old','item-old',[{kind:'正文',text:'OLD needle'}]);await cache.save(capture,()=>true);
 const rpc=Object.assign(new EventEmitter(),{request:vi.fn(async(method:string,p:any):Promise<any>=>{
  const thread=states.get(p.threadId);
  if(method==='thread/list')return{data:[...states.values()].filter(t=>t.archived===p.archived),nextCursor:null};
  if(!thread)throw Error('unknown synthetic thread');
  if(method==='thread/read')return{thread};
  if(method==='thread/turns/list')return{data:[turn('fresh-'+thread.id,'FRESH needle '+thread.id)],nextCursor:null,backwardsCursor:'back'};
  if(method==='thread/archive'){thread.archived=true;return{};}
  if(method==='thread/unarchive'){thread.archived=false;return{thread};}
  if(method==='thread/delete'){states.delete(thread.id);return{};}
  throw Error('Forbidden real execution/model request: '+method);
 }),dispose:vi.fn(async()=>{}),respond:vi.fn()});
 const make=()=>new Session(rpc as any,root,store,new ThreadCatalog(storage),undefined,undefined,undefined,new SearchCache(storage,root));
 const session=new Session(rpc as any,root,store,catalog,undefined,undefined,undefined,cache);session.projection.snapshot(states.get('b') as any);
 return{values,storage,cache,catalog,store,rpc,session,states,make};
}

describe('archived workspace hits retain only the existing bounded local snapshot',()=>{
 it('archive acknowledgement retains exact cache bytes, makes cached hits read-only, and performs no archive backfill',async()=>{
  const f=await fixture(),before=structuredClone(f.values.get(SEARCH_CACHE_KEY));
  await f.session.manageThread('archive','a',()=>true);f.rpc.request.mockClear();
  await f.session.searchHistory('needle','workspace',false,1,()=>true);
  expect(f.session.search.snapshot().hits).toMatchObject([{threadId:'b',cached:undefined},{threadId:'a',cached:true,archived:true,snippet:'OLD needle'}].map(({cached,...v})=>cached===undefined?v:{...v,cached}));
  expect(f.rpc.request.mock.calls.every(([,p])=>p.threadId==='b')).toBe(true);
  expect(new SearchCache(f.storage,root).read('a')).toEqual((before as any).records[0]);
  expect(f.session.search.snapshot().cacheNotice).not.toContain('尚未核实');
  await f.session.dispose();
 });
 it('archive-only searches neither read public bodies nor write/extend the cache across refresh and cold restart',async()=>{
  const f=await fixture();await f.session.manageThread('archive','a',()=>true);await f.session.manageThread('archive','b',()=>true);
  const before=structuredClone(f.values.get(SEARCH_CACHE_KEY));f.rpc.request.mockClear();f.storage.update.mockClear();
  await f.session.searchHistory('needle','workspace',false,1,()=>true);
  expect(f.session.search.snapshot()).toMatchObject({done:true,totalThreads:0,archivedCachedThreads:1,hits:[{threadId:'a',archived:true,cached:true}]});
  expect(f.rpc.request).not.toHaveBeenCalled();expect(f.storage.update).not.toHaveBeenCalled();
  await f.session.refreshThreads({archived:true});expect(f.rpc.request.mock.calls.map(([m])=>m)).toEqual(['thread/list']);
  await f.session.dispose();const cold=f.make();f.rpc.request.mockClear();
  await cold.searchHistory('needle','workspace',false,2,()=>true);expect(cold.search.snapshot().hits).toMatchObject([{threadId:'a',archived:true,cached:true}]);
  expect(f.rpc.request).not.toHaveBeenCalled();expect(f.values.get(SEARCH_CACHE_KEY)).toEqual(before);
  await cold.searchHistory('needle','thread',false,3,()=>true);expect(cold.search.snapshot().hits).toEqual([]);expect(f.rpc.request).not.toHaveBeenCalled();await cold.dispose();
 });
 it('unarchive returns to fresh public search, normal navigation, and later deletion clears the retained snapshot',async()=>{
  const f=await fixture();await f.session.manageThread('archive','a',()=>true);await f.session.manageThread('unarchive','a',()=>true);
  await f.session.searchHistory('needle','workspace',false,1,()=>true);expect(f.session.search.snapshot().hits.every(h=>!h.archived&&!h.cached)).toBe(true);
  expect(f.rpc.request.mock.calls.some(([m,p])=>m==='thread/turns/list'&&p.threadId==='a')).toBe(true);
  f.session.projection.snapshot({...f.states.get('a'),turns:[turn('visible','needle')]}as any);
  await expect(f.session.materialize('visible','item-visible',()=>true)).resolves.toMatchObject({status:'loaded'});
  f.session.projection.snapshot(f.states.get('b') as any);await f.session.manageThread('archive','a',()=>true);await f.session.manageThread('delete','a',()=>true);
  expect(new SearchCache(f.storage,root).read('a')).toBeUndefined();await f.session.dispose();
  const cold=f.make();f.rpc.request.mockClear();await cold.searchHistory('needle','workspace',false,2,()=>true);expect(cold.search.snapshot().hits.every(h=>h.threadId!=='a')).toBe(true);expect(f.rpc.request.mock.calls.every(([,p])=>p.threadId==='b')).toBe(true);await cold.dispose();
 });
 it('archiving without an existing cache never captures loaded text or reads the archived thread',async()=>{
  const f=await fixture();await f.session.manageThread('archive','a',()=>true);await f.session.manageThread('archive','b',()=>true);
  const before=structuredClone(f.values.get(SEARCH_CACHE_KEY));f.rpc.request.mockClear();await f.session.searchHistory('FRESH','workspace',false,1,()=>true);
  expect(f.session.search.snapshot().hits).toEqual([]);expect(f.cache.read('b')).toBeUndefined();expect(f.values.get(SEARCH_CACHE_KEY)).toEqual(before);expect(f.rpc.request).not.toHaveBeenCalled();await f.session.dispose();
 });
 it('owned archive notifications persist the status and reject an already in-flight body without further reads or cache writes',async()=>{
  const f=await fixture(),before=f.cache.read('a'),base=f.rpc.request.getMockImplementation()!;let release!:(v:any)=>void;
  f.rpc.request.mockImplementation(async(m,p)=>m==='thread/turns/list'&&p.threadId==='a'?new Promise(r=>release=r):base(m,p));
  const pending=f.session.searchHistory('needle','workspace',false,1,()=>true);await vi.waitFor(()=>expect(release).toBeTypeOf('function'),{interval:1,timeout:1000});
  const beforeCalls=f.rpc.request.mock.calls.filter(([,p])=>p.threadId==='a').length;
  f.rpc.emit('notification',{method:'thread/archived',params:{threadId:'a'}});
  expect(f.session.search.snapshot().hits).toMatchObject([{threadId:'a',cached:true,archived:true,snippet:'OLD needle'}]);
  release({data:[turn('late','EXTRA needle')],nextCursor:'more',backwardsCursor:'back'});await pending;
  await vi.waitFor(()=>expect(f.catalog.get('a')?.archived).toBe(true),{interval:1,timeout:1000});
  expect(f.cache.read('a')).toEqual(before);expect(f.rpc.request.mock.calls.filter(([,p])=>p.threadId==='a')).toHaveLength(beforeCalls);
  expect(f.session.search.snapshot().hits.filter(h=>h.threadId==='a')).toMatchObject([{cached:true,archived:true,snippet:'OLD needle'}]);await f.session.dispose();
 });
 it('archive/unarchive notifications invalidate an older pending response even if the source becomes active again',async()=>{
  const f=await fixture(),before=f.cache.read('a'),base=f.rpc.request.getMockImplementation()!;let release!:(v:any)=>void;
  f.rpc.request.mockImplementation(async(m,p)=>m==='thread/turns/list'&&p.threadId==='a'?new Promise(r=>release=r):base(m,p));
  const pending=f.session.searchHistory('needle','workspace',false,1,()=>true);await vi.waitFor(()=>expect(release).toBeTypeOf('function'),{interval:1,timeout:1000});
  f.rpc.emit('notification',{method:'thread/archived',params:{threadId:'a'}});f.rpc.emit('notification',{method:'thread/unarchived',params:{threadId:'a'}});
  release({data:[turn('late','EXTRA needle')],nextCursor:null,backwardsCursor:'back'});await pending;
  expect(f.cache.read('a')).toEqual(before);expect(f.session.search.snapshot().hits.every(h=>h.turnId!=='late')).toBe(true);await f.session.dispose();
 });
 it('does not continue an older search while the archive intent is waiting for storage acknowledgement',async()=>{
  const f=await fixture(),before=f.cache.read('a'),base=f.rpc.request.getMockImplementation()!,write=f.storage.update.getMockImplementation()!;
  let releaseRead!:(v:any)=>void,releaseWrite!:()=>void,held=false;
  f.rpc.request.mockImplementation(async(m,p)=>{if(m==='thread/read'&&p.threadId==='a'&&!held){held=true;return new Promise(r=>releaseRead=r);}return base(m,p);});
  const search=f.session.searchHistory('needle','workspace',false,1,()=>true);
  await vi.waitFor(()=>expect(releaseRead).toBeTypeOf('function'),{interval:1,timeout:1000});
  f.storage.update.mockImplementationOnce(async(k,v)=>{await new Promise<void>(r=>releaseWrite=r);await write(k,v);});
  const archive=f.session.manageThread('archive','a',()=>true);
  await vi.waitFor(()=>expect(releaseWrite).toBeTypeOf('function'),{interval:1,timeout:1000});
  releaseRead({thread:structuredClone(f.states.get('a'))});await search;
  const bodyReads=f.rpc.request.mock.calls.filter(([m,p])=>m==='thread/turns/list'&&p.threadId==='a');
  releaseWrite();await archive;
  expect(bodyReads).toEqual([]);expect(f.cache.read('a')).toEqual(before);await f.session.dispose();
 });
 it('host navigation rejects an archived selection without issuing public history reads',async()=>{
  const f=await fixture();await f.catalog.archiveUpdated('a',true);f.session.projection.snapshot(f.states.get('a')as any);f.rpc.request.mockClear();
  await expect(f.session.materialize('old','item-old',()=>true)).rejects.toThrow('归档');expect(f.rpc.request).not.toHaveBeenCalled();await f.session.dispose();
 });
});

describe('the production result renderer and keyboard both block archived navigation',()=>{
 it('labels and disables archived cached buttons, including an older hit whose catalog just changed',async()=>{
  const source=ts.createSourceFile('search-panel.ts',readFileSync(new URL('../src/codex-prototype/display/search-panel.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
  const cls=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='SearchPanel')as ts.ClassDeclaration;
  const methods=cls.members.filter(n=>ts.isMethodDeclaration(n)&&['archived','hitButton','activate'].includes(n.name.getText(source)));
  const code=ts.transpileModule('class Probe {'+methods.map(n=>n.getText(source)).join('\n')+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const node=(tag:string,_cls='',text=''):any=>({tag,textContent:text,dataset:{},children:[],classList:{toggle:vi.fn()},append(...children:any[]){this.children.push(...children);this.textContent+=children.map(c=>c.textContent??'').join('');}});
  const document={createElement:(tag:string)=>node(tag),createTextNode:(text:string)=>({textContent:text})};
  const Probe=new Function('node','key','document',code+';return Probe;')(node,searchHitKey,document),p=new Probe();
  p.state={threadId:'b',sessionCatalog:{recycle:[]}};p.hitRows=new Map();p.snippet=(text:string)=>node('span','',text);p.hitCount=()=> '1处';p.landing={cancel:vi.fn()};p.remember=vi.fn();
  const hit={threadId:'a',turnId:'old',itemId:'item-old',title:'a',kind:'正文',snippet:'needle',snippetLong:'needle',total:1,incomplete:false,cached:true as const,archived:true as const};
  const archived=p.hitButton(hit);expect(archived.disabled).toBe(true);expect(archived.children[0].textContent).toContain('已归档');await p.activate(hit);expect(p.landing.cancel).not.toHaveBeenCalled();
  const stale={...hit,archived:undefined};p.state.sessionCatalog.recycle=[{id:'a',archived:true}];expect(p.hitButton(stale).disabled).toBe(true);await p.activate(stale);expect(p.remember).not.toHaveBeenCalled();
  p.state.sessionCatalog.recycle=[];expect(p.hitButton({...hit,archived:undefined,cached:undefined}).disabled).toBe(false);
  expect(stepSearchWalk([hit],'',undefined)).toBeUndefined();expect(stepSearchWalk([hit,{...hit,threadId:'b',archived:undefined}],'',undefined)?.hit.threadId).toBe('b');
 });
});
