import {describe,it,expect,vi} from 'vitest';
import {ThreadCatalog,THREAD_CATALOG_KEY} from '../src/codex-prototype/thread-catalog';
import {RpcRequestRejected,type Transport} from '../src/codex-prototype/rpc';
import type {Thread} from '../src/codex-prototype/protocol/v2/Thread';
import {DraftStore,emptyDraft,DRAFT_KEY} from '../src/codex-prototype/draft-store';
import {BlockFoldStore} from '../src/codex-prototype/block-fold-store';
import {UserFoldStore} from '../src/codex-prototype/user-fold-store';
import {ToolExpansionStore} from '../src/codex-prototype/tool-expansion-store';
import {ScrollViewStore,SCROLL_VIEW_KEY} from '../src/codex-prototype/scroll-view-store';
import {WorkFoldStore,WORK_FOLD_KEY} from '../src/codex-prototype/work-fold-store';
import {Session} from '../src/codex-prototype/session';
import {Store} from '../src/codex-prototype/storage';
import {EventEmitter} from 'node:events';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

function memory(){const values=new Map<string,unknown>();return {values,get:<T>(key:string,fallback:T)=>(values.has(key)?structuredClone(values.get(key)):fallback) as T,update:vi.fn(async(key:string,value:unknown)=>{values.set(key,structuredClone(value));})};}
const root='D:/synthetic-owned-root';
const thread=(id:string,name=id,updatedAt=1)=>({id,name,preview:'preview',cwd:root,updatedAt,turns:[],status:{type:'idle'}} as unknown as Thread);
const transport=(request:ReturnType<typeof vi.fn>)=>({request} as unknown as Transport);
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}

