import {describe, it, expect} from 'vitest';
import {EventEmitter,once} from 'node:events';import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {Script} from 'node:vm';
import {html} from '../src/codex-prototype/webview';
import {Projection} from '../src/codex-prototype/state';
import {Session, allowedCommand} from '../src/codex-prototype/session';
import {Store, ownedPath, imageInput, REAL_TURN_LIMIT} from '../src/codex-prototype/storage';
import {Rpc,RpcRequestRejected, type Transport} from '../src/codex-prototype/rpc';
import {DISABLED_MCP, DISABLED_PLUGINS} from '../src/codex-prototype/tools';
import {runtimeState} from '../src/codex-prototype/runtime-state';
import {codexPageContent} from '../src/codex-prototype/codex-page-state';

class Mock extends EventEmitter {
  calls: {method:string;params:any}[]=[];
  replies: any[]=[];
  handler: (method:string,params:any)=>Promise<any> = async m => {
    if(m==='thread/start')return {cwd:this.root,thread:{id:'thread',cwd:this.root,historyMode:'legacy',turns:[]}};
    if(m==='turn/start')return {turn:turn('inProgress')};
    return {};
  };
  root='';
  request(method:string,params:any){
    this.calls.push({method,params});
    if(method==='config/read')return Promise.resolve({config:{features:{apps:false},apps:{_default:{enabled:false}},mcp_servers:Object.fromEntries(DISABLED_MCP.map(n=>[n,{enabled:false}])),plugins:Object.fromEntries(DISABLED_PLUGINS.map(n=>[n,{enabled:false}]))}});
    if(method==='mcpServerStatus/list')return Promise.resolve({data:DISABLED_MCP.map(name=>({name,runtimeStatus:'disabled',tools:{},toolsError:null,resources:[],resourceTemplates:[]})),nextCursor:null});
    return this.handler(method,params)
  }
  respond(id:any,result:any){this.replies.push({id,result})}
  reject(id:any,message:string){this.replies.push({id,error:message})}
  async dispose(){this.emit('disconnect',new Error('closed'))}
}
const turn=(status:string,items:any[]=[])=>({id:'turn',status,items,error:null});
const agent=(text='')=>({type:'agentMessage',id:'agent',text,phase:null,memoryCitation:null,delivery:null,questions:null});
const approval=(id:any='approval',method='item/commandExecution/requestApproval')=>({id,method,params:{kind:'command',threadId:'thread',turnId:'turn',itemId:'command',startedAtMs:0,command:"Write-Output 'prototype-ok'",environmentId:null}});
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(){
  const dir=mkdtempSync(join(tmpdir(),'codex-prototype-sim-'));const root=join(dir,'workspace');mkdirSync(root);
  const mock=new Mock();mock.root=root;const store=new Store(join(dir,'ledger.json'));
  const s=new Session(mock as unknown as Transport,root,store);s.on('change',()=>{});
  return {s,mock,store,root,dir};
}
function event(mock:Mock,method:string,params:any){mock.emit('notification',{method,params:{threadId:'thread',turnId:'turn',...params}})}
function decide(s: Session,id:string|number,accept:boolean){return s.decide(id,accept,s.approvals.get(id)?.callbackToken??'expired-test-callback')}

