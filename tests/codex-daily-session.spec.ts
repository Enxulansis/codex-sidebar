import {afterEach,describe,expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DailySessionStore,DAILY_CHAT_MODEL,DAILY_CHAT_SCOPE} from '../src/codex-prototype/daily-session-store';
import {Store} from '../src/codex-prototype/storage';
import {Session} from '../src/codex-prototype/session';
import {ModelSelections,MODEL_SELECTION_KEY,DAILY_MODEL_SELECTION_KEY} from '../src/codex-prototype/model-selection';
import {DISABLED_MCP,DISABLED_PLUGINS} from '../src/codex-prototype/tools';
const roots:string[]=[];
const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'codex-daily-session-'));roots.push(root);const directory=join(root,'extension-state');return{root,directory,store:new DailySessionStore(directory,root)};};
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
describe('daily dispatch journal preserves ownership and recovery without experimental quota',()=>{
 it('records more than twelve sends, restores selected/pending/unknown evidence and leaves an old experiment unchanged',()=>{
  const f=fixture(),old=new Store(join(f.root,'old-ledger.json'));old.own('old');old.reserve('old','old test');const oldBytes=readFileSync(old.path);f.store.own('daily');for(let n=0;n<15;n++){const id=f.store.reserve('daily','text');f.store.record(id,{turnId:'turn-'+n,status:n===14?'requestFailedOrDisconnected':'completed'});}f.store.pending({threadId:'daily',turnId:'turn-14',kind:'command'});
  const restored=new DailySessionStore(f.directory,f.root);expect(restored.limit).toBeNull();expect(restored.dispatchReason()).toBe('');expect(restored.read()).toMatchObject({selected:'daily',pendingApprovals:[{threadId:'daily',turnId:'turn-14',kind:'command'}]});expect(restored.read().attempts).toHaveLength(15);expect(restored.hasAttempts('daily')).toBe(true);expect(restored.read().attempts.at(-1)?.status).toBe('requestFailedOrDisconnected');expect(readFileSync(old.path)).toEqual(oldBytes);
 });
 it('refuses another workspace, corrupt data and an incomplete journal without resetting it',()=>{
  const f=fixture();f.store.own('keep');const before=readFileSync(f.store.path);expect(()=>new DailySessionStore(f.directory,join(f.root,'other'))).toThrow('归属');expect(readFileSync(f.store.path)).toEqual(before);writeFileSync(f.store.path,'preserve corrupt record');expect(()=>new DailySessionStore(f.directory,f.root)).toThrow();expect(readFileSync(f.store.path,'utf8')).toBe('preserve corrupt record');renameSync(f.store.path,f.store.path+'.retained');expect(()=>new DailySessionStore(f.directory,f.root)).toThrow('不完整');expect(readFileSync(f.store.path+'.retained','utf8')).toBe('preserve corrupt record');
 });
 it('a concurrent writer and a foreign thread cannot acquire dispatch or change the journal',()=>{
  const f=fixture();f.store.own('ours');const before=readFileSync(f.store.path),fd=openSync(f.store.path+'.lock','wx');try{expect(()=>f.store.reserve('ours','text')).toThrow();}finally{closeSync(fd);unlinkSync(f.store.path+'.lock');}expect(readFileSync(f.store.path)).toEqual(before);expect(()=>f.store.reserve('foreign','text')).toThrow('只允许');expect(readFileSync(f.store.path)).toEqual(before);
 });
});
async function dailySession(luna=true){
 const f=fixture(),rpc=new EventEmitter() as any,calls:{method:string;params:any}[]=[],memory=new Map<string,unknown>([[MODEL_SELECTION_KEY,{version:1,threads:[],default:{model:'gpt-6.1-sol',effort:'low'}}]]),preferences=new ModelSelections({get:<T>(key:string,value:T)=>(memory.get(key)??value) as T,update:async(key:string,value:unknown)=>{memory.set(key,structuredClone(value));}},DAILY_MODEL_SELECTION_KEY);
 const model=(name:string,isDefault:boolean)=>({id:name,model:name,displayName:name,description:'Synthetic catalog',isDefault,hidden:false,inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'low',description:'low'}],defaultReasoningEffort:'low',serviceTiers:[],defaultServiceTier:null});
 rpc.request=async(method:string,params:any)=>{calls.push({method,params});if(method==='config/read')return{config:{features:{apps:false},apps:{_default:{enabled:false}},mcp_servers:Object.fromEntries(DISABLED_MCP.map(name=>[name,{enabled:false}])),plugins:Object.fromEntries(DISABLED_PLUGINS.map(name=>[name,{enabled:false}]))}};if(method==='account/read')return{account:{type:'chatgpt'}};if(method==='mcpServerStatus/list')return{data:DISABLED_MCP.map(name=>({name,runtimeStatus:'disabled',tools:{},resources:[],resourceTemplates:[]})),nextCursor:null};if(method==='model/list')return{data:[model('gpt-6.1-sol',true),...(luna?[model('gpt-6-luna',false)]:[])],nextCursor:null};if(method==='thread/start')return{thread:{id:params.ephemeral?'probe':'daily-thread',cwd:f.root,historyMode:'legacy',turns:[]},cwd:f.root,model:params.model,reasoningEffort:'low'};if(method==='turn/start')return{turn:{id:'daily-turn',status:'inProgress',items:[],itemsView:'full',error:null}};if(method==='turn/interrupt')return{};throw Error('Unexpected '+method);};rpc.dispose=async()=>{};
 const session=new Session(rpc,f.root,f.store,undefined,undefined,undefined,preferences,undefined,undefined,DAILY_CHAT_MODEL,DAILY_CHAT_SCOPE);session.on('change',()=>{});return{...f,rpc,calls,session,preferences,memory};
}
describe('daily sessions request only the explicit initial model',()=>{
 it('uses Luna instead of the public default for probe, new thread and the first low-effort turn',async()=>{
  const f=await dailySession();expect(f.preferences.default()).toBeUndefined();await f.session.preflight();expect(f.session.model).toBe('gpt-6-luna');await f.session.newThread();await f.session.send('non-sensitive test');expect(f.calls.filter(row=>row.method==='thread/start').every(row=>row.params.model==='gpt-6-luna')).toBe(true);expect(f.calls.find(row=>row.method==='turn/start')?.params).toMatchObject({model:'gpt-6-luna',effort:'low'});expect(f.calls.filter(row=>row.method==='thread/start').every(row=>row.params.sandbox==='read-only'&&row.params.developerInstructions===DAILY_CHAT_SCOPE)).toBe(true);expect(f.memory.get(MODEL_SELECTION_KEY)).toEqual({version:1,threads:[],default:{model:'gpt-6.1-sol',effort:'low'}});
 });
 it('does not fall back to another model when Luna is absent',async()=>{
  const f=await dailySession(false);await expect(f.session.preflight()).rejects.toThrow('不在当前可用目录');expect(f.calls.some(row=>row.method==='turn/start')).toBe(false);expect(f.store.read().attempts).toHaveLength(0);
 });
 it('reports and interrupts a server model reroute without retry or another reservation',async()=>{
  const f=await dailySession();await f.session.preflight();await f.session.newThread();await f.session.send('non-sensitive test');f.rpc.emit('notification',{method:'model/rerouted',params:{threadId:'daily-thread',turnId:'daily-turn',fromModel:'gpt-6-luna',toModel:'gpt-6.1-sol',reason:'usageLimit'}});await new Promise(resolve=>setTimeout(resolve,0));expect(f.session.error).toContain('已请求停止');expect(f.session.sendOutcomeUncertain).toBe(true);expect(f.calls.filter(row=>row.method==='turn/interrupt')).toHaveLength(1);expect(f.calls.filter(row=>row.method==='turn/start')).toHaveLength(1);expect(f.store.read().attempts).toHaveLength(1);
 });
});