describe('task-owned session metadata through the fixed public APIs',()=>{
 it('loads an additive workspace key, preserves names/order across reload and does not touch ledgers',async()=>{
  const io=memory(),catalog=new ThreadCatalog(io);await catalog.observe(thread('a','原名'));await catalog.observe(thread('b'),false,'a');await catalog.observe(thread('c'),false,'a');
  expect(catalog.snapshot(['a','b','c']).sessions.map(v=>v.id)).toEqual(['a','c','b']);
  await catalog.reorder(['a','b','c'],'b','a');expect(new ThreadCatalog(io).snapshot(['a','b','c']).sessions.map(v=>v.id)).toEqual(['b','a','c']);
  expect([...io.values.keys()]).toEqual([THREAD_CATALOG_KEY]);
 });
 it('filters server lists by both ownership and canonical workspace, labels unresolved entries, and follows real cursors',async()=>{
  const catalog=new ThreadCatalog(memory()),request=vi.fn().mockResolvedValueOnce({data:[thread('owned','服务器标题'),thread('foreign'),{...thread('wrong'),cwd:'D:/other'}],nextCursor:'page-2'}).mockResolvedValueOnce({data:[thread('older')],nextCursor:null}),rpc=transport(request);
  const owned=()=>['owned','wrong','older','empty'];await catalog.list(rpc,root,owned,()=>true);
  expect(catalog.get('foreign')).toBeUndefined();expect(catalog.get('wrong')).toBeUndefined();expect(catalog.get('owned')?.title).toBe('服务器标题');
  expect(catalog.snapshot(owned()).sessions.find(v=>v.id==='empty')).toMatchObject({observed:false});
  await catalog.list(rpc,root,owned,()=>true,{more:true});expect(request.mock.calls[1]?.[1]).toMatchObject({cursor:'page-2',cwd:root});expect(catalog.nextCursor).toBeNull();
 });
 it('rejects nonadvancing and empty continuation pages without inventing completion',async()=>{
  const catalog=new ThreadCatalog(memory()),request=vi.fn().mockResolvedValueOnce({data:[thread('a')],nextCursor:'same'}).mockResolvedValueOnce({data:[],nextCursor:'same'}),rpc=transport(request);
  await catalog.list(rpc,root,()=>['a'],()=>true);await catalog.list(rpc,root,()=>['a'],()=>true,{more:true});
  expect(catalog.error).toContain('游标未推进');expect(catalog.nextCursor).toBe('same');expect(catalog.loading).toBe(false);
 });
 it('discards a previous read after a new query or connection wins',async()=>{
  const old=deferred<any>(),catalog=new ThreadCatalog(memory()),request=vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({data:[thread('a','new')],nextCursor:null}),rpc=transport(request);
  const first=catalog.list(rpc,root,()=>['a'],()=>true,{query:'old'});await catalog.list(rpc,root,()=>['a'],()=>true,{query:'new'});old.resolve({data:[thread('a','old')],nextCursor:null});await first;
  expect(catalog.get('a')?.title).toBe('new');expect(request.mock.calls[1]?.[1].searchTerm).toBe('new');
 });
 it('rejects an empty cursor instead of presenting a false end of history',async()=>{
  const catalog=new ThreadCatalog(memory()),rpc=transport(vi.fn().mockResolvedValue({data:[thread('a')],nextCursor:''}));
  await catalog.list(rpc,root,()=>['a'],()=>true);expect(catalog.error).toContain('格式无效');expect(catalog.get('a')).toBeUndefined();
 });
 it.each([null,{success:true},[],undefined])('keeps a mutation unresolved for a malformed acknowledgement %j',async result=>{
  const catalog=new ThreadCatalog(memory()),rpc=transport(vi.fn().mockResolvedValue(result));await catalog.observe(thread('a'));
  await expect(catalog.mutate(rpc,root,'a','archive',()=>true)).rejects.toThrow('回执');expect(catalog.get('a')).toMatchObject({archived:false,pending:{kind:'archive'}});
 });
 it('persists unknown mutations before RPC and refuses a duplicate including after reload',async()=>{
  const io=memory(),catalog=new ThreadCatalog(io),pending=deferred<any>(),request=vi.fn(()=>pending.promise),rpc=transport(request);
  const first=catalog.mutate(rpc,root,'a','rename',()=>true,'新名');await vi.waitFor(()=>expect(request).toHaveBeenCalledOnce());
  expect(new ThreadCatalog(io).get('a')?.pending).toEqual({kind:'rename',name:'新名'});
  await expect(catalog.mutate(rpc,root,'a','rename',()=>true,'重复')).rejects.toThrow('待核对');pending.resolve({});await first;
  expect(catalog.get('a')).toMatchObject({title:'新名'});expect(catalog.get('a')?.pending).toBeUndefined();
 });
 it('serializes simultaneous mutation intents before either can send a second RPC',async()=>{
  const catalog=new ThreadCatalog(memory()),pending=deferred<any>(),request=vi.fn(()=>pending.promise),rpc=transport(request);
  const first=catalog.mutate(rpc,root,'a','archive',()=>true),second=catalog.mutate(rpc,root,'a','delete',()=>true),rejected=expect(second).rejects.toThrow('在途');
  await rejected;pending.resolve({});await first;expect(request).toHaveBeenCalledOnce();
 });
 it('distinguishes explicit rejection from transport uncertainty and confirms a rename only by matching server data',async()=>{
  const catalog=new ThreadCatalog(memory()),request=vi.fn().mockRejectedValueOnce(new RpcRequestRejected('拒绝')).mockRejectedValueOnce(Error('connection lost')),rpc=transport(request);
  await expect(catalog.mutate(rpc,root,'a','rename',()=>true,'拒绝名')).rejects.toThrow('拒绝');expect(catalog.get('a')?.pending).toBeUndefined();
  await expect(catalog.mutate(rpc,root,'a','rename',()=>true,'确认名')).rejects.toThrow('lost');expect(catalog.get('a')?.pending).toBeDefined();
  request.mockResolvedValueOnce({data:[thread('a','别名')],nextCursor:null});await catalog.list(rpc,root,()=>['a'],()=>true);expect(catalog.get('a')?.pending).toBeDefined();
  request.mockResolvedValueOnce({data:[thread('a','确认名')],nextCursor:null});await catalog.list(rpc,root,()=>['a'],()=>true);expect(catalog.get('a')?.pending).toBeUndefined();
 });
 it('keeps archived records and validates an unarchive receipt before claiming success',async()=>{
  const catalog=new ThreadCatalog(memory()),request=vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({thread:thread('wrong')}),rpc=transport(request);
  await catalog.observe(thread('a'));await catalog.mutate(rpc,root,'a','archive',()=>true);
  expect(catalog.snapshot(['a']).recycle.map(v=>v.id)).toEqual(['a']);expect(catalog.snapshot(['a']).sessions).toEqual([]);
  await expect(catalog.mutate(rpc,root,'a','unarchive',()=>true)).rejects.toThrow('身份');expect(catalog.get('a')).toMatchObject({archived:true,pending:{kind:'unarchive'}});
 });
 it('retains tombstones after deletion, blocks reuse, and never overwrites corrupt storage',async()=>{
  const io=memory(),catalog=new ThreadCatalog(io),rpc=transport(vi.fn().mockResolvedValue({}));await catalog.observe(thread('a'));await catalog.mutate(rpc,root,'a','delete',()=>true);
  expect(catalog.snapshot(['a'])).toMatchObject({sessions:[],recycle:[]});expect(()=>new ThreadCatalog(io).assertUsable('a')).toThrow('删除');
  const bad=memory();bad.values.set(THREAD_CATALOG_KEY,{invalid:'keep'});const corrupt=new ThreadCatalog(bad);await expect(corrupt.observe(thread('b'))).rejects.toThrow('损坏');expect(bad.values.get(THREAD_CATALOG_KEY)).toEqual({invalid:'keep'});
 });
 it('never overwrites an ambiguously committed deletion with a later catalog write',async()=>{
  const io=memory(),catalog=new ThreadCatalog(io);await catalog.observe(thread('a'));await catalog.observe(thread('b'));
  const write=io.update.getMockImplementation()!;io.update.mockImplementationOnce(async(...args)=>{await write(...args);throw Error('lost delete acknowledgement');});
  await expect(catalog.deletedUpdated('a')).rejects.toThrow('lost delete acknowledgement');
  await expect(catalog.nameUpdated('b','next title')).rejects.toThrow('未确认');
  expect(new ThreadCatalog(io).get('a')?.deleted).toBe(true);
 });
});