describe('Codex prototype — local simulations (no model calls)',()=>{
  it.each(['wrong-receipt-cwd','wrong-thread-cwd','existing-id','empty-id'])('rejects %s before adopting a thread',async kind=>{
    const {s,mock,root,store}=setup();if(kind==='existing-id')store.own('thread');
    mock.handler=async()=>({cwd:kind==='wrong-receipt-cwd'?join(root,'other'):root,thread:{id:kind==='empty-id'?'':'thread',cwd:kind==='wrong-thread-cwd'?join(root,'other'):root,turns:[]}});
    const before=store.read();await expect(s.newThread()).rejects.toThrow('未核对');expect(store.read()).toEqual(before);expect(s.projection.threadId).toBe('');
  });
  it('generated webview script is valid JavaScript under its CSP nonce',()=>{
    const page=html('test',{vendor:'',display:''});const script=page.match(/<script nonce="test" data-main>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();expect(()=>new Script(script!)).not.toThrow();expect(page).toContain("default-src 'none'");
  });
  it('projects split deltas, final authoritative text, duplicate completion and ignores foreign/late events',()=>{
    const p=new Projection();p.snapshot({id:'thread',turns:[]} as any);
    const n=(method:string,params:any)=>p.apply({method,params:{threadId:'thread',turnId:'turn',...params}} as any);
    n('turn/started',{turn:turn('inProgress')});n('item/agentMessage/delta',{itemId:'agent',delta:'你好'});
    n('item/started',{item:agent()});n('item/agentMessage/delta',{itemId:'agent',delta:'世界'});
    expect((p.items.get('agent')!.item as any).text).toBe('你好世界');
    n('item/completed',{item:agent('你好世界。')});n('item/completed',{item:agent('你好世界。')});
    n('item/agentMessage/delta',{itemId:'agent',delta:'bad'});
    n('turn/completed',{turn:turn('completed')});n('turn/started',{turn:turn('inProgress')});
    n('item/completed',{threadId:'other',item:agent('foreign')});
    expect(p.items.size).toBe(1);expect((p.items.get('agent')!.item as any).text).toBe('你好世界。');expect(p.activeTurn()).toBeUndefined();
  });
  it('cancel before turn/start response still interrupts exactly once and reaches interrupted',async()=>{
    const {s,mock,store}=setup();await s.newThread();
    let finish!: (x:any)=>void;mock.handler=async m=>m==='turn/start'?new Promise(resolve=>{finish=resolve}):{};
    const sending=s.send('test');await flush();await s.cancel();
    event(mock,'turn/started',{turn:turn('inProgress')});await flush();finish({turn:turn('inProgress')});await sending;
    expect(mock.calls.filter(c=>c.method==='turn/interrupt')).toHaveLength(1);
    event(mock,'turn/completed',{turn:turn('interrupted')});expect(s.busy).toBe(false);expect(store.read().attempts[0]?.status).toBe('interrupted');
  });
  it('does not revive a deleted thread or interrupt the empty selection when a turn-start receipt arrives late',async()=>{
    const {s,mock,store}=setup();await s.newThread();let finish!:(value:any)=>void;
    mock.handler=async m=>m==='turn/start'?new Promise(r=>finish=r):{};
    const sending=s.send('before deletion');await flush();event(mock,'thread/deleted',{});const blockedUntilReceipt=s.busy;
    finish({turn:turn('inProgress')});expect(await sending).toBe(true);
    expect(blockedUntilReceipt).toBe(true);expect(s.busy).toBe(false);expect(s.projection.threadId).toBe('');expect(s.projection.turns.size).toBe(0);
    expect(mock.calls.filter(c=>c.method==='turn/interrupt')).toEqual([]);expect(store.read().attempts[0]?.turnId).toBe('turn');
  });
  it.each(['interrupted','failed','completed'])('settles retained partial text for display/copy when %s omits item completion',status=>{
    const p=new Projection();p.snapshot({id:'thread',turns:[]} as any);
    const n=(method:string,params:any)=>p.apply({method,params:{threadId:'thread',turnId:'turn',...params}} as any);
    n('turn/started',{turn:turn('inProgress')});n('item/started',{item:agent()});
    n('item/agentMessage/delta',{itemId:'agent',delta:'retained partial'});
    expect(p.items.get('agent')!.complete).toBe(false);
    n('turn/completed',{turn:turn(status)});
    expect(p.items.get('agent')!.complete).toBe(true);expect(p.activeTurn()).toBeUndefined();
    n('item/agentMessage/delta',{itemId:'agent',delta:'late'});
    expect((p.items.get('agent')!.item as any).text).toBe('retained partial');
  });
  it('terminal notification before start response cannot make the next send busy forever',async()=>{
    const {s,mock}=setup();await s.newThread();mock.handler=async m=>{if(m==='turn/start'){event(mock,'turn/started',{turn:turn('inProgress')});event(mock,'turn/completed',{turn:turn('completed')});return{turn:turn('inProgress')}}return{}};
    await s.send('hello');expect(s.busy).toBe(false);
  });
  it('old lifecycle/usage notifications cannot clear a newer turn or overwrite its budget entry',async()=>{
    const {s,mock,store}=setup();await s.newThread();await s.send('one');event(mock,'turn/completed',{turn:turn('completed')});
    mock.handler=async m=>{if(m==='turn/start'){event(mock,'turn/started',{turn:{...turn('inProgress'),id:'turn2'}});return {turn:{...turn('inProgress'),id:'turn2'}}}return{}};
    await s.send('two');event(mock,'turn/started',{turn:turn('inProgress')});event(mock,'turn/completed',{turn:turn('completed')});
    event(mock,'thread/tokenUsage/updated',{tokenUsage:{total:{totalTokens:100},last:{}},turnId:'turn'});
    expect(s.busy).toBe(true);expect(store.read().attempts[1]?.turnId).toBe('turn2');expect(store.read().attempts[1]?.usage).toBeUndefined();expect((store.read().attempts[0]?.usage as any)?.total.totalTokens).toBe(100);
  });
  it('ambiguous failed turn/start reserves budget and requires recovery before another send',async()=>{
    const {s,mock,store}=setup();await s.newThread();mock.handler=async()=>{throw Error('lost response')};
    await expect(s.send('one')).rejects.toThrow('lost');expect(s.sendOutcomeUncertain).toBe(true);expect(s.toolCheck.verified).toBe(true);expect(runtimeState(s,true,false,'')).toMatchObject({ready:true,needsRecovery:true});await expect(s.send('two')).rejects.toThrow('恢复');expect(store.read().attempts).toHaveLength(1);
  });
  it('keeps the reservation but distinguishes an explicit rejection from an unknown dispatch outcome',async()=>{
    const {s,mock,store}=setup();await s.newThread();mock.handler=async()=>{throw new RpcRequestRejected('explicit rejection');};
    await expect(s.send('one')).rejects.toThrow('explicit');expect(s.sendOutcomeUncertain).toBe(false);expect(s.busy).toBe(false);expect(store.read().attempts).toHaveLength(1);expect(store.read().attempts[0]?.status).toBe('requestRejected');expect(mock.calls.filter(c=>c.method==='turn/start')).toHaveLength(1);
  });
  it('disconnect invalidates public readiness while retaining readable history and a manual reconnect path',async()=>{
    const {s,mock}=setup();await s.newThread();s.projection.snapshot({id:'thread',turns:[turn('completed',[agent('kept')])]}as any);
    expect(runtimeState(s,true,false,'').ready).toBe(true);mock.emit('disconnect',Error('synthetic transport loss'));
    expect(runtimeState(s,true,false,'')).toMatchObject({ready:false,busy:false,connecting:false,error:'synthetic transport loss'});const calls=mock.calls.length;await expect(s.restore('thread')).rejects.toThrow('手动重连');await expect(s.newThread()).rejects.toThrow('手动重连');expect(mock.calls.length).toBe(calls);expect((s.projection.items.get('agent')?.item as any).text).toBe('kept');
  });
  it('records current failure ownership and clears that association for any later operation error',async()=>{
    const {s,mock}=setup();await s.newThread();await s.send('one');event(mock,'turn/completed',{turn:{...turn('failed'),error:{message:'same failure'}}});expect(runtimeState(s,true,false,'')).toMatchObject({error:'same failure',errorTurnId:'turn'});
    s.error='same failure';expect(runtimeState(s,true,false,'').errorTurnId).toBeUndefined();
  });
  it('publishes startup failure without a session and locks duplicate connect attempts',()=>{
    expect(runtimeState(undefined,false,false,'pin failed')).toMatchObject({error:'pin failed',ready:false,connecting:false});expect(runtimeState(undefined,false,true,'')).toMatchObject({error:'',ready:false,connecting:true});
  });
  it('approval queue preserves numeric/string IDs, explicit allow/deny, cancel and late-click guards',async()=>{
    const {s,mock,root}=setup();await s.newThread();await s.send('hello');
    mock.emit('request',{...approval(1),params:{...approval().params,cwd:root}});
    mock.emit('request',{...approval('1'),params:{...approval().params,cwd:root}});
    await flush();expect(s.approvals.size).toBe(2);expect(mock.replies).toHaveLength(0);
    await decide(s,1,true);await decide(s,'1',false);
    expect(mock.replies).toEqual([{id:1,result:{decision:'accept'}},{id:'1',result:{decision:'decline'}}]);
    await expect(decide(s,1,true)).rejects.toThrow('失效');
    mock.emit('request',{...approval(2),params:{...approval().params,cwd:root}});await s.cancel();
    expect(mock.replies.at(-1)).toEqual({id:2,result:{decision:'decline'}});await expect(decide(s,2,true)).rejects.toThrow();
    mock.emit('request',approval(3));await flush();expect(mock.replies.at(-1)).toEqual({id:3,result:{decision:'decline'}});
  });
  it('headless or disconnected approvals fail closed; unknown requests error and interrupt',async()=>{
    const {s,mock}=setup();await s.newThread();await s.send('test');s.removeAllListeners('change');
    mock.emit('request',approval());await flush();expect(mock.replies[0]?.result.decision).toBe('decline');
    mock.emit('request',{id:8,method:'item/permissions/requestApproval',params:{}});await flush();expect(mock.replies[1]?.error).toContain('未接入');expect(mock.calls.at(-1)?.method).toBe('turn/interrupt');
    mock.emit('disconnect',new Error('lost'));expect(s.busy).toBe(false);expect(s.approvals.size).toBe(0);await expect(s.send('again')).rejects.toThrow();
  });
  it('command approval cannot escape scope or amend session policy',async()=>{
    const {s,mock,root}=setup();await s.newThread();await s.send('test');
    mock.emit('request',{...approval(),params:{...approval().params,cwd:root,command:'Invoke-WebRequest https://example.com'}});
    await expect(decide(s,'approval',true)).rejects.toThrow('超出');expect(mock.replies).toHaveLength(0);await decide(s,'approval',false);
  });
  it('projects the actual approval acceptance guard before displaying an enabled allow control',async()=>{
    const {s,mock,root}=setup();await s.newThread();await s.send('test');
    mock.emit('request',{...approval(),params:{...approval().params,cwd:root,command:'Get-Date'}});
    const page=await codexPageContent(s,'thread',async()=>{throw Error('No image expected');});
    expect(page.approvals[0]).toMatchObject({id:'approval',acceptance:{allowed:false,reason:expect.stringContaining('超出')}});
    expect(mock.replies).toHaveLength(0);await expect(decide(s,'approval',true)).rejects.toThrow('超出');await decide(s,'approval',false);
    mock.emit('request',{...approval('allowed'),params:{...approval().params,cwd:root}});
    const allowed=await codexPageContent(s,'thread',async()=>{throw Error('No image expected');});
    expect(allowed.approvals[0]).toMatchObject({id:'allowed',acceptance:{allowed:true,reason:''}});expect(mock.replies.at(-1)?.result.decision).toBe('decline');
    const token=s.approvals.get('allowed')!.callbackToken;await decide(s,'allowed',false);
    expect(await s.approvalAcceptance('allowed',token)).toMatchObject({allowed:false,reason:expect.stringContaining('失效')});
  });
  it('accepts only the observed pinned Windows shell wrapper and the exact safe command body',()=>{
    const shell=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe').replaceAll('\\','\\\\');
    expect(allowedCommand(`"${shell}" -Command "Write-Output 'prototype-approval-ok'"`)).toBe(true);
    expect(allowedCommand(`"${shell}" -Command "Write-Output 'prototype-approval-ok'; Get-Content C:/other"`)).toBe(false);
    expect(allowedCommand(`"${shell}" -Command "Write-Output '$env:TOKEN'"`)).toBe(false);
    expect(allowedCommand(`"C:/other/pwsh.exe" -Command "Write-Output 'ok'"`)).toBe(false);
  });
  it('projects and submits the observed NoProfile wrapper without allowing extra command scope',async()=>{
    const {s,mock,root}=setup();await s.newThread();await s.send('test');
    const shell=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe').replaceAll('\\','\\\\');
    mock.emit('request',{...approval('no-profile'),params:{...approval().params,cwd:root,command:`"${shell}" -NoProfile -Command "Write-Output 'FILETOOLS_LIVE_0152_OK'"`}});
    const page=await codexPageContent(s,'thread',async()=>{throw Error('No image expected');});
    expect(page.approvals[0]).toMatchObject({id:'no-profile',acceptance:{allowed:true,reason:''}});
    expect(mock.replies).toHaveLength(0);await decide(s,'no-profile',true);
    expect(mock.replies).toEqual([{id:'no-profile',result:{decision:'accept'}}]);
    await expect(decide(s,'no-profile',true)).rejects.toThrow('失效');
  });
  it('file approval allows owned paths only and rejects grantRoot/missing differences',async()=>{
    const {s,mock,root}=setup();await s.newThread();await s.send('test');
    const req={...approval('file','item/fileChange/requestApproval'),params:{threadId:'thread',turnId:'turn',itemId:'file',startedAtMs:0}};
    mock.emit('request',req);expect(await s.approvalAcceptance('file',s.approvals.get('file')!.callbackToken)).toMatchObject({allowed:false,reason:expect.stringContaining('差异')});await expect(decide(s,'file',true)).rejects.toThrow('差异');
    event(mock,'item/started',{item:{type:'fileChange',id:'file',changes:[{path:join(root,'ok.txt'),diff:'+hello',kind:{type:'add'}}],status:'inProgress'}});
    expect(await s.approvalAcceptance('file',s.approvals.get('file')!.callbackToken)).toEqual({allowed:true,reason:''});expect(mock.replies).toHaveLength(0);await decide(s,'file',true);expect(mock.replies.at(-1)?.result.decision).toBe('accept');
    event(mock,'item/started',{item:{type:'fileChange',id:'file',changes:[{path:join(root,'../bad.txt'),diff:'bad'}],status:'inProgress'}});mock.emit('request',req);
    expect(await s.approvalAcceptance('file',s.approvals.get('file')!.callbackToken)).toMatchObject({allowed:false,reason:expect.stringContaining('超出')});await expect(decide(s,'file',true)).rejects.toThrow('超出');await decide(s,'file',false);
    event(mock,'item/started',{item:{type:'fileChange',id:'file',changes:[{path:join(root,'ok.txt'),diff:'move',kind:{type:'update',move_path:join(root,'../escaped.txt')}}],status:'inProgress'}});mock.emit('request',req);
    await expect(decide(s,'file',true)).rejects.toThrow('超出');await decide(s,'file',false);
    mock.emit('request',{...req,params:{...req.params,grantRoot:root}});await expect(decide(s,'file',true)).rejects.toThrow('扩大');
  });
  it('snapshot recovery is idempotent, rejects foreign thread and preserves an interrupted message',async()=>{
    const {s,mock,store,root}=setup();await s.newThread();
    mock.handler=async()=>({thread:{id:'thread',cwd:root,historyMode:'legacy',turns:[turn('interrupted',[agent('partial')])]}});
    await s.restore('thread');await s.restore('thread');expect(s.projection.items.size).toBe(1);expect(s.busy).toBe(false);expect(store.read().attempts).toHaveLength(0);
    await expect(s.restore('foreign')).rejects.toThrow('非本任务');
  });
  it('an empty new thread keeps the last recoverable selection; explicit send reserves and selects atomically',async()=>{
    const {s,store}=setup();store.own('saved');store.select('saved');
    await s.newThread();expect(store.read().selected).toBe('saved');
    expect(store.read().threads).toContain('thread');
    await s.send('explicit');expect(store.read().selected).toBe('thread');
    expect(store.read().attempts).toHaveLength(1);
  });
  it('returns to a verified never-sent thread on the same connection without trying to resume missing persisted history',async()=>{
    const {s,mock,store,root}=setup();await s.newThread();store.own('saved');store.select('saved');
    mock.handler=async(m,p)=>{if(p.threadId==='thread')throw Error('thread not loaded: thread');return{thread:{id:'saved',cwd:root,historyMode:'legacy',turns:[turn('completed',[agent('saved')])]}};};
    await s.restore('saved');const before=mock.calls.length;await s.restore('thread');
    expect(s.projection.threadId).toBe('thread');expect(s.projection.items.size).toBe(0);expect(s.sendOutcomeUncertain).toBe(false);expect(s.toolCheck.verified).toBe(true);
    expect(mock.calls.slice(before).some(c=>['thread/read','thread/resume','thread/turns/list'].includes(c.method))).toBe(false);expect(store.read().selected).toBe('saved');
    mock.handler=async()=>({turn:turn('inProgress')});await s.send('explicit');expect(mock.calls.filter(c=>c.method==='turn/start')).toHaveLength(1);
  });
  it('does not reuse the empty-start proof after public activity materializes that thread',async()=>{
    const {s,mock,root}=setup();await s.newThread();event(mock,'item/completed',{item:agent('public')});
    mock.handler=async()=>({thread:{id:'thread',cwd:root,historyMode:'legacy',turns:[turn('completed',[agent('public')])]}});
    await s.restore('thread');expect(mock.calls.some(c=>c.method==='thread/read')).toBe(true);expect(s.projection.items.size).toBe(1);
  });
  it('restoring an owned history saves the choice for Reload instead of returning to a prior empty thread',async()=>{
    const {s,mock,store,root}=setup();store.own('empty');store.select('empty');store.own('saved');
    mock.handler=async()=>({thread:{id:'saved',cwd:root,historyMode:'legacy',turns:[turn('completed',[agent('saved body')])]}});
    await s.restore('saved');expect(new Store(store.path).read().selected).toBe('saved');
    expect(s.projection.threadId).toBe('saved');expect(s.error).toBe('');
  });
  it('an unloaded never-sent selection becomes an explicit empty state without blind resume, stale rows or repeated alarm',async()=>{
    const {s,mock,store,root}=setup();store.own('saved');store.own('empty');store.select('empty');
    s.projection.snapshot({id:'saved',cwd:root,turns:[turn('completed',[agent('old body')])]} as any);
    mock.handler=async()=>{throw Error('thread not loaded: empty')};
    await s.restore('empty');expect(s.status).toContain('草稿可编辑');expect(s.error).toBe('');expect(s.sendOutcomeUncertain).toBe(false);
    expect(s.projection.threadId).toBe('empty');expect(s.projection.items.size).toBe(0);
    expect(s.toolCheck.verified).toBe(false);await expect(s.send('blocked')).rejects.toThrow('空会话未保存');
    expect(new Store(store.path).read().selected).toBeUndefined();
    expect(store.read().threads).toEqual(['saved','empty']);expect(store.read().attempts).toHaveLength(0);
    expect(mock.calls.some(c=>c.method==='thread/resume'||c.method==='turn/start')).toBe(false);
  });
  it.each(['none','attempt','pending','invalidated','foreign-id'])('classifies the pinned 0.163 unmaterialized reply without hiding %s evidence',async evidence=>{
    const {s,mock,store}=setup();store.own('thread');store.select('thread');
    if(evidence==='attempt')store.reserve('thread','synthetic');
    if(evidence==='pending'||evidence==='invalidated'){store.pending({threadId:'thread',turnId:'old-turn',kind:'item/fileChange/requestApproval'});if(evidence==='invalidated')store.invalidate('thread','synthetic');}
    const id=evidence==='foreign-id'?'foreign':'thread',message='thread '+id+' is not materialized yet; thread/turns/list is unavailable before first user message';
    mock.handler=async()=>{throw Error(message);};
    if(evidence==='none'){await s.restore('thread');expect(s.status).toContain('草稿可编辑');expect(s.error).toBe('');expect(store.read().selected).toBeUndefined();}
    else{await expect(s.restore('thread')).rejects.toThrow(message);expect(store.read().selected).toBe('thread');expect(s.error).toBe(message);}
    expect(s.toolCheck.verified).toBe(false);expect(s.sendOutcomeUncertain).toBe(evidence!=='none');expect(s.projection.items.size).toBe(0);
    expect(mock.calls.some(c=>c.method==='thread/resume'||c.method==='turn/start')).toBe(false);
  });
  it.each(['attempt','pending','invalidated'])('a missing thread with %s evidence remains blocked and cannot be misclassified as empty',async(evidence)=>{
    const {s,mock,store}=setup();store.own('thread');store.select('thread');
    if(evidence==='attempt')store.reserve('thread','sim');
    else{store.pending({threadId:'thread',turnId:'turn',kind:'item/fileChange/requestApproval'});if(evidence==='invalidated')store.invalidate('thread','sim');}
    mock.handler=async()=>{throw Error('thread not loaded: thread')};
    await expect(s.restore('thread')).rejects.toThrow('thread not loaded');
    expect(store.read().selected).toBe('thread');expect(s.toolCheck.verified).toBe(false);
    expect(s.error).toContain('thread not loaded');await expect(s.send('blocked')).rejects.toThrow('恢复');
    expect(mock.calls.some(c=>c.method==='thread/resume'||c.method==='turn/start')).toBe(false);
  });
  it.each(['transport failed','thread not loaded: other'])('does not hide an unrelated recovery failure (%s)',async(message)=>{
    const {s,mock,store}=setup();store.own('thread');store.select('thread');mock.handler=async()=>{throw Error(message)};
    await expect(s.restore('thread')).rejects.toThrow(message);expect(store.read().selected).toBe('thread');expect(s.toolCheck.verified).toBe(false);
  });
  it('an imported prior-batch thread cannot be treated as empty just because the new batch has no attempts for it',async()=>{
    const {mock,store,root}=setup();store.own('prior');store.select('prior');
    const batchStore=new Store(store.path,2,['prior']);const s=new Session(mock as unknown as Transport,root,batchStore);s.on('change',()=>{});
    mock.handler=async()=>{throw Error('thread not loaded: prior')};
    await expect(s.restore('prior')).rejects.toThrow('thread not loaded');
    expect(batchStore.read().selected).toBe('prior');expect(s.toolCheck.verified).toBe(false);
    expect(mock.calls.some(c=>c.method==='thread/resume'||c.method==='turn/start')).toBe(false);
  });
  it('after an empty or failed restore the user can select another history; restoring a live empty thread does not replace it',async()=>{
    const {s,mock,store,root}=setup();store.own('empty');store.own('saved');store.select('saved');
    mock.handler=async m=>{if(m==='thread/read')throw Error('thread not loaded: empty');return{}};
    await s.restore('empty');expect(store.read().selected).toBe('saved');
    mock.handler=async(_m,p)=>({thread:{id:p.threadId,cwd:root,historyMode:'legacy',turns:p.threadId==='saved'?[turn('completed',[agent('saved')])]:[]}});
    await s.restore('saved');expect(s.toolCheck.verified).toBe(true);expect(s.error).toBe('');
    await s.restore('empty');expect(store.read().selected).toBe('saved');expect(s.projection.items.size).toBe(0);
  });
  it.each([
    ['command','window-reload-or-close'],['file','window-reload-or-close'],['command','server-restart'],['file','server-restart'],
  ])('invalidates pending %s approvals across %s without replay or old-ID acceptance',async(kind,reason)=>{
    const {s,mock,store,root}=setup();await s.newThread();await s.send('first');
    const method=kind==='command'?'item/commandExecution/requestApproval':'item/fileChange/requestApproval';
    const old={...approval(0,method),params:{...approval().params,cwd:root}};mock.emit('request',old);await flush();
    const oldToken=s.approvals.get(0)!.callbackToken;
    mock.handler=async m=>{if(m==='turn/interrupt')event(mock,'turn/completed',{turn:turn('interrupted')});return{}};
    await s.dispose(reason);
    expect(mock.replies).toEqual([{id:0,result:{decision:'decline'}}]);expect(store.read().pendingApprovals).toHaveLength(0);
    expect(store.read().invalidatedApprovals?.[0]?.reason).toBe(reason);await expect(s.decide(0,true,oldToken)).rejects.toThrow('失效');
    const next=new Mock();next.root=root;next.handler=async m=>m==='thread/resume'||m==='thread/read'?{thread:{id:'thread',cwd:root,historyMode:'legacy',turns:[turn('interrupted')]}}:m==='turn/start'?{turn:{...turn('inProgress'),id:'turn2'}}:{};
    const resumed=new Session(next as unknown as Transport,root,store);resumed.on('change',()=>{});await resumed.restore('thread');
    expect(next.calls.filter(c=>c.method==='turn/start')).toHaveLength(0);expect(store.read().attempts).toHaveLength(1);expect(resumed.status).toContain('失效');
    next.emit('request',old);await flush();expect(next.replies.at(-1)?.result.decision).toBe('decline');
    await resumed.send('explicit next message');next.emit('request',{...old,params:{...old.params,turnId:'turn2'}});await flush();
    const newToken=resumed.approvals.get(0)!.callbackToken;expect(newToken).not.toBe(oldToken);
    await expect(resumed.decide(0,true,oldToken)).rejects.toThrow('失效');expect(next.replies.filter(r=>r.result?.decision==='accept')).toHaveLength(0);
    await resumed.decide(0,false,newToken);expect(next.calls.filter(c=>c.method==='turn/start')).toHaveLength(1);
  });
  it('an abrupt disconnect persists pending invalidation and a resumed callback is declined',async()=>{
    const {s,mock,store,root}=setup();await s.newThread();await s.send('test');mock.emit('request',approval(9));await flush();mock.emit('disconnect',Error('lost'));
    expect(store.read().pendingApprovals).toHaveLength(0);expect(store.read().invalidatedApprovals?.[0]?.reason).toBe('connection-disconnected');
    const next=new Mock();next.handler=async()=>({thread:{id:'thread',cwd:root,historyMode:'legacy',turns:[turn('interrupted')]}});const resumed=new Session(next as unknown as Transport,root,store);resumed.on('change',()=>{});
    await resumed.restore('thread');next.emit('request',approval(9));await flush();expect(next.replies[0]?.result.decision).toBe('decline');expect(store.read().attempts).toHaveLength(1);
  });
  it('unknown pending runtime state stays blocked instead of claiming safe recovery',async()=>{
    const {s,store,root}=setup();await s.newThread();store.pending({threadId:'thread',turnId:'turn',kind:'item/fileChange/requestApproval'});
    const next=new Mock();next.handler=async m=>m==='thread/resume'||m==='thread/read'?{thread:{id:'thread',cwd:root,historyMode:'legacy',turns:[turn('inProgress')]}}:{};
    const resumed=new Session(next as unknown as Transport,root,store);resumed.on('change',()=>{});await resumed.restore('thread');
    expect(resumed.status).toContain('只能新建');await expect(resumed.send('unsafe')).rejects.toThrow('恢复');expect(next.calls.filter(c=>c.method==='turn/start')).toHaveLength(0);expect(next.calls.filter(c=>c.method==='thread/resume')).toHaveLength(0);
  });
  it('resolving or replacing a callback cannot accept the older callback token',async()=>{
    const {s,mock,root}=setup();await s.newThread();await s.send('test');mock.emit('request',{...approval(0),params:{...approval().params,cwd:root}});await flush();const token=s.approvals.get(0)!.callbackToken;
    event(mock,'serverRequest/resolved',{requestId:0});mock.emit('request',{...approval(0),params:{...approval().params,cwd:root}});await flush();
    await expect(s.decide(0,true,undefined as any)).rejects.toThrow('失效');
    await expect(s.decide(0,true,token)).rejects.toThrow('失效');expect(mock.replies).toHaveLength(0);
  });
  it('real budget persists across new Store instances, reserves failed attempts, refuses #13',()=>{
    const {store}=setup();store.own('thread');
    for(let i=0;i<REAL_TURN_LIMIT;i++)new Store(store.path).reserve('thread','mock-reservation');
    expect(new Store(store.path).read().attempts).toHaveLength(12);expect(()=>store.reserve('thread','extra')).toThrow('预算');expect(()=>store.reserve('foreign','test')).toThrow('本任务');
    expect(existsSync(store.path+'.lock')).toBe(false);
  });
  it('image validation rejects traversal, junction escape, excess size and preserves owned image',async()=>{
    const {root,dir}=setup();const image=join(root,'image.png');writeFileSync(image,Buffer.from([137,80,78,71,13,10,26,10]));expect(await imageInput(root,image)).toBe(image);
    writeFileSync(join(root,'invalid.png'),'invalid');await expect(imageInput(root,join(root,'invalid.png'))).rejects.toThrow('签名');
    await expect(ownedPath(root,'../outside.png')).rejects.toThrow('超出');
    const outside=join(dir,'outside');mkdirSync(outside);symlinkSync(outside,join(root,'link'),'junction');
    await expect(ownedPath(root,join(root,'link','new.png'))).rejects.toThrow('链接');
    writeFileSync(join(root,'big.png'),Buffer.alloc(5*1024*1024+1));await expect(imageInput(root,join(root,'big.png'))).rejects.toThrow('5 MiB');
  });
  it('canceling image preparation cannot issue a late turn/start or consume real-turn budget',async()=>{
    const {s,mock,root,store}=setup();await s.newThread();const path=join(root,'image.png');writeFileSync(path,Buffer.from([137,80,78,71,13,10,26,10]));
    const sending=s.send('image test',path,[],[],()=>true,[{path,sha256:createHash('sha256').update(Buffer.from([137,80,78,71,13,10,26,10])).digest('hex')}]);await s.cancel();expect(await sending).toBe(false);expect(s.sendOutcomeUncertain).toBe(false);
    expect(mock.calls.filter(c=>c.method==='turn/start')).toHaveLength(0);expect(store.read().attempts).toHaveLength(0);expect(s.busy).toBe(false);
  });
  it('stdio JSONL correlates IDs, supports server requests and cleans all pending RPC on malformed stream',async()=>{
    const code="const r=require('node:readline').createInterface({input:process.stdin});r.on('line',l=>{const x=JSON.parse(l);if(x.method==='initialize'){process.stdout.write(JSON.stringify({id:x.id,result:{ok:true}})+'\\n');process.stdout.write(JSON.stringify({id:'srv',method:'item/fileChange/requestApproval',params:{}})+'\\n')}else if(x.method==='thread/read')process.stdout.write('bad-json\\n')});";
    const rpc=new Rpc(spawn(process.execPath,['-e',code],{stdio:'pipe',windowsHide:true}),1000);
    const seen:any[]=[],incoming=once(rpc,'request');rpc.on('request',r=>seen.push(r));
    try{expect(await rpc.request('initialize',{clientInfo:{name:'test',title:null,version:'test'},capabilities:null})).toEqual({ok:true});expect((await incoming)[0].id).toBe('srv');expect(seen).toHaveLength(1);
    await expect(rpc.request('thread/read',{threadId:'t'})).rejects.toThrow();}finally{await rpc.dispose();}
  });
  it('a hanging RPC fails closed, rejects pending requests and terminates its owned subprocess',async()=>{
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'pipe',windowsHide:true});
    const rpc=new Rpc(child,150);
    await expect(rpc.request('thread/read',{threadId:'owned'})).rejects.toThrow('超时');await rpc.dispose();expect(child.exitCode!==null||child.signalCode!==null).toBe(true);
  });
});
