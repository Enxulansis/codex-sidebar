import {afterEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,unlinkSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename} from 'node:path';
import {spawn} from 'node:child_process';
import {buildSync} from 'esbuild';
import {prepareAcceptanceBatch,openAcceptanceBatch,ACCEPTANCE_LEDGER,ACCEPTANCE_MANIFEST} from '../src/codex-prototype/acceptance-batch';
import {displayBatch} from '../src/codex-prototype/online-batch';
import {Session} from '../src/codex-prototype/session';
import type {Transport} from '../src/codex-prototype/rpc';
import {DISABLED_MCP,DISABLED_PLUGINS} from '../src/codex-prototype/tools';
import {PIN} from '../src/codex-prototype/pin';

const roots:string[]=[],sessions:Session[]=[];
function directory(){const path=mkdtempSync(join(tmpdir(),'codex-prototype-batch-sim-'));roots.push(path);return path;}
async function setup(){
 const root=directory(),run=join(root,'run');writeFileSync(join(root,'.codex-prototype-owned'),'restricted-prototype');
 const batch=await prepareAcceptanceBatch(run,root,'synthetic-batch');
 return{root,run,...batch};
}
function enabled(run:string){const path=join(run,ACCEPTANCE_MANIFEST),manifest=JSON.parse(readFileSync(path,'utf8'));manifest.dispatchEnabled=true;writeFileSync(path,JSON.stringify(manifest));}
function transport(root:string){
 return Object.assign(new EventEmitter(),{request:vi.fn(async(method:string)=>{
  if(method==='config/read')return{config:{features:{apps:false},apps:{_default:{enabled:false}},mcp_servers:Object.fromEntries(DISABLED_MCP.map(name=>[name,{enabled:false}])),plugins:Object.fromEntries(DISABLED_PLUGINS.map(name=>[name,{enabled:false}]))}};
  if(method==='mcpServerStatus/list')return{data:DISABLED_MCP.map(name=>({name,runtimeStatus:'disabled',tools:{},toolsError:null,resources:[],resourceTemplates:[]})),nextCursor:null};
  if(method==='turn/start')return{turn:{id:'synthetic-turn',status:'inProgress',items:[],error:null}};
  throw Error('Unexpected synthetic request: '+method);
 }),respond:vi.fn(),reject:vi.fn(),dispose:vi.fn(async()=>{})}) as unknown as Transport&{request:ReturnType<typeof vi.fn>};
}
function session(root:string,store:ReturnType<typeof openAcceptanceBatch>['store']){
 const rpc=transport(root),s=new Session(rpc,root,store);sessions.push(s);s.on('change',()=>{});
 store.own('synthetic-thread');s.projection.snapshot({id:'synthetic-thread',turns:[]} as never);
 s.toolCheck={verified:true,threadId:'synthetic-thread',reason:'Synthetic transport only'};
 return{s,rpc};
}
async function child(script:string,args:string[]){
 return new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  const process=spawn(globalThis.process.execPath,[script,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{process.kill();reject(Error('Owned ledger child timeout: '+process.pid));},4000);
  process.stdout.on('data',chunk=>stdout+=chunk);process.stderr.on('data',chunk=>stderr+=chunk);
  process.once('error',error=>{clearTimeout(timer);reject(error);});process.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
 });
}
afterEach(async()=>{
 for(const s of sessions.splice(0))await s.dispose();
 for(const root of roots.splice(0)){if(!basename(root).startsWith('codex-prototype-batch-sim-'))throw Error('Not an owned test directory');rmSync(root,{recursive:true,force:true});}
});

