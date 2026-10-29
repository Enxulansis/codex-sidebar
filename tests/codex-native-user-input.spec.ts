import {describe,it,expect} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Session} from '../src/codex-prototype/session';
import {Store} from '../src/codex-prototype/storage';
import {ModelSelections} from '../src/codex-prototype/model-selection';
import {ModeSelections,DAILY_MODE_SELECTION_KEY} from '../src/codex-prototype/collaboration-mode';
import {CollaborationModeHost} from '../src/codex-prototype/collaboration-mode-host';
import {userInputResponse,validateUserInput} from '../src/codex-prototype/native-user-input';
import {DISABLED_MCP,DISABLED_PLUGINS} from '../src/codex-prototype/tools';

const question=()=>({threadId:'thread',turnId:'turn',itemId:'ask',isBlocking:true,autoResolutionMs:null,questions:[{id:'color',header:'Color',question:'Choose the known color',isOther:true,isSecret:false,options:[{label:'Blue',description:'Known sample'},{label:'Red',description:'Alternative'}]}]});
const models=[{id:'gpt-6-luna',model:'gpt-6-luna',displayName:'Luna',description:'Fixture',hidden:false,isDefault:true,inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'low',description:'low'}],defaultReasoningEffort:'low',serviceTiers:[],defaultServiceTier:null}];
async function fixture(){
  const root=mkdtempSync(join(tmpdir(),'codex-native-input-'));writeFileSync(join(root,'.codex-prototype-owned'),'restricted-prototype');
  const data=new Map<string,unknown>();let writeHook=async()=>{};
  const storage={get:<T>(key:string,fallback:T)=>(data.get(key)??fallback)as T,update:async(key:string,value:unknown)=>{await writeHook();data.set(key,structuredClone(value));}};
  const ledger=new Store(join(root,'ledger.json')),choices=new ModelSelections(storage),modes=new ModeSelections(storage),rpc=new EventEmitter()as any,calls:{method:string;params:any}[]=[],responses:any[]=[],rejections:any[]=[];
  let prepareHook=async()=>{},beforeAdmission=async()=>{},respondFails=false;
  rpc.request=async(method:string,params:any)=>{
    calls.push({method,params});
    if(method==='config/read')return{config:{features:{apps:false},apps:{_default:{enabled:false}},mcp_servers:Object.fromEntries(DISABLED_MCP.map(n=>[n,{enabled:false}])),plugins:Object.fromEntries(DISABLED_PLUGINS.map(n=>[n,{enabled:false}]))}};
    if(method==='mcpServerStatus/list'){await prepareHook();return{data:DISABLED_MCP.map(name=>({name,runtimeStatus:'disabled',tools:{},resources:[],resourceTemplates:[]})),nextCursor:null};}
    if(method==='model/list')return{data:models,nextCursor:null};
    if(method==='collaborationMode/list')return{data:[{name:'Plan',mode:'plan',model:'unapproved-model',reasoning_effort:'medium'},{name:'Default',mode:'default',model:null,reasoning_effort:null}]};
    if(method==='thread/start')return{thread:{id:'thread',cwd:root,historyMode:'legacy',turns:[]},cwd:root,model:'gpt-6-luna',reasoningEffort:'low'};
    if(method==='turn/start'){const turn={id:'turn',status:'inProgress',items:[],itemsView:'full',error:null};rpc.emit('notification',{method:'turn/started',params:{threadId:'thread',turn}});await beforeAdmission();return{turn};}
    if(method==='turn/interrupt')return{};
    throw Error('Unexpected '+method);
  };
  rpc.respond=(id:any,result:any)=>{responses.push({id,result});if(respondFails)throw Error('Lost response write');};rpc.reject=(id:any,message:string)=>rejections.push({id,message});rpc.dispose=async()=>{};
  const session=new Session(rpc,root,ledger,undefined,undefined,undefined,choices,undefined,undefined,undefined,undefined,false,modes);session.on('change',()=>{});
  await session.models.refresh();await session.modes.refresh();await session.newThread();
  const ask=(id:string|number=0,params:any=question())=>rpc.emit('request',{id,method:'item/tool/requestUserInput',params});
  const terminal=()=>rpc.emit('notification',{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',items:[],itemsView:'full',error:null}}});
  return{root,data,ledger,choices,modes,rpc,session,calls,responses,rejections,ask,terminal,writeHook:(fn:()=>Promise<void>)=>writeHook=fn,prepareHook:(fn:()=>Promise<void>)=>prepareHook=fn,beforeAdmission:(fn:()=>Promise<void>)=>beforeAdmission=fn,respondFails:()=>respondFails=true};
}
describe('native plan selection and live questions',()=>{
  it('ordinary chat is unchanged; explicit plan preserves the selected model/effort and read-only policy, never preset replacements',async()=>{
    const f=await fixture();await f.session.send('ordinary');expect(f.calls.find(c=>c.method==='turn/start')!.params).not.toHaveProperty('collaborationMode');f.terminal();
    const paused:string[]=[];f.session.on('queue-pause',v=>paused.push(v));await f.session.selectNextMode('plan');await f.session.send('plan');
    const sent=f.calls.filter(c=>c.method==='turn/start').at(-1)!.params;
    expect(sent).toMatchObject({collaborationMode:{mode:'plan',settings:{model:'gpt-6-luna',reasoning_effort:'low',developer_instructions:null}},sandboxPolicy:{type:'readOnly',networkAccess:false},approvalPolicy:'untrusted',approvalsReviewer:'user'});
    expect(paused).toHaveLength(1);expect(JSON.stringify(sent)).not.toContain('unapproved-model');
  });
  it('explicit ordinary mode resets plan and survives local store reconstruction without silently changing another thread',async()=>{
    const f=await fixture();await f.session.selectNextMode('plan');await f.session.selectNextMode('default');
    const restored=new ModeSelections({get:<T>(k:string,d:T)=>(f.data.get(k)??d)as T,update:async()=>{}});expect(restored.read('thread')).toBe('default');expect(restored.read('other')).toBeUndefined();
    await f.session.send('reset');expect(f.calls.find(c=>c.method==='turn/start')!.params.collaborationMode.mode).toBe('default');
  });
  it('a fresh resume receipt supersedes an older accepted model override when mode settings inherit an unknown effort',async()=>{
    const f=await fixture();await f.session.selectNextModel({model:'gpt-6-luna',effort:'low'});await f.session.selectNextMode('plan');await f.session.send('first');f.terminal();await f.session.selectNextModel(undefined);
    const original=f.rpc.request;f.rpc.request=async(method:string,params:any)=>{const thread={id:'thread',cwd:f.root,historyMode:'legacy',status:{type:'idle'},turns:[{id:'turn',status:'completed',items:[],itemsView:'full',error:null,durationMs:null}]};if(method==='thread/read')return{thread};if(method==='thread/resume')return{thread,cwd:f.root,model:'gpt-6-luna',reasoningEffort:null};return original(method,params);};
    await f.session.restore('thread');expect(f.session.modelView()?.observed?.effort).toBeNull();expect(f.session.modelView()?.submitted).toBeUndefined();await expect(f.session.send('must not invent previous effort')).rejects.toThrow('明确的模型和思考强度');expect(f.calls.filter(value=>value.method==='turn/start')).toHaveLength(1);
  });
  it('a stale mode catalog blocks explicit mode dispatch before reservation but does not block ordinary chat',async()=>{
    const f=await fixture();await f.session.selectNextMode('plan');f.session.modes.invalidate('disconnected');await expect(f.session.send('blocked')).rejects.toThrow('模式');expect(f.ledger.read().attempts).toHaveLength(0);
    const ordinary=await fixture();ordinary.session.modes.invalidate('not available');expect(await ordinary.session.send('ordinary')).toBe(true);
  });
  it('preserves an unacknowledged mode save and blocks sending without retry',async()=>{
    const f=await fixture();let release!:()=>void;f.writeHook(()=>new Promise<void>(r=>release=r));const pending=f.session.selectNextMode('plan');
    await expect(f.session.send('too soon')).rejects.toThrow('尚在保存');while(!release)await Promise.resolve();release();await pending;expect(f.modes.read('thread')).toBe('plan');
    f.data.set(DAILY_MODE_SELECTION_KEY,{version:9,private:'preserve'});await expect(f.session.send('foreign')).rejects.toThrow('已变化');expect(f.data.get(DAILY_MODE_SELECTION_KEY)).toEqual({version:9,private:'preserve'});
  });
  it('rejects an outdated mode snapshot during asynchronous preparation without sending or reserving',async()=>{
    const f=await fixture();await f.session.selectNextMode('plan');let once=false;f.prepareHook(async()=>{if(!once){once=true;await f.modes.set('thread','default',()=>true);}});
    expect(await f.session.send('stale')).toBe(false);expect(f.calls.some(c=>c.method==='turn/start')).toBe(false);expect(f.ledger.read().attempts).toHaveLength(0);
  });
  it('accepts numeric request ID zero, sends one exact native answer and waits for resolved acknowledgement',async()=>{
    const f=await fixture();await f.session.send('ask');f.ask();expect(f.session.waitingForUserInput).toBe(true);expect(f.session.steerableTurnId).toBeUndefined();const token=f.session.userInputs.get(0)!.callbackToken;
    await f.session.answerUserInput(0,token,'answer',{color:'Blue'});expect(f.responses).toEqual([{id:0,result:{answers:{color:{answers:['Blue']}}}}]);
    expect(f.session.userInputs.get(0)!.status).toBe('submitted');await expect(f.session.answerUserInput(0,token,'answer',{color:'Red'})).rejects.toThrow('已提交');
    f.rpc.emit('notification',{method:'serverRequest/resolved',params:{threadId:'thread',requestId:0}});expect(f.session.waitingForUserInput).toBe(false);expect(f.ledger.read().pendingApprovals??[]).toHaveLength(0);expect(f.responses).toHaveLength(1);
  });
  it('question, answer and completion arriving before turn/start response cannot be overwritten by the late admission',async()=>{
    const f=await fixture();f.beforeAdmission(async()=>{f.ask();await f.session.answerUserInput(0,f.session.userInputs.get(0)!.callbackToken,'answer',{color:'Blue'});f.terminal();});
    expect(await f.session.send('early answer')).toBe(true);expect(f.session.busy).toBe(false);expect(f.session.status).toBe('completed');expect(f.session.waitingForUserInput).toBe(false);expect(f.responses).toHaveLength(1);expect(f.ledger.read().attempts.at(-1)?.status).toBe('completed');
  });
  it('does not confuse numeric/string IDs, callback tokens, foreign threads or terminal questions',async()=>{
    const f=await fixture();await f.session.send('ask');f.ask();const token=f.session.userInputs.get(0)!.callbackToken;
    await expect(f.session.answerUserInput('0',token,'answer',{color:'Blue'})).rejects.toThrow('失效');await expect(f.session.answerUserInput(0,'wrong','answer',{color:'Blue'})).rejects.toThrow('失效');
    f.rpc.emit('notification',{method:'serverRequest/resolved',params:{threadId:'foreign',requestId:0}});expect(f.session.waitingForUserInput).toBe(true);f.terminal();
    await expect(f.session.answerUserInput(0,token,'answer',{color:'Blue'})).rejects.toThrow('失效');expect(f.responses).toEqual([]);
  });
  it('skip responds with empty native answers while stop interrupts without fabricating any answer',async()=>{
    const f=await fixture();await f.session.send('ask');f.ask();await f.session.answerUserInput(0,f.session.userInputs.get(0)!.callbackToken,'skip');expect(f.responses).toEqual([{id:0,result:{answers:{}}}]);expect(f.calls.some(c=>c.method==='turn/interrupt')).toBe(false);
    await f.session.answerUserInput(0,f.session.userInputs.get(0)!.callbackToken,'stop');expect(f.calls.filter(c=>c.method==='turn/interrupt')).toHaveLength(1);expect(f.responses).toHaveLength(1);expect(f.session.waitingForUserInput).toBe(false);
  });
  it('cancellation and disconnect retain only recovery identity, never question text or answer drafts',async()=>{
    const f=await fixture();await f.session.send('ask');f.ask();const token=f.session.userInputs.get(0)!.callbackToken;
    expect(JSON.stringify(f.ledger.read())).not.toContain('Choose the known color');f.rpc.emit('disconnect',Error('Fixture disconnect'));
    expect(f.session.waitingForUserInput).toBe(false);await expect(f.session.answerUserInput(0,token,'answer',{color:'Blue'})).rejects.toThrow('失效');expect(f.responses).toEqual([]);
    expect(f.ledger.read().invalidatedApprovals).toEqual(expect.arrayContaining([expect.objectContaining({threadId:'thread',turnId:'turn',kind:'item/tool/requestUserInput'})]));
  });
  it('a response transport failure is unknown, clears the old callback and cannot resend',async()=>{
    const f=await fixture();await f.session.send('ask');f.ask();const token=f.session.userInputs.get(0)!.callbackToken;f.respondFails();await expect(f.session.answerUserInput(0,token,'answer',{color:'Blue'})).rejects.toThrow('Lost response');
    expect(f.session.sendOutcomeUncertain).toBe(true);await expect(f.session.answerUserInput(0,token,'answer',{color:'Blue'})).rejects.toThrow('失效');expect(f.responses).toHaveLength(1);
  });
  it('waiting for native input blocks steer, model/mode changes and permission selection',async()=>{
    const f=await fixture();await f.session.send('ask');f.ask();expect(f.session.modelView()!.canSelect).toBe(false);expect(f.session.modeView()!.canSelect).toBe(false);expect(f.session.permissionView().canSelect).toBe(false);
    await expect(f.session.steer('not an answer',undefined,[],[],'turn')).rejects.toThrow('当前没有');await expect(f.session.selectNextModel({model:'gpt-6-luna',effort:'low'})).rejects.toThrow('状态');await expect(f.session.selectNextMode('default')).rejects.toThrow('状态');expect(f.responses).toEqual([]);
  });
  it('a replaced page/connection cannot select a mode or consume another page callback',async()=>{
    const f=await fixture();let connectionId=1;const replies:any[]=[],host=new CollaborationModeHost(()=>({session:f.session,connectionId}),()=>true);
    await host.handle({type:'chat-mode',id:1,threadId:'thread',connectionId:2,action:'select',mode:'plan'},v=>replies.push(v));expect(f.modes.read('thread')).toBeUndefined();expect(replies[0].ok).toBe(false);
    let release!:()=>void;f.writeHook(()=>new Promise<void>(r=>release=r));const saving=host.handle({type:'chat-mode',id:2,threadId:'thread',connectionId:1,action:'select',mode:'plan'},v=>replies.push(v));while(!release)await Promise.resolve();connectionId=2;release();await saving;expect(replies).toHaveLength(1);
  });
});
describe('native answer semantics and defensive bounds',()=>{
  it('keeps one option label or trimmed custom text per question, permits explicit skips and prototype-shaped IDs',()=>{
    const p=question();p.questions[0]!.id='__proto__';const answers=JSON.parse('{"__proto__":"Blue"}');validateUserInput(p);expect(JSON.parse(JSON.stringify(userInputResponse(p,answers)))).toEqual(JSON.parse('{"answers":{"__proto__":{"answers":["Blue"]}}}'));
    p.questions[0]!.id='constructor';expect(userInputResponse(p,{})).toEqual({answers:{}});expect(userInputResponse(question(),{color:'  custom value  '})).toEqual({answers:{color:{answers:['custom value']}}});
  });
  it('rejects invalid IDs/options or oversized payloads without dropping content to make them fit',()=>{
    const p=question();p.questions[0]!.isOther=false;expect(()=>userInputResponse(p,{color:'invented'})).toThrow('选项');expect(()=>userInputResponse(p,{unknown:'Blue'})).toThrow('失效');expect(()=>userInputResponse(p,{color:'x'.repeat(20001)})).toThrow('超过');
    expect(()=>validateUserInput({...p,questions:Array(4).fill(p.questions[0])})).toThrow('未完整');expect(()=>validateUserInput({...p,questions:[{...p.questions[0],options:[{label:'same',description:''},{label:'same',description:''}]}]})).toThrow('选项');
  });
});