describe('production Session management gates',()=>{
 function setup(){
  const dir=mkdtempSync(join(tmpdir(),'codex-prototype-catalog-session-')),store=new Store(join(dir,'ledger.json')),catalog=new ThreadCatalog(memory());
  const rpc=new EventEmitter() as EventEmitter&{request:ReturnType<typeof vi.fn>};rpc.request=vi.fn(async()=>({thread:{...thread('a'),cwd:dir}}));
  store.own('a');store.select('a');const session=new Session(rpc as unknown as Transport,dir,store,catalog);session.projection.snapshot({...thread('a'),cwd:dir});return{dir,store,catalog,rpc,session};
 }
 it('applies public title notifications to owned non-current tabs without adopting foreign threads or reviving tombstones',async()=>{
  const f=setup();f.store.own('b');await f.catalog.observe(thread('b','新会话'));await f.catalog.observe(thread('gone'));f.store.own('gone');
  await f.catalog.mutate(transport(vi.fn().mockResolvedValue({})),root,'gone','delete',()=>true);
  for(const [threadId,threadName] of [['b','公开标题'],['foreign','外来'],['gone','迟到']])f.rpc.emit('notification',{method:'thread/name/updated',params:{threadId,threadName}});
  await vi.waitFor(()=>expect(f.catalog.get('b')?.title).toBe('公开标题'));expect(f.catalog.get('foreign')).toBeUndefined();expect(f.catalog.get('gone')?.deleted).toBe(true);
 });
 it('preserves an unresolved user rename when an older automatic title arrives',async()=>{
  const f=setup();await f.catalog.observe(thread('a','旧名'));
  await expect(f.catalog.mutate(transport(vi.fn().mockRejectedValue(Error('lost'))),root,'a','rename',()=>true,'用户名称')).rejects.toThrow();
  f.rpc.emit('notification',{method:'thread/name/updated',params:{threadId:'a',threadName:'迟到旧标题'}});
  await new Promise(r=>setTimeout(r,10));expect(f.catalog.get('a')?.pending).toEqual({kind:'rename',name:'用户名称'});expect(f.catalog.get('a')?.title).toBe('用户名称');
 });
 it('persists an owned public deletion tombstone and signals local cleanup without adopting foreign IDs',async()=>{
  const f=setup(),deleted=vi.fn();f.session.on('thread-deleted',deleted);
  f.store.own('b');await f.catalog.observe(thread('b'));
  f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'b'}});
  f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'foreign'}});
  expect(f.catalog.get('b')?.deleted).toBe(true);
  await vi.waitFor(()=>expect(deleted).toHaveBeenCalledExactlyOnceWith('b'),{interval:1,timeout:500});expect(f.catalog.get('foreign')).toBeUndefined();
  expect(f.session.projection.threadId).toBe('a');expect(f.store.read().selected).toBe('a');
 });
 it('blocks a deletion immediately but waits for durable confirmation before signalling local cleanup',async()=>{
  const io=memory(),f=setup(),catalog=new ThreadCatalog(io),session=new Session(f.rpc as unknown as Transport,f.dir,f.store,catalog),deleted=vi.fn();session.on('thread-deleted',deleted);
  await catalog.observe(thread('a'));const hold=deferred<void>(),write=io.update.getMockImplementation()!;
  io.update.mockImplementationOnce(async(...args)=>{await hold.promise;await write(...args);});
  f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'a'}});
  expect(()=>catalog.assertUsable('a')).toThrow('删除');expect(deleted).not.toHaveBeenCalled();
  hold.resolve();await vi.waitFor(()=>expect(deleted).toHaveBeenCalledExactlyOnceWith('a'));
  expect(new ThreadCatalog(io).get('a')?.deleted).toBe(true);
 });
 it('preserves local metadata when deletion tombstone persistence fails and does not emit cleanup',async()=>{
  const io=memory(),f=setup(),catalog=new ThreadCatalog(io),session=new Session(f.rpc as unknown as Transport,f.dir,f.store,catalog),deleted=vi.fn();session.on('thread-deleted',deleted);
  await catalog.observe(thread('a'));io.update.mockRejectedValueOnce(Error('tombstone storage unavailable'));
  f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'a'}});
  await vi.waitFor(()=>expect(session.error).toContain('tombstone storage unavailable'));
  expect(catalog.get('a')?.deleted).toBe(true);expect(new ThreadCatalog(io).get('a')?.deleted).not.toBe(true);expect(deleted).not.toHaveBeenCalled();
 });
 it('accepts a local delete receipt even when its public notification arrives first',async()=>{
  const f=setup();await f.catalog.observe(thread('a'));
  f.rpc.request.mockImplementation(async(method:string)=>{if(method==='thread/read')return{thread:{...thread('a'),cwd:f.dir}};if(method==='thread/delete'){f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'a'}});return{};}throw Error('Unexpected RPC');});
  await expect(f.session.manageThread('delete','a',()=>true)).resolves.toBeUndefined();
  expect(f.catalog.get('a')?.deleted).toBe(true);expect(f.session.projection.threadId).toBe('');expect(f.store.read().selected).toBeUndefined();
 });
 it('clears a publicly deleted current thread and ignores later body notifications',()=>{
  const f=setup();f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'a'}});
  f.rpc.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'a',turnId:'late',itemId:'late',delta:'obsolete'}});
  expect(f.session.projection.threadId).toBe('');expect(f.session.projection.items.size).toBe(0);expect(f.store.read().selected).toBeUndefined();expect(f.session.busy).toBe(false);
 });
 it('clears an obsolete persisted selection even while the projection is restoring another thread',()=>{
  const f=setup();f.store.own('b');f.session.projection.snapshot(thread('b'));
  f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'a'}});
  expect(f.session.projection.threadId).toBe('b');expect(f.store.read().selected).toBeUndefined();
 });
 it('does not emit duplicate cleanup for repeated public deletion on the same connection',async()=>{
  const f=setup(),deleted=vi.fn();f.store.own('b');f.session.on('thread-deleted',deleted);
  f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'b'}});
  f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'b'}});
  await vi.waitFor(()=>expect(deleted).toHaveBeenCalled());
  await f.catalog.nameUpdated('neighbor','drain catalog queue');
  expect(deleted).toHaveBeenCalledExactlyOnceWith('b');
 });
 it.each(['rename','archive'] as const)('does not claim a successful %s when public deletion wins the in-flight operation',async kind=>{
  const f=setup();await f.catalog.observe(thread('a'));
  f.rpc.request.mockImplementation(async(method:string)=>{if(method==='thread/read')return{thread:{...thread('a'),cwd:f.dir}};f.rpc.emit('notification',{method:'thread/deleted',params:{threadId:'a'}});return{};});
  await expect(f.session.manageThread(kind,'a',()=>true,'new name')).rejects.toThrow('永久删除');
  expect(f.catalog.get('a')?.deleted).toBe(true);expect(f.session.projection.threadId).toBe('');expect(f.store.read().selected).toBeUndefined();
 });
 it('clears only the active selection after an acknowledged archive and never reserves a model turn',async()=>{
  const f=setup();f.rpc.request.mockResolvedValueOnce({thread:{...thread('a'),cwd:f.dir}}).mockResolvedValueOnce({});
  await f.session.manageThread('archive','a',()=>true);expect(f.rpc.request.mock.calls.map(c=>c[0])).toEqual(['thread/read','thread/archive']);expect(f.store.read()).toMatchObject({threads:['a'],attempts:[]});expect(f.store.read().selected).toBeUndefined();expect(f.session.projection.threadId).toBe('');expect(f.catalog.get('a')?.archived).toBe(true);
 });
 it('locally archives an owned never-sent empty only after two explicit absence receipts, retaining its draft and ownership',async()=>{const f=setup(),io=memory(),drafts=new DraftStore(io);await drafts.save('a',{...emptyDraft(),text:'keep empty draft'});f.rpc.request.mockRejectedValueOnce(new RpcRequestRejected('thread not loaded: a')).mockRejectedValueOnce(new RpcRequestRejected('no rollout found for thread id a'));await f.session.manageThread('archive','a',()=>true);expect(f.catalog.get('a')).toMatchObject({archived:true,localOnly:true});expect(f.catalog.get('a')?.pending).toBeUndefined();expect(drafts.read('a').text).toBe('keep empty draft');expect(f.store.read()).toMatchObject({threads:['a'],attempts:[]});expect(f.session.status).toContain('草稿保留');expect(f.session.projection.threadId).toBe('');expect(f.rpc.request.mock.calls.map(c=>c[0])).toEqual(['thread/read','thread/archive']);f.rpc.request.mockRejectedValueOnce(new RpcRequestRejected('thread not loaded: a')).mockRejectedValueOnce(new RpcRequestRejected('no rollout found for thread id a'));await f.session.manageThread('delete','a',()=>true);expect(f.catalog.get('a')).toMatchObject({deleted:true,localOnly:true});expect(drafts.read('a').text).toBe('keep empty draft');});
 it.each(['attempt','old-approval','transport','wrong-id','unconfirmed-archive'])('never treats %s as a safely absent empty thread',async fault=>{const f=setup();if(fault==='attempt')f.store.reserve('a','unknown send');if(fault==='old-approval'){const data=f.store.read();data.invalidatedApprovals=[{threadId:'a',turnId:'old-turn'}]as any;(f.store as any).read=()=>structuredClone(data);}f.rpc.request.mockRejectedValueOnce(fault==='transport'?Error('thread not loaded: a'):new RpcRequestRejected('thread not loaded: '+(fault==='wrong-id'?'other':'a'))).mockRejectedValueOnce(fault==='unconfirmed-archive'?Error('no rollout found for thread id a'):new RpcRequestRejected('no rollout found for thread id a'));await expect(f.session.manageThread('archive','a',()=>true)).rejects.toThrow();expect(f.catalog.get('a')?.localOnly).not.toBe(true);expect(f.catalog.get('a')?.archived).not.toBe(true);expect(f.store.read().selected).toBe('a');if(fault==='unconfirmed-archive')expect(f.catalog.get('a')?.pending).toEqual({kind:'archive'});else expect(f.rpc.request.mock.calls.some(c=>c[0]==='thread/archive')).toBe(false);});
 it.each(['foreign','busy','active','wrong-cwd','wrong-id'])('does not mutate when the %s gate fails',async kind=>{
  const f=setup();if(kind==='busy')f.session.busy=true;
  f.rpc.request.mockResolvedValue({thread:{...thread(kind==='wrong-id'?'b':'a'),cwd:kind==='wrong-cwd'?'D:/other':f.dir,status:{type:kind==='active'?'active':'idle'}}});
  await expect(f.session.manageThread('delete',kind==='foreign'?'b':'a',()=>true)).rejects.toThrow();expect(f.rpc.request.mock.calls.some(c=>c[0]==='thread/delete')).toBe(false);expect(f.store.read().selected).toBe('a');expect(f.catalog.get('a')?.deleted).not.toBe(true);
 });
 it('discards a delayed source read after a document lease expires',async()=>{
  const f=setup(),read=deferred<any>();let current=true;f.rpc.request.mockReturnValueOnce(read.promise);
  const task=f.session.manageThread('delete','a',()=>current);current=false;read.resolve({thread:{...thread('a'),cwd:f.dir}});await expect(task).rejects.toThrow('身份');expect(f.rpc.request).toHaveBeenCalledOnce();expect(f.session.isOperating).toBe(false);
 });
 it('keeps unknown deletion blocked without purging the ledger or replaying the request',async()=>{
  const f=setup();f.rpc.request.mockResolvedValueOnce({thread:{...thread('a'),cwd:f.dir}}).mockRejectedValueOnce(Error('lost receipt'));
  await expect(f.session.manageThread('delete','a',()=>true)).rejects.toThrow('lost receipt');expect(f.catalog.get('a')?.pending?.kind).toBe('delete');expect(f.store.read().selected).toBe('a');expect(f.session.projection.threadId).toBe('a');
  f.rpc.request.mockResolvedValue({thread:{...thread('a'),cwd:f.dir}});await expect(f.session.manageThread('delete','a',()=>true)).rejects.toThrow('待核对');expect(f.rpc.request.mock.calls.filter(c=>c[0]==='thread/delete')).toHaveLength(1);
 });
});