describe('independent two-turn acceptance ledger — synthetic only, no real backend',()=>{
 it.each([0,1,2])('preserves all %s original reservations and ledger bytes after an explicit approved backend binding',async used=>{
  const {root,run,store}=await setup(),manifestPath=join(run,ACCEPTANCE_MANIFEST),manifest=JSON.parse(readFileSync(manifestPath,'utf8')),data=JSON.parse(readFileSync(store.path,'utf8'));
  const previous={version:'codex-cli 0.162.0-alpha.17.2',sha256:'d13914ced6c7af174d8d638db938284231227312104b06a25e9608c632a7daec'};
  manifest.backend=previous;data.batch.backend=previous;data.threads=['synthetic-thread'];
  data.attempts=Array.from({length:used},(_,i)=>({id:'original-'+i,threadId:'synthetic-thread',purpose:'text/tool',reservedAt:'2026-10-18T00:00:00.000Z',status:'requestFailedOrDisconnected'}));
  writeFileSync(manifestPath,JSON.stringify(manifest));writeFileSync(store.path,JSON.stringify(data));const ledger=readFileSync(store.path);
  expect(()=>openAcceptanceBatch(run,root)).toThrow('后端');
  manifest.runtimeBackend={version:PIN.version,sha256:PIN.sha256};writeFileSync(manifestPath,JSON.stringify(manifest));
  const reopened=openAcceptanceBatch(run,root);expect(reopened.batchId).toBe('synthetic-batch');expect(reopened.store.read().attempts).toEqual(data.attempts);expect(reopened.store.limit).toBe(2);expect(reopened.store.dispatchReason()).toContain('发送已禁用');expect(readFileSync(store.path).equals(ledger)).toBe(true);
  manifest.runtimeBackend.sha256='unknown';writeFileSync(manifestPath,JSON.stringify(manifest));expect(()=>reopened.store.read()).toThrow('后端');
 });
 it('prepares exactly once, remains disabled on reopen, and does not import or change old records',async()=>{
  const {root,run,store}=await setup(),old=join(root,'ledger.json'),oldBatch=join(root,'historical-two.json');
  writeFileSync(old,JSON.stringify({attempts:Array(12).fill({historical:true}),threads:['old-thread']}));
  writeFileSync(oldBatch,JSON.stringify({attempts:Array(2).fill({historical:true}),threads:['older-thread']}));
  const bytes=[readFileSync(old),readFileSync(oldBatch)],ledger=readFileSync(store.path);
  expect(store.read()).toMatchObject({attempts:[],threads:[],pendingApprovals:[],invalidatedApprovals:[]});
  expect(store.read().selected).toBeUndefined();
  for(let i=0;i<6;i++){
   const batch=await prepareAcceptanceBatch(run,root,'synthetic-batch');
   expect(batch.store.path).toBe(store.path);expect(batch.store.dispatchReason()).toContain('发送已禁用');
   expect(displayBatch(run,root)).toMatchObject({oldUsed:null,batchId:'synthetic-batch',independentBatch:true});
  }
  expect(readFileSync(store.path).equals(ledger)).toBe(true);
  expect(readFileSync(old).equals(bytes[0]!)).toBe(true);expect(readFileSync(oldBatch).equals(bytes[1]!)).toBe(true);
 });
 it('blocks normal sends, repeated clicks and steer before any RPC, reservation or attachment read',async()=>{
  const {root,store}=await setup(),{s,rpc}=session(root,store);
  const attempts=await Promise.allSettled(Array.from({length:6},()=>s.send('synthetic',join(root,'does-not-exist.png'))));
  expect(attempts.every(v=>v.status==='rejected'&&String(v.reason).includes('发送已禁用'))).toBe(true);
  await expect(s.steer('synthetic')).rejects.toThrow('发送已禁用');
  expect(rpc.request).not.toHaveBeenCalled();expect(store.read().attempts).toHaveLength(0);
 });
 it('reserves once for simultaneous sends and rejects a second process while the first outcome is pending',async()=>{
  const {root,run,store}=await setup();enabled(run);const {s,rpc}=session(root,store);
  const simultaneous=await Promise.allSettled([s.send('synthetic one'),s.send('same click again')]);
  expect(simultaneous.map(v=>v.status)).toEqual(['fulfilled','rejected']);
  await expect(s.send('repeat')).rejects.toThrow('结果未知');
  await expect(session(root,openAcceptanceBatch(run,root).store).s.send('reopened')).rejects.toThrow('结果未知');
  expect(rpc.request.mock.calls.filter(([method])=>method==='turn/start')).toHaveLength(1);
  expect(store.read().attempts).toHaveLength(1);
  rpc.emit('notification',{method:'turn/completed',params:{threadId:'synthetic-thread',turn:{id:'synthetic-turn',status:'completed',items:[],error:null}}});
  expect(store.read().attempts[0]).toMatchObject({turnId:'synthetic-turn',status:'completed'});
  await s.send('synthetic two');expect(store.read().attempts).toHaveLength(2);
  await expect(s.send('third')).rejects.toThrow();
  expect(rpc.request.mock.calls.filter(([method])=>method==='turn/start')).toHaveLength(2);
 });
 it.each(['requestFailedOrDisconnected','interrupted','failed',undefined])('preserves %s across process-style reopen and never retries it',async status=>{
  const {root,run,store}=await setup();enabled(run);store.own('synthetic-thread');const id=store.reserve('synthetic-thread','image');
  if(status)store.record(id,{status,turnId:'synthetic-turn'});
  const reopened=openAcceptanceBatch(run,root).store,{s,rpc}=session(root,reopened);
  expect(reopened.read().attempts[0]?.id).toBe(id);expect(reopened.dispatchReason()).toContain('结果未知');
  await expect(s.send('repeat')).rejects.toThrow('暂停');expect(rpc.request).not.toHaveBeenCalled();
  expect(reopened.read().attempts).toHaveLength(1);
 });
 it('does not forget consumed quota on an actual Node restart or two concurrent reservers',async()=>{
  const {root,run,store}=await setup();enabled(run);store.own('synthetic-thread');
  const script=join(root,'ledger-child.cjs');
  buildSync({stdin:{contents:"import {openAcceptanceBatch} from './src/codex-prototype/acceptance-batch';const [run,workspace,action]=process.argv.slice(2);try{const {store}=openAcceptanceBatch(run,workspace);if(action==='reserve')store.reserve('synthetic-thread','text/tool');console.log(JSON.stringify({attempts:store.read().attempts,reason:store.dispatchReason()}));}catch(error){console.error(String(error));process.exitCode=7;}",resolveDir:resolve('.')},bundle:true,platform:'node',format:'cjs',outfile:script,logLevel:'silent'});
  const racers=await Promise.all([child(script,[run,root,'reserve']),child(script,[run,root,'reserve'])]);
  expect(racers.map(v=>v.code).sort()).toEqual([0,7]);
  const restarted=await child(script,[run,root,'read']);expect(restarted.code).toBe(0);
  const data=JSON.parse(restarted.stdout);expect(data.attempts).toHaveLength(1);expect(data.reason).toContain('结果未知');
  expect(store.read().attempts[0]?.id).toBe(data.attempts[0].id);
  store.record(data.attempts[0].id,{status:'completed',turnId:'synthetic-turn'});
  expect((await child(script,[run,root,'reserve'])).code).toBe(0);
  const exhausted=await child(script,[run,root,'reserve']);expect(exhausted.code).toBe(7);expect(exhausted.stderr).toContain('预算已用尽');expect(store.read().attempts).toHaveLength(2);
 });
 it('does not permit deletion, replacement or reordering of persisted reservations',async()=>{
  const {run,store}=await setup();enabled(run);store.own('synthetic-thread');const id=store.reserve('synthetic-thread','text/tool');
  const bytes=readFileSync(store.path);
  expect(()=>store.update(d=>{d.attempts=[];})).toThrow('不能删除');
  expect(()=>store.record(id,{id:'replacement'})).toThrow('不能删除');
  expect(readFileSync(store.path).equals(bytes)).toBe(true);
 });
 it.each([ACCEPTANCE_MANIFEST,ACCEPTANCE_LEDGER])('fails closed when %s is missing without rebuilding either file',async name=>{
  const {root,run}=await setup();unlinkSync(join(run,name));
  expect(()=>displayBatch(run,root)).toThrow();await expect(prepareAcceptanceBatch(run,root,'synthetic-batch')).rejects.toThrow();
 });
 it.each(['invalid-json','wrong-batch','over-budget','foreign-thread'])('rejects %s while preserving corrupt evidence',async kind=>{
  const {root,run,store}=await setup(),data=JSON.parse(readFileSync(store.path,'utf8'));
  if(kind==='wrong-batch')data.batch.id='another';
  if(kind==='over-budget')data.attempts=[{id:'a'},{id:'b'},{id:'c'}];
  if(kind==='foreign-thread')data.selected='foreign';
  const text=kind==='invalid-json'?'{broken':JSON.stringify(data);writeFileSync(store.path,text);
  expect(()=>openAcceptanceBatch(run,root)).toThrow();expect(readFileSync(store.path,'utf8')).toBe(text);
 });
 it('rejects other workspaces, changed limits/backends and linked ledger directories',async()=>{
  const {root,run,store}=await setup(),other=directory();expect(()=>openAcceptanceBatch(run,other)).toThrow('工作区不匹配');
  const path=join(run,ACCEPTANCE_MANIFEST),manifest=JSON.parse(readFileSync(path,'utf8'));
  for(const change of [{id:'other'},{limit:3},{backend:{...manifest.backend,sha256:'different'}}]){
   writeFileSync(path,JSON.stringify({...manifest,...change}));expect(()=>store.read()).toThrow();
  }
  writeFileSync(path,JSON.stringify(manifest));const link=join(root,'linked-run');symlinkSync(run,link,'junction');
  expect(realpathSync(link)).toBe(realpathSync(run));expect(()=>openAcceptanceBatch(link,root)).toThrow('不能通过链接');
 });
 it('never converts an old ledger directory or changes the identity of an existing batch',async()=>{
  const {root,run,store}=await setup();await expect(prepareAcceptanceBatch(run,root,'different-batch')).rejects.toThrow('不能重置');
  const old=join(root,'old');mkdirSync(old);writeFileSync(join(old,'ledger.json'),'old bytes');
  await expect(prepareAcceptanceBatch(old,root,'different-batch')).rejects.toThrow('旧账本');
  expect(readFileSync(join(old,'ledger.json'),'utf8')).toBe('old bytes');expect(store.read().attempts).toHaveLength(0);
 });
});