describe('successful permanent deletion clears only the target v1 metadata',()=>{
 it('preserves other threads and rejects delayed writes after purge across every store',async()=>{
  const io=memory(),drafts=new DraftStore(io),scroll=new ScrollViewStore(io),blocks=new BlockFoldStore(io),users=new UserFoldStore(io),tools=new ToolExpansionStore(io),work=new WorkFoldStore(io);
  for(const id of ['a','b']){
   await drafts.save(id,{...emptyDraft(),text:id});await scroll.save(id,{atBottom:false,scrollTop:10});
   await blocks.set(JSON.stringify([id,'t','i',0]),true,()=>true);await users.set(JSON.stringify([id,'t','i']),'expanded',()=>true);await tools.save(JSON.stringify([id,'t','i']),true,()=>true);await work.set(JSON.stringify([id,'t','i']),'expanded',()=>true);
  }
  await Promise.all([drafts.forget('a'),scroll.forget('a'),blocks.forget('a'),users.forget('a'),tools.forget('a'),work.forget('a')]);
  expect(new DraftStore(io).read('b').text).toBe('b');expect(new DraftStore(io).read('a').text).toBe('');expect(io.values.get(DRAFT_KEY)).toHaveLength(1);expect(io.values.get(SCROLL_VIEW_KEY)).toHaveLength(1);expect(io.values.get(WORK_FOLD_KEY)).toHaveLength(1);
  for(const store of [blocks,users,tools,work])expect(JSON.stringify(store.read())).not.toContain('\\"a\\"');
  await expect(drafts.save('a',emptyDraft())).rejects.toThrow('删除');await expect(scroll.save('a',{atBottom:true,scrollTop:0})).rejects.toThrow('删除');
  await expect(blocks.set('["a","t","i",0]',true,()=>true)).rejects.toThrow('失效');await expect(users.set('["a","t","i"]','expanded',()=>true)).rejects.toThrow('失效');await expect(tools.save('["a","t","i"]',true,()=>true)).rejects.toThrow('失效');await expect(work.set('["a","t","i"]','expanded',()=>true)).rejects.toThrow('失效');
 });
 it('waits for an already writing save, then removes the target without losing a neighbor',async()=>{
  const io=memory(),drafts=new DraftStore(io);await drafts.save('b',{...emptyDraft(),text:'keep'});
  const hold=deferred<void>(),original=io.update.getMockImplementation()!;io.update.mockImplementationOnce(async(...args)=>{await hold.promise;return original(...args);});
  const save=drafts.save('a',{...emptyDraft(),text:'late'});await vi.waitFor(()=>expect(io.update).toHaveBeenCalledTimes(2));
  const purge=drafts.forget('a');hold.resolve();await save;await purge;expect(new DraftStore(io).read('a').text).toBe('');expect(new DraftStore(io).read('b').text).toBe('keep');
 });
});
