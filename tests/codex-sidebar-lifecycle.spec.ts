import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DraftStore,emptyDraft,DRAFT_KEY} from '../src/codex-prototype/draft-store';
import {ScrollViewStore,SCROLL_VIEW_KEY} from '../src/codex-prototype/scroll-view-store';
import {Store} from '../src/codex-prototype/storage';
import {localPowerShell7,type PowerShell7Binding} from '../src/codex-prototype/powershell7';
import {IMAGE_ASSETS} from '../src/codex-prototype/offline/image-assets';
import {prepareMath} from '../src/codex-prototype/display/dsh-math';
import {ThreadCatalog} from '../src/codex-prototype/thread-catalog';
import {DisplaySettingsStore,DISPLAY_SETTINGS_KEY} from '../src/codex-prototype/display-settings';
import {DISABLED_MCP,DISABLED_PLUGINS} from '../src/codex-prototype/tools';

const mock=vi.hoisted(()=>({
 commands:new Map<string,(...args:any[])=>any>(),providers:new Map<string,any>(),documentProviders:new Map<string,any>(),closeDocuments:new Set<(value:any)=>void>(),
 register:vi.fn(),execute:vi.fn(),createPanel:vi.fn(),clipboard:vi.fn(),saveDialog:vi.fn(),nativeImage:vi.fn(),workspaceRoot:'synthetic-owned-workspace',
 start:vi.fn(),makeSession:vi.fn(),batch:vi.fn(),speechStop:vi.fn(),checkImage:vi.fn(),dictationFactory:vi.fn(),dictationProbe:vi.fn(),dictationStart:vi.fn(),dictationStop:vi.fn(),dictationCancel:vi.fn(),dictationDispose:vi.fn(),dictationEvents:[] as ((value:any)=>void)[],editor:undefined as any,editorReads:vi.fn(),editorListeners:new Set<(value:any)=>void>(),saveListeners:new Set<(value:any)=>void>(),changeListeners:new Set<(value:any)=>void>(),selectionListeners:new Set<(value:any)=>void>(),diagnosticListeners:new Set<(value:any)=>void>(),diagnostics:vi.fn(()=>[] as any[]),windowState:{focused:true},windowListeners:new Set<()=>void>(),information:vi.fn(),warning:vi.fn()
}));
vi.mock('vscode',()=>({
 version:'1.136.0',ViewColumn:{One:1},
 commands:{registerCommand:(id:string,fn:any)=>{mock.commands.set(id,fn);return{dispose(){}};},executeCommand:mock.execute},
  window:{createOutputChannel:()=>({appendLine:vi.fn(),show:vi.fn(),dispose:vi.fn()}),showInformationMessage:mock.information,showWarningMessage:mock.warning,state:mock.windowState,onDidChangeWindowState:(fn:()=>void)=>{mock.windowListeners.add(fn);return{dispose:()=>mock.windowListeners.delete(fn)};},registerWebviewPanelSerializer:(_id:string,_serializer:any)=>({dispose(){}}),registerWebviewViewProvider:(id:string,provider:any,options:any)=>{mock.providers.set(id,provider);mock.register(id,options);return{dispose(){}};},createWebviewPanel:mock.createPanel,showSaveDialog:mock.saveDialog,get activeTextEditor(){mock.editorReads();return mock.editor;},onDidChangeActiveTextEditor:(fn:(value:any)=>void)=>{mock.editorListeners.add(fn);return{dispose:()=>mock.editorListeners.delete(fn)};},onDidChangeTextEditorSelection:(fn:(value:any)=>void)=>{mock.selectionListeners.add(fn);return{dispose:()=>mock.selectionListeners.delete(fn)};}},
 workspace:{textDocuments:[],get workspaceFolders(){return[{uri:{scheme:'file',fsPath:mock.workspaceRoot}}];},onDidSaveTextDocument:(fn:(value:any)=>void)=>{mock.saveListeners.add(fn);return{dispose:()=>mock.saveListeners.delete(fn)};},onDidChangeTextDocument:(fn:(value:any)=>void)=>{mock.changeListeners.add(fn);return{dispose:()=>mock.changeListeners.delete(fn)};},registerTextDocumentContentProvider:(scheme:string,provider:any)=>{mock.documentProviders.set(scheme,provider);return{dispose:()=>mock.documentProviders.delete(scheme)};},onDidCloseTextDocument:(fn:(value:any)=>void)=>{mock.closeDocuments.add(fn);return{dispose:()=>mock.closeDocuments.delete(fn)};}},
 languages:{getDiagnostics:mock.diagnostics,onDidChangeDiagnostics:(fn:(value:any)=>void)=>{mock.diagnosticListeners.add(fn);return{dispose:()=>mock.diagnosticListeners.delete(fn)};}},
 Position:class{constructor(public line:number,public character:number){}},Range:class{start;end;constructor(a:number,b:number,c:number,d:number){this.start={line:a,character:b};this.end={line:c,character:d};}},
 env:{clipboard:{writeText:mock.clipboard}},Uri:{file:(fsPath:string)=>({fsPath,scheme:'file'}),parse:(value:string)=>({scheme:value.split(':')[0],toString:()=>value})}
}));
vi.mock('../src/codex-prototype/rpc',()=>({Rpc:{start:mock.start}}));
vi.mock('../src/codex-prototype/session',()=>({Session:class{constructor(...args:any[]){return mock.makeSession(...args);}}}));
vi.mock('../src/codex-prototype/online-batch',()=>({DISPLAY_BATCH:{id:'synthetic',limit:2},displayBatch:mock.batch}));
vi.mock('../src/codex-prototype/storage',async importOriginal=>({...await importOriginal<object>(),assertOwnedWorkspace:vi.fn(async()=>{}),assertWorkspaceFiles:vi.fn(async()=>{})}));
vi.mock('../src/codex-prototype/local-speech',()=>({LocalSpeech:class{probe=async()=>false;stop=mock.speechStop;}}));
vi.mock('../src/codex-prototype/local-dictation',()=>({LocalDictation:class{constructor(path:string){mock.dictationFactory(path);}probe=mock.dictationProbe;start=mock.dictationStart;stop=mock.dictationStop;cancel=mock.dictationCancel;dispose=mock.dictationDispose;}}));
vi.mock('../src/codex-prototype/online-image',()=>({checkedImage:mock.checkImage}));
vi.mock('../src/codex-prototype/formula-export-host',async importOriginal=>({...await importOriginal<object>(),runFormulaScript:mock.nativeImage}));
import {activate,deactivate} from '../src/codex-prototype/extension';
const {Session:ModelStateSession}=await vi.importActual<typeof import('../src/codex-prototype/session')>('../src/codex-prototype/session');

class FakeView {
 pageId='';
 visible=true;
 disposed=false;
 private visibility:Array<()=>void>=[];
 private disposals:Array<()=>void>=[];
 private messages:Array<(message:any)=>Promise<void>>=[];
 webview={options:{},html:'',postMessage:vi.fn(async(message:any)=>{if(this.disposed)throw Error('posted to disposed view');return true;}),onDidReceiveMessage:(fn:any)=>{this.messages.push(fn);return{dispose(){}};}};
 onDidChangeVisibility=(fn:()=>void)=>{this.visibility.push(fn);return{dispose(){}};};
 onDidDispose=(fn:()=>void)=>{this.disposals.push(fn);return{dispose(){}};};
 show=vi.fn(()=>this.setVisible(true));
 setVisible(visible:boolean){this.visible=visible;for(const fn of this.visibility)fn();}
 dispose(){this.disposed=true;this.visible=false;for(const fn of this.disposals)fn();}
 async receive(message:any){if(message.type==='ready')this.pageId=message.pageId??randomUUID();for(const fn of this.messages)await fn({pageId:this.pageId,...message});}
 get states(){return this.webview.postMessage.mock.calls.map(([message])=>message).filter(message=>message.type==='state').map(message=>message.state);}
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
let root:string,context:any,data:any,active:FakeSession,rpc:any;
class FakeSession extends EventEmitter {
 readonly modelState:InstanceType<typeof ModelStateSession>;readonly projection;readonly approvals;readonly rpc;
 status='ready';error='';model='synthetic';auth='none';busy=false;sendOutcomeUncertain=false;isConnected=true;toolCheck={verified:true};
 constructor(...args:ConstructorParameters<typeof ModelStateSession>){super();this.rpc=args[0];this.modelState=new ModelStateSession(...args);this.projection=this.modelState.projection;this.approvals=this.modelState.approvals;this.modelState.on('change',()=>this.emit('change'));this.modelState.on('thread-deleted',id=>this.emit('thread-deleted',id));}
 // Use the production read-side contract; keep lifecycle scheduling under this test's control.
 modelView=()=>this.modelState.modelView();
 modeView=()=>this.modelState.modeView();
 get root(){return this.modelState.root;}
 get store(){return this.modelState.store;}
 compactionView=()=>this.modelState.compactionView();
 compact=vi.fn((current:()=>boolean)=>this.modelState.compact(current));
 get userInputs(){return this.modelState.userInputs;}
 get waitingForUserInput(){return this.modelState.waitingForUserInput;}
  get skills(){return this.modelState.skills;}
  refreshSkills=(current:()=>boolean)=>this.modelState.refreshSkills(current);
 preflight=vi.fn(async()=>{await this.modelState.models.refresh();});
 refreshThreads=vi.fn(async()=>{});
 restore=vi.fn(async(threadId:string)=>{data.selected=threadId;this.projection.snapshot({id:threadId,turns:[{id:'turn',status:'completed',itemsView:'full',items:[{type:'agentMessage',id:'answer',text:threadId+' 正文'}],error:null}]} as never);this.emit('change');});
 revertReason=()=> 'fixture does not expose revert';
 forkReason=()=>undefined;
 dispose=vi.fn(async()=>{});
 send=vi.fn(async()=>true);
 get cancellationVersion(){return this.modelState.cancellationVersion;}
 cancel=vi.fn(()=>this.modelState.cancel());
}
beforeEach(()=>{
 vi.clearAllMocks();mock.commands.clear();mock.providers.clear();mock.documentProviders.clear();mock.closeDocuments.clear();
 mock.workspaceRoot='synthetic-owned-workspace';mock.nativeImage.mockResolvedValue('');
 mock.editor=undefined;mock.editorListeners.clear();mock.saveListeners.clear();mock.changeListeners.clear();mock.selectionListeners.clear();mock.diagnosticListeners.clear();mock.diagnostics.mockReturnValue([]);
 mock.windowListeners.clear();mock.windowState.focused=true;mock.information.mockResolvedValue(undefined);mock.warning.mockResolvedValue(undefined);
 mock.dictationEvents=[];mock.dictationProbe.mockResolvedValue({available:true,recognizers:[{id:'zh',culture:'zh-CN',name:'合成语言'}]});mock.dictationCancel.mockResolvedValue(undefined);mock.dictationStart.mockImplementation((_language,callback)=>{mock.dictationEvents.push(callback);});
 vi.stubEnv('CODEX_PROTOTYPE_MODE','online');vi.stubEnv('CODEX_PROTOTYPE_RUN','synthetic-run');
 root=mkdtempSync(join(tmpdir(),'codex-sidebar-unit-'));mkdirSync(join(root,'dist'));
 for(const name of ['extension.js','offline-vendor.js','offline-browser.js','online-display.js'])writeFileSync(join(root,'dist',name),'// synthetic test bundle','utf8');
 const memory=new Map<string,unknown>([['codexPrototype.includeEditorFile.v1',true]]);context={extensionPath:root,subscriptions:[],workspaceState:{get:(key:string,fallback?:unknown)=>memory.has(key)?memory.get(key):fallback,update:async(key:string,value:unknown)=>{memory.set(key,value);}}};
 data={threads:['thread-a','thread-b'],selected:'thread-a',attempts:[]};
 mock.batch.mockReturnValue({store:{read:()=>data,invalidate:()=>[],clearSelection:(id:string)=>{if(data.selected===id)delete data.selected;},path:join(root,'ledger.json'),limit:2,dispatchReason:Store.prototype.dispatchReason},oldUsed:12,baselineSha256:'synthetic',batchId:'synthetic',independentBatch:false});
 rpc=Object.assign(new EventEmitter(),{processId:123,dispose:vi.fn(async()=>{}),request:vi.fn(async(method:string)=>{if(method!=='model/list')throw Error('Unexpected lifecycle model RPC: '+method);return{data:[{id:'synthetic',model:'synthetic',displayName:'Synthetic model',description:'Synthetic catalog for lifecycle contract',isDefault:true,hidden:false,inputModalities:['text'],supportedReasoningEfforts:[{reasoningEffort:'balanced',description:'Synthetic balanced'},{reasoningEffort:'careful',description:'Synthetic careful'}],defaultReasoningEffort:'balanced',serviceTiers:[],defaultServiceTier:null}],nextCursor:null};})});mock.start.mockResolvedValue(rpc);
 mock.makeSession.mockImplementation((...args:ConstructorParameters<typeof ModelStateSession>)=>active=new FakeSession(...args));
 mock.clipboard.mockResolvedValue(undefined);mock.execute.mockImplementation(async(id,...args)=>mock.commands.get(id)?.(...args));
 mock.checkImage.mockImplementation(async(_root,path,id)=>({id,name:path,error:'synthetic missing image'}));
 mock.createPanel.mockImplementation(()=>Object.assign(new FakeView(),{reveal:vi.fn()}));
});
afterEach(async()=>{await deactivate();for(const disposable of context?.subscriptions??[])disposable.dispose();vi.useRealTimers();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
async function resolveView(){const view=new FakeView();await mock.providers.get('codexPrototype.chat').resolveWebviewView(view);return view;}
async function openReady(){await activate(context);await mock.commands.get('codexPrototype.open')!();const view=await resolveView();await view.receive({type:'ready'});expect(mock.start).not.toHaveBeenCalled();await view.receive({type:'restart'});if(view.states.at(-1)?.ready){await view.receive({type:'restore',threadId:'thread-a'});await vi.waitFor(()=>expect(view.states.at(-1)?.threadId).toBe('thread-a'));}return view;}
function ownedDraftWorkspace(){const workspace=join(root,'codex-prototype-local-draft');mkdirSync(workspace);writeFileSync(join(workspace,'.codex-prototype-owned'),'restricted-prototype');mock.workspaceRoot=workspace;return workspace;}

describe('production sidebar host lifecycle (synthetic RPC, real page adapter and stores)',()=>{
 it('preloads daily quota without blocking readiness, shares page reads, polls hidden and clears accounts and disconnect timers',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);mock.workspaceRoot=join(root,'workspace');mkdirSync(mock.workspaceRoot);context.extension={packageJSON:{codexDailyChat:true}};context.storageUri={fsPath:join(root,'state')};
  const original=rpc.request.getMockImplementation(),first=deferred<any>(),replacement=deferred<any>(),quota={rateLimits:{limitId:'codex',primary:{usedPercent:25,windowDurationMins:10080,resetsAt:null},secondary:null}};
  let reads=0;rpc.request.mockImplementation((method:string,params:any)=>{if(method!=='account/rateLimits/read')return original(method,params);reads++;return reads===1?first.promise:reads===3?replacement.promise:Promise.resolve(quota);});
  await activate(context);const view=await resolveView();await view.receive({type:'ready'});await vi.waitFor(()=>expect(view.states.at(-1)?.ready).toBe(true));expect(reads).toBe(1);expect(view.states.at(-1)?.accountLimits?.pending).toBe(true);
  vi.useFakeTimers();const state=view.states.at(-1),manual=view.receive({type:'account-limits-read',id:1,threadId:state.threadId,connectionId:state.connectionId});await vi.advanceTimersByTimeAsync(0);first.resolve(quota);await manual;expect(reads).toBe(1);
  const pushes=()=>view.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='account-limits-state');expect(pushes().at(-1)?.accountLimits.snapshot.buckets[0].primary.usedPercent).toBe(25);
  await view.receive({type:'ready'});expect(reads).toBe(1);expect(view.states.at(-1)?.accountLimits.snapshot).toBeDefined();view.setVisible(false);
  await view.receive({type:'account-limits-read',id:1,threadId:state.threadId,connectionId:state.connectionId});expect(reads).toBe(2);
  await vi.advanceTimersByTimeAsync(60_000);expect(reads).toBe(3);rpc.emit('notification',{method:'account/updated',params:{}});expect(pushes().at(-1)?.accountLimits.snapshot).toBeUndefined();
  replacement.resolve(quota);await vi.advanceTimersByTimeAsync(0);expect(reads).toBe(4);expect(pushes().at(-1)?.accountLimits.snapshot).toBeDefined();
  rpc.emit('disconnect','synthetic disconnect');await vi.advanceTimersByTimeAsync(300_000);expect(reads).toBe(4);expect(active.send).not.toHaveBeenCalled();
 });
 it.each([{persistent:false,rejected:false},{persistent:true,rejected:false},{persistent:false,rejected:true},{persistent:true,rejected:true}])('aborts failed image parts and rechecks sources for at most one queue retry ($persistent / rejected=$rejected)',async({persistent,rejected})=>{
  const view=await openReady();await Promise.all(context.subscriptions.map((v:any)=>v.ready));await new Promise<void>(resolve=>setImmediate(resolve));view.webview.postMessage.mockClear();mock.checkImage.mockClear();mock.checkImage.mockImplementation(async(_root,path,id)=>({id,name:path,src:'data:image/png;base64,'+Buffer.alloc(250000,Number(path.slice(1))).toString('base64')}));
  active.projection.snapshot({id:'thread-a',turns:[{id:'batch',status:'completed',itemsView:'full',items:[{type:'userMessage',id:'image-batch',content:Array.from({length:8},(_,i)=>({type:'localImage',path:'p'+i}))}]}]}as never);
  let refused=false;view.webview.postMessage.mockImplementation(async message=>{if(message.type==='image-state-abort'&&rejected)throw Error('abort queue rejected');if(message.type==='image-state-part'&&message.index===1&&(persistent||!refused)){refused=true;if(rejected)throw Error('part queue rejected');return false;}return true;});active.emit('change');
  await vi.waitFor(()=>expect(view.webview.postMessage.mock.calls.filter(([m])=>m.type==='image-state-abort')).toHaveLength(persistent?2:1));await new Promise(resolve=>setImmediate(resolve));
  const messages=view.webview.postMessage.mock.calls.map(([m])=>m);expect(mock.checkImage).toHaveBeenCalledTimes(16);expect(new Set(messages.filter(m=>m.type==='image-state-part').map(m=>m.sequence)).size).toBe(2);expect(messages.filter(m=>m.type==='state')).toHaveLength(persistent?0:1);expect(active.send).not.toHaveBeenCalled();
 });
 it('aborts a partial old-owner image publication before publishing the newly selected thread',async()=>{
  const view=await openReady();await Promise.all(context.subscriptions.map((v:any)=>v.ready));await new Promise<void>(resolve=>setImmediate(resolve));view.webview.postMessage.mockClear();mock.checkImage.mockImplementation(async(_root,path,id)=>({id,name:path,src:'data:image/png;base64,'+Buffer.alloc(250000,Number(path.slice(1))).toString('base64')}));
  active.projection.snapshot({id:'thread-a',turns:[{id:'batch',status:'completed',itemsView:'full',items:[{type:'userMessage',id:'image-batch',content:Array.from({length:8},(_,i)=>({type:'localImage',path:'p'+i}))}]}]}as never);
  let switched=false;view.webview.postMessage.mockImplementation(async message=>{if(message.type==='image-state-part'&&!switched){switched=true;await view.receive({type:'restore',threadId:'thread-b'});}return true;});active.emit('change');await vi.waitFor(()=>expect(view.states.at(-1)?.threadId).toBe('thread-b'));const messages=view.webview.postMessage.mock.calls.map(([m])=>m);expect(messages.filter(m=>m.type==='image-state-part')).toHaveLength(1);expect(messages.filter(m=>m.type==='image-state-abort')).toHaveLength(1);expect(messages.filter(m=>m.type==='state').every(m=>m.state.threadId==='thread-b')).toBe(true);expect(active.send).not.toHaveBeenCalled();
 });
 it('requires an explicit voice probe and start even for a disconnected local draft and stops only local reply speech first',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);await activate(context);const view=await resolveView();await view.receive({type:'ready'});expect(view.states.at(-1)?.dictationAvailable).toBe(process.platform==='win32');expect(mock.dictationProbe).not.toHaveBeenCalled();expect(mock.dictationStart).not.toHaveBeenCalled();const request={type:'dictation',threadId:'codex-local-draft',connectionId:0};
  await view.receive({...request,id:1,action:'probe'});expect(mock.dictationProbe).toHaveBeenCalledOnce();await view.receive({...request,id:2,action:'start',recognizerId:'zh'});expect(mock.dictationStart).toHaveBeenCalledOnce();expect(mock.speechStop).toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();expect(context.workspaceState.get(DRAFT_KEY,{})).toEqual({});view.setVisible(false);expect(mock.dictationCancel).toHaveBeenCalledOnce();mock.dictationEvents[0]!({phase:'text',sequence:1,text:'hidden late text'});await new Promise(resolve=>setImmediate(resolve));expect(view.webview.postMessage.mock.calls.some(([m])=>m.text==='hidden late text')).toBe(false);
 });
 it('renews voice page leases with one shared engine and rejects old page frames and language authority',async()=>{
  const view=await openReady(),request={type:'dictation',threadId:'thread-a',connectionId:1};await view.receive({...request,id:1,action:'probe'});await view.receive({...request,id:2,action:'start',recognizerId:'zh'});const old=view.pageId,callback=mock.dictationEvents[0]!;await view.receive({type:'ready'});expect(mock.dictationFactory).toHaveBeenCalledOnce();expect(mock.dictationCancel).toHaveBeenCalledOnce();callback({phase:'text',sequence:1,text:'old page'});await view.receive({...request,id:3,pageId:old,action:'probe'});await view.receive({...request,id:1,action:'start',recognizerId:'zh'});expect(mock.dictationStart).toHaveBeenCalledOnce();expect(mock.dictationProbe).toHaveBeenCalledOnce();await view.receive({...request,id:2,action:'probe'});await view.receive({...request,id:3,action:'start',recognizerId:'zh'});expect(mock.dictationStart).toHaveBeenCalledTimes(2);expect(mock.dictationDispose).not.toHaveBeenCalled();await view.receive({...request,type:'stop'});expect(mock.dictationCancel).toHaveBeenCalledTimes(1);await deactivate();expect(mock.dictationDispose).toHaveBeenCalledOnce();expect(active.send).not.toHaveBeenCalled();
 });
 it('revokes a voice capture immediately on thread change even while an image projection is pending',async()=>{
  const view=await openReady(),request={type:'dictation',threadId:'thread-a',connectionId:1};await view.receive({...request,id:1,action:'probe'});await view.receive({...request,id:2,action:'start',recognizerId:'zh'});const gate=deferred<any>();active.projection.snapshot({id:'thread-a',turns:[{id:'old',status:'completed',itemsView:'full',items:[{type:'userMessage',id:'image',content:[{type:'localImage',path:'old.png'}]}]}]}as never);mock.checkImage.mockReturnValueOnce(gate.promise);active.emit('change');await vi.waitFor(()=>expect(mock.checkImage).toHaveBeenCalled());await view.receive({type:'restore',threadId:'thread-b'});expect(mock.dictationCancel).toHaveBeenCalledOnce();mock.dictationEvents[0]!({phase:'text',sequence:1,text:'must not cross'});gate.resolve({id:'old',name:'old.png',error:'synthetic'});await vi.waitFor(()=>expect(view.states.at(-1)?.threadId).toBe('thread-b'));expect(view.webview.postMessage.mock.calls.some(([m])=>m.text==='must not cross')).toBe(false);expect(active.send).not.toHaveBeenCalled();
 });
 it('reads service metadata through the real page bridge and drops duplicate IDs old connections and retired page results',async()=>{
  const view=await openReady(),original=rpc.request.getMockImplementation(),reads:any[]=[],gate=deferred<void>();let hold=false;
  rpc.request.mockImplementation(async(method:string,params:any)=>{if(method==='model/list')return original(method,params);reads.push({method,params});if(method==='config/read'){if(hold)await gate.promise;return{config:{features:{apps:false},apps:{_default:{enabled:false}},mcp_servers:Object.fromEntries(DISABLED_MCP.map(name=>[name,{enabled:false}])),plugins:Object.fromEntries(DISABLED_PLUGINS.map(name=>[name,{enabled:false}]))}};}if(method==='mcpServerStatus/list')return{data:DISABLED_MCP.map(name=>({name,runtimeStatus:'disabled',authStatus:'unknown',tools:{},resources:[],resourceTemplates:[],toolsError:null})),nextCursor:null};if(method==='app/installed')return{apps:[]};throw Error('No other service metadata method expected');});
  const request={type:'service-status-read',id:1,threadId:'thread-a',connectionId:1};expect(view.states.at(-1)?.serviceStatusAvailable).toBe(true);await view.receive(request);const replies=()=>view.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='service-status-result');expect(replies().at(-1)).toMatchObject({ok:true,pageId:view.pageId,value:{isolated:true,mcpComplete:true,apps:[]}});expect(reads.map(v=>v.method)).toEqual(['config/read','mcpServerStatus/list','app/installed']);expect(reads[0].params).toEqual({cwd:active.root,includeLayers:false});
  await view.receive(request);await view.receive({...request,id:2,connectionId:99});expect(reads).toHaveLength(3);hold=true;const pending=view.receive({...request,id:3});await vi.waitFor(()=>expect(reads).toHaveLength(4));const old=view.pageId;await view.receive({type:'ready'});gate.resolve();await pending;expect(replies().some(m=>m.id===3)).toBe(false);await view.receive({...request,pageId:old,id:4});expect(reads).toHaveLength(4);expect(active.send).not.toHaveBeenCalled();
 });
 it('routes explicit compaction through the production page bridge once and rejects stale IDs connections and page leases',async()=>{
  const view=await openReady(),calls=rpc.request.mock.calls.length;active.compact.mockResolvedValue(undefined);expect(view.states.at(-1)?.compaction).toMatchObject({active:false});
  const request={type:'compact',id:1,threadId:'thread-a',connectionId:1};await view.receive(request);expect(active.compact).toHaveBeenCalledOnce();expect(view.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='compact-result')).toMatchObject([{ok:true,id:1,pageId:view.pageId}]);
  await view.receive(request);await view.receive({...request,id:2,connectionId:99});expect(active.compact).toHaveBeenCalledOnce();const old=view.pageId;await view.receive({type:'ready'});await view.receive({...request,id:3,pageId:old});expect(active.compact).toHaveBeenCalledOnce();
  const gate=deferred<void>();active.compact.mockImplementationOnce(async current=>{expect(current()).toBe(true);await gate.promise;expect(current()).toBe(false);});const pending=view.receive(request);await vi.waitFor(()=>expect(active.compact).toHaveBeenCalledTimes(2));const pendingPage=view.pageId;await view.receive({type:'ready'});gate.resolve();await pending;
  expect(view.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='compact-result'&&m.pageId===pendingPage)).toEqual([]);expect(rpc.request).toHaveBeenCalledTimes(calls);expect(active.send).not.toHaveBeenCalled();
 });
 it('publishes live plan/diff metadata and opens exact native slices without new backend/model or filesystem actions',async()=>{
  const view=await openReady(),patch='--- a/a.ts\n+++ b/a.ts\n@@ -90 +90 @@\n-old\n+new\n';active.projection.apply({method:'turn/plan/updated',params:{threadId:'thread-a',turnId:'turn',explanation:'public steps',plan:[{step:'one',status:'completed'},{step:'two',status:'inProgress'}]}});active.projection.apply({method:'turn/diff/updated',params:{threadId:'thread-a',turnId:'turn',diff:patch}});active.emit('change');await vi.waitFor(()=>expect(view.states.at(-1)?.turnProgress?.diff?.characters).toBe(patch.length));const state=view.states.at(-1);expect(state.turnProgress.plan.steps[1].status).toBe('inProgress');expect(JSON.stringify(state.turnProgress)).not.toContain('-old');const rpcCalls=rpc.request.mock.calls.length;mock.execute.mockClear();
  await view.receive({type:'turn-diff-open',id:1,threadId:'thread-a',connectionId:1,turnId:'turn',revision:state.turnProgress.diff.revision,mode:'hunk',index:0});expect(mock.execute).toHaveBeenCalledOnce();const [command,before,after,title]=mock.execute.mock.calls[0]!;expect(command).toBe('vscode.diff');expect(title).toContain('公开补丁片段 −90,1 +90,1');const provider=mock.documentProviders.get('codex-public-diff');expect(provider.provideTextDocumentContent(before)).toBe('old\n');expect(provider.provideTextDocumentContent(after)).toBe('new\n');expect(view.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'turn-diff-result',ok:true,id:1,pageId:view.pageId});expect(rpc.request).toHaveBeenCalledTimes(rpcCalls);expect(active.send).not.toHaveBeenCalled();expect(mock.nativeImage).not.toHaveBeenCalled();
  const old=view.pageId;await view.receive({type:'ready'});await view.receive({type:'turn-diff-open',id:2,pageId:old,threadId:'thread-a',connectionId:1,turnId:'turn',revision:state.turnProgress.diff.revision,mode:'raw'});expect(mock.execute).toHaveBeenCalledOnce();for(const disposable of context.subscriptions)disposable.dispose();expect(mock.documentProviders.size+mock.closeDocuments.size).toBe(0);
 });
 it('captures only an explicit unsaved selection for the disconnected draft and rejects a previous page lease',async()=>{
  const workspace=ownedDraftWorkspace(),path=join(workspace,'capture.ts'),content='PRIVATE_PREFIX\nchosen\nPRIVATE_SUFFIX';writeFileSync(path,content);await context.workspaceState.update('codexPrototype.includeEditorFile.v1',false);
  const getText=vi.fn((r:any)=>{expect(r).toMatchObject({start:{line:1,character:0},end:{line:1,character:6}});return 'chosen';}),document={uri:{scheme:'file',fsPath:path},version:2,isDirty:true,lineCount:3,lineAt:(line:number)=>({text:content.split('\n')[line]}),offsetAt:(p:any)=>content.split('\n').slice(0,p.line).reduce((n,s)=>n+s.length+1,0)+p.character,getText};mock.editor={document,selection:{start:{line:1,character:0},end:{line:1,character:6}}};
  await activate(context);const view=await resolveView();await view.receive({type:'ready'});let s=view.states.at(-1);expect(s.editorCapture.source).toMatchObject({path:'capture.ts',dirty:true,selectionCharacters:6});expect(getText).not.toHaveBeenCalled();
  await view.receive({type:'editor-capture',id:1,threadId:s.threadId,connectionId:0,mode:'selection',sourceKey:s.editorCapture.source.key});const result=view.webview.postMessage.mock.calls.map(([m])=>m).find(m=>m.type==='editor-capture-result');expect(result).toMatchObject({ok:true,pageId:view.pageId});expect(result.text).toContain('\nchosen\n');expect(result.text).not.toContain('PRIVATE_PREFIX');expect(getText).toHaveBeenCalledOnce();expect(context.workspaceState.get(DRAFT_KEY,{})).toEqual({});
  const old=view.pageId;await view.receive({type:'ready'});s=view.states.at(-1);await view.receive({type:'editor-capture',id:2,pageId:old,threadId:s.threadId,connectionId:0,mode:'selection',sourceKey:s.editorCapture.source.key});expect(getText).toHaveBeenCalledOnce();expect(mock.start).not.toHaveBeenCalled();expect(mock.makeSession).not.toHaveBeenCalled();
 });
 it('publishes selection and same-count diagnostic changes without reading source text or adding listeners on ready',async()=>{
  const workspace=ownedDraftWorkspace(),path=join(workspace,'diagnostic.ts');writeFileSync(path,'abc');await context.workspaceState.update('codexPrototype.includeEditorFile.v1',false);const getText=vi.fn(()=>{throw Error('metadata cannot read source');}),document={uri:{scheme:'file',fsPath:path},version:1,isDirty:false,lineCount:1,lineAt:()=>({text:'abc'}),offsetAt:(p:any)=>p.character,getText};mock.editor={document,selection:{start:{line:0,character:0},end:{line:0,character:3}}};mock.diagnostics.mockReturnValue([{range:{start:{line:0,character:0},end:{line:0,character:1}},message:'first',severity:0}]);
  await activate(context);const view=await resolveView();await view.receive({type:'ready'});const first=view.states.at(-1).editorCapture.source.key;mock.diagnostics.mockReturnValue([{range:{start:{line:0,character:0},end:{line:0,character:1}},message:'second',severity:0}]);for(const listener of mock.diagnosticListeners)listener({uris:[document.uri]});const diagnostic=view.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='editor-capture-view').at(-1);expect(diagnostic.editorCapture.source.key).not.toBe(first);expect(diagnostic.editorCapture.source.diagnosticCount).toBe(1);
  mock.editor.selection={start:{line:0,character:1},end:{line:0,character:2}};for(const listener of mock.selectionListeners)listener({textEditor:mock.editor});const selection=view.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='editor-capture-view').at(-1);expect(selection.editorCapture.source.selectionCharacters).toBe(1);expect(selection.editorCapture.source.key).not.toBe(diagnostic.editorCapture.source.key);await view.receive({type:'ready'});expect(mock.selectionListeners.size).toBe(1);expect(mock.diagnosticListeners.size).toBe(1);expect(getText).not.toHaveBeenCalled();for(const disposable of context.subscriptions)disposable.dispose();expect(mock.selectionListeners.size+mock.diagnosticListeners.size).toBe(0);expect(mock.start).not.toHaveBeenCalled();
 });
 it('broadcasts confirmed settings only to the other live sidebar/offline documents and disposes panel observers',async()=>{const disposals:ReturnType<typeof vi.fn>[]=[],original=DisplaySettingsStore.prototype.onDidChange,observe=vi.spyOn(DisplaySettingsStore.prototype,'onDidChange').mockImplementation(function(listener){const subscription=original.call(this,listener),dispose=vi.fn(()=>subscription.dispose());disposals.push(dispose);return{dispose};});try{const view=await openReady();await mock.commands.get('codexPrototype.openOffline')!();const preview=mock.createPanel.mock.results.at(-1)!.value as FakeView;await preview.receive({type:'ready'});await mock.commands.get('codexPrototype.openOfflineExperience')!();const interactive=mock.createPanel.mock.results.at(-1)!.value as FakeView;await interactive.receive({type:'ready'});expect(disposals).toHaveLength(3);const changes=(target:FakeView)=>target.webview.postMessage.mock.calls.map(([message])=>message).filter(message=>message.type==='settings-changed');await view.receive({type:'settings-save',id:1,key:'copy.mathButtons',value:false});expect(changes(view)).toEqual([]);expect(changes(preview)).toEqual([{type:'settings-changed',pageId:preview.pageId}]);expect(changes(interactive)).toEqual([{type:'settings-changed',pageId:interactive.pageId}]);await interactive.receive({type:'settings-save',id:1,key:'copy.blockButtons',value:false});expect(changes(view)).toEqual([{type:'settings-changed',pageId:view.pageId}]);expect(changes(interactive)).toHaveLength(1);expect(changes(preview)).toHaveLength(2);preview.dispose();expect(disposals[1]).toHaveBeenCalledOnce();const before=preview.webview.postMessage.mock.calls.length;await mock.commands.get('codexPrototype.displaySettings')!('copy.feedbackSeconds',.7);expect(preview.webview.postMessage.mock.calls).toHaveLength(before);interactive.dispose();expect(disposals[2]).toHaveBeenCalledOnce();expect(mock.start).toHaveBeenCalledOnce();expect(active.send).not.toHaveBeenCalled();}finally{observe.mockRestore();}});
 it('a write already in storage can notify a replacement document without returning its old settings receipt',async()=>{await openReady();await mock.commands.get('codexPrototype.openOffline')!();const preview=mock.createPanel.mock.results.at(-1)!.value as FakeView;await preview.receive({type:'ready'});const old=preview.pageId,hold=deferred<void>(),update=context.workspaceState.update;let waiting=false;context.workspaceState.update=async(key:string,value:unknown)=>{if(key===DISPLAY_SETTINGS_KEY){waiting=true;await hold.promise;}return update(key,value);};const saving=preview.receive({type:'settings-save',id:1,key:'copy.mathButtons',value:false});await vi.waitFor(()=>expect(waiting).toBe(true));await preview.receive({type:'ready'});expect(preview.pageId).not.toBe(old);hold.resolve();await saving;expect(preview.webview.postMessage.mock.calls.map(([message])=>message).filter(message=>message.type==='settings-changed')).toEqual([{type:'settings-changed',pageId:preview.pageId}]);expect(preview.webview.postMessage.mock.calls.map(([message])=>message).filter(message=>message.type==='display-settings'&&message.id===1)).toEqual([]);expect(await mock.commands.get('codexPrototype.displaySettings')!()).toMatchObject({mathButtons:false});});
 it('publishes image deltas only after the current page ACK while rechecking a shared source once per publication',async()=>{
  const view=await openReady();await new Promise<void>(resolve=>setImmediate(resolve));
  const src=Object.values(IMAGE_ASSETS).find(image=>image.src.startsWith('data:image/png;'))!.src;
  active.projection.snapshot({id:'thread-a',turns:[{id:'image-turn',status:'completed',itemsView:'full',items:[{type:'userMessage',id:'image-row',content:[{type:'localImage',path:'same.png'},{type:'localImage',path:'same.png'}]}]}]}as never);
  mock.checkImage.mockResolvedValue({id:'image',name:'same.png',src});mock.checkImage.mockClear();active.emit('change');
  const packets=()=>view.webview.postMessage.mock.calls.filter(([message])=>message.type==='state'&&message.state.items.some((row:any)=>row.item.id==='image-row')).map(([message])=>message);
  await vi.waitFor(()=>expect(packets().at(-1)?.imageResources.resources).toHaveLength(1));
  const first=packets().at(-1)!,before=packets().length;
  expect(first.state.items[0].item.content.every((input:any)=>!input.displayImage.src&&input.displayImage.resourceKey)).toBe(true);
  expect(new Set(packets().map(packet=>packet.imageResources.sequence)).size).toBe(before);
  expect(mock.checkImage).toHaveBeenCalledTimes(before); // Count each actual publication, including independent host events.
  await view.receive({type:'image-state-ack',connectionId:1,sequence:first.imageResources.sequence,ok:true});active.emit('change');
  await vi.waitFor(()=>expect(packets()).toHaveLength(before+1));
  expect(packets().at(-1)!.imageResources.resources).toEqual([]);expect(mock.checkImage).toHaveBeenCalledTimes(before+1);expect(active.send).not.toHaveBeenCalled();
 });
 it('a missing image resource requests one full repair without a backend or resend loop',async()=>{const view=await openReady();await new Promise<void>(resolve=>setImmediate(resolve));const src=Object.values(IMAGE_ASSETS).find(image=>image.src.startsWith('data:image/png;'))!.src;active.projection.snapshot({id:'thread-a',turns:[{id:'t',status:'completed',itemsView:'full',items:[{type:'userMessage',id:'i',content:[{type:'localImage',path:'one.png'}]}]}]}as never);mock.checkImage.mockResolvedValue({id:'image',name:'one.png',src});active.emit('change');const latest=()=>view.webview.postMessage.mock.calls.filter(([message])=>message.type==='state').at(-1)![0];await vi.waitFor(()=>expect(latest().imageResources.resources).toHaveLength(1));const first=latest();await view.receive({type:'image-state-ack',connectionId:1,sequence:first.imageResources.sequence,ok:true});active.emit('change');await vi.waitFor(()=>expect(latest().imageResources.resources).toEqual([]));const delta=latest(),rpcCalls=rpc.request.mock.calls.length;await view.receive({type:'image-state-ack',connectionId:1,sequence:delta.imageResources.sequence,ok:false});expect(latest().imageResources.resources).toHaveLength(1);const repaired=latest(),count=view.states.length;await view.receive({type:'image-state-ack',connectionId:1,sequence:delta.imageResources.sequence,ok:false});await view.receive({type:'image-state-ack',connectionId:1,sequence:repaired.imageResources.sequence,ok:false});expect(view.states).toHaveLength(count);expect(rpc.request).toHaveBeenCalledTimes(rpcCalls);expect(active.send).not.toHaveBeenCalled();});
 it('new page handshakes invalidate old image ACKs and resend the complete current resources',async()=>{const view=await openReady();await new Promise<void>(resolve=>setImmediate(resolve));const src=Object.values(IMAGE_ASSETS).find(image=>image.src.startsWith('data:image/png;'))!.src;active.projection.snapshot({id:'thread-a',turns:[{id:'t',status:'completed',itemsView:'full',items:[{type:'userMessage',id:'i',content:[{type:'localImage',path:'one.png'}]}]}]}as never);mock.checkImage.mockResolvedValue({id:'image',name:'one.png',src});active.emit('change');const latest=()=>view.webview.postMessage.mock.calls.filter(([message])=>message.type==='state').at(-1)![0];await vi.waitFor(()=>expect(latest().imageResources.resources).toHaveLength(1));const first=latest();await view.receive({type:'image-state-ack',connectionId:1,sequence:first.imageResources.sequence,ok:true});await view.receive({type:'ready'});expect(latest().pageId).not.toBe(first.pageId);expect(latest().imageResources.resources).toHaveLength(1);await view.receive({type:'image-state-ack',pageId:first.pageId,connectionId:1,sequence:latest().imageResources.sequence,ok:true});active.emit('change');await vi.waitFor(()=>expect(latest().imageResources.sequence).toBeGreaterThan(1));expect(latest().imageResources.resources).toHaveLength(1);expect(active.send).not.toHaveBeenCalled();});
 it('notifies a background owned result once and routes its click to that thread under the original connection',async()=>{const catalog=new ThreadCatalog(context.workspaceState);for(const id of data.threads)await catalog.observe({id,name:id,preview:'',updatedAt:1,cwd:mock.workspaceRoot,turns:[]}as any);const view=await openReady();Object.assign(active.toolCheck,{threadId:'thread-a'});view.setVisible(false);const choice=deferred<string|undefined>();mock.information.mockReturnValueOnce(choice.promise);active.emit('queue-terminal',{threadId:'thread-b',turnId:'finished',status:'completed',canceled:false});active.emit('queue-terminal',{threadId:'thread-b',turnId:'finished',status:'completed',canceled:false});await vi.waitFor(()=>expect(mock.information).toHaveBeenCalledExactlyOnceWith('Codex · thread-b：已完成','打开会话'));expect(new ThreadCatalog(context.workspaceState).get('thread-b')).toMatchObject({unread:true,unreadSource:'task'});choice.resolve('打开会话');await vi.waitFor(()=>expect(active.projection.threadId).toBe('thread-b'));expect(view.visible).toBe(true);expect(mock.execute).toHaveBeenCalledWith('codexPrototype.chat.focus');expect(active.send).not.toHaveBeenCalled();});
 it('publishes native focus visibility and suppresses foreground task notices',async()=>{const catalog=new ThreadCatalog(context.workspaceState);await catalog.observe({id:'thread-a',name:'current',preview:'',updatedAt:1,cwd:mock.workspaceRoot,turns:[]}as any);const view=await openReady();Object.assign(active.toolCheck,{threadId:'thread-a'});active.emit('queue-terminal',{threadId:'thread-a',turnId:'visible-result',status:'completed',canceled:false});await new Promise<void>(resolve=>setImmediate(resolve));expect(mock.information).not.toHaveBeenCalled();mock.windowState.focused=false;for(const callback of mock.windowListeners)callback();expect(view.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'session-visibility',pageId:view.pageId,connectionId:1,visible:false});active.emit('queue-terminal',{threadId:'thread-a',turnId:'background-failure',status:'failed',canceled:false});await vi.waitFor(()=>expect(mock.warning).toHaveBeenCalledExactlyOnceWith('Codex · current：执行失败','打开会话'));expect(active.send).not.toHaveBeenCalled();});
 it('shares one metadata cleanup when public notification and a second acknowledgement identify the same deletion',async()=>{
  await openReady();const update=vi.spyOn(context.workspaceState,'update');
  rpc.emit('notification',{method:'thread/deleted',params:{threadId:'thread-b'}});
  await vi.waitFor(()=>expect(update.mock.calls.some(([key])=>key==='codexPrototype.turnMetrics.v1')).toBe(true));
  active.emit('thread-deleted','thread-b');await new Promise<void>(resolve=>setImmediate(resolve));
  expect(update.mock.calls.filter(([key])=>key===DRAFT_KEY)).toHaveLength(1);expect(update.mock.calls.filter(([key])=>key==='codexPrototype.turnMetrics.v1')).toHaveLength(1);expect(active.error).toBe('');update.mockRestore();
 });
 it.each(['accepted','failed'] as const)('a late %s send outcome cannot finish or revive a publicly deleted draft',async outcome=>{
  const view=await openReady(),hold=deferred<boolean>(),viewId=randomUUID(),value={...emptyDraft(),text:'deleted in flight',draftEditId:randomUUID()};
  await view.receive({type:'draft-read',id:1,viewId,threadId:'thread-a',connectionId:1});await view.receive({type:'draft-save',id:2,viewId,threadId:'thread-a',connectionId:1,value});
  active.send.mockImplementationOnce(async()=>{const result=await hold.promise;if(outcome==='failed')throw Error('late unknown outcome');return result;});const sending=view.receive({type:'send',viewId,requestId:9,threadId:'thread-a',connectionId:1,...value});
  await vi.waitFor(()=>expect(active.send).toHaveBeenCalled());rpc.emit('notification',{method:'thread/deleted',params:{threadId:'thread-a'}});
  await vi.waitFor(()=>expect(new DraftStore(context.workspaceState).read('thread-a').text).toBe(''));
  if(outcome==='failed')active.sendOutcomeUncertain=true;hold.resolve(outcome==='accepted');await sending;
  expect(view.webview.postMessage.mock.calls.filter(([m])=>m.type==='sent'&&m.requestId===9)).toEqual([]);expect(active.error).toBe('');expect(new DraftStore(context.workspaceState).read('thread-a').text).toBe('');
 });
 it('reports deletion cleanup failure on the current connection after a reconnect',async()=>{
  const view=await openReady(),old=active,hold=deferred<void>(),write=context.workspaceState.update;let waiting=false;
  context.workspaceState.update=async(k:string,v:unknown)=>{if(k===SCROLL_VIEW_KEY&&!waiting){waiting=true;await hold.promise;throw Error('cleanup write failed');}return write(k,v);};
  rpc.emit('notification',{method:'thread/deleted',params:{threadId:'thread-b'}});
  await vi.waitFor(()=>expect(waiting).toBe(true));await view.receive({type:'restart'});expect(active).not.toBe(old);
  hold.resolve();await vi.waitFor(()=>expect(view.states.at(-1)?.error).toContain('本地视图记录清理失败'));
 });
 it.each(['draft','scroll'] as const)('public deletion purges an in-flight %s write and rejects later messages while preserving the other thread',async kind=>{
  const seedDrafts=new DraftStore(context.workspaceState),seedScroll=new ScrollViewStore(context.workspaceState);
  for(const id of ['thread-a','thread-b']){await seedDrafts.save(id,{...emptyDraft(),text:id});await seedScroll.save(id,{atBottom:false,scrollTop:42});}
  const view=await openReady(),viewId=randomUUID(),write=context.workspaceState.update,hold=deferred<void>();let waiting=false;
  await view.receive({type:'draft-read',id:1,viewId,threadId:'thread-a',connectionId:1});
  await view.receive({type:'scroll-view-read',id:2,viewId,threadId:'thread-a',connectionId:1});
  const type=kind==='draft'?'draft-save':'scroll-view-save',key=kind==='draft'?DRAFT_KEY:SCROLL_VIEW_KEY,value=kind==='draft'?{...emptyDraft(),text:'late old thread'}:{atBottom:false,scrollTop:99};
  context.workspaceState.update=async(k:string,v:unknown)=>{if(k===key&&!waiting){waiting=true;await hold.promise;}return write(k,v);};
  const saving=view.receive({type,id:3,viewId,threadId:'thread-b',connectionId:1,value});await vi.waitFor(()=>expect(waiting).toBe(true));
  rpc.emit('notification',{method:'thread/deleted',params:{threadId:'thread-b'}});
  await view.receive({type,id:4,viewId,threadId:'thread-b',connectionId:1,value});
  expect(view.webview.postMessage.mock.calls.some(([m])=>m.id===4&&m.ok===false)).toBe(true);
  hold.resolve();await saving;
  await vi.waitFor(()=>{expect(new DraftStore(context.workspaceState).read('thread-b').text).toBe('');expect(new ScrollViewStore(context.workspaceState).read('thread-b')).toBeUndefined();});
  expect(new DraftStore(context.workspaceState).read('thread-a').text).toBe('thread-a');expect(new ScrollViewStore(context.workspaceState).read('thread-a')?.scrollTop).toBe(42);
  expect(active.projection.threadId).toBe('thread-a');expect(active.send).not.toHaveBeenCalled();
 });
 it('serializes rapid selections through the full host without losing the second intent',async()=>{
  const view=await openReady(),gate=deferred<void>(),restore=active.restore.getMockImplementation()!;let operating=false;active.restore.mockClear();active.restore.mockImplementation(async id=>{if(operating)throw Error('先停止当前轮次');operating=true;try{if(id==='thread-b')await gate.promise;await restore(id);}finally{operating=false;}});
  const first=view.receive({type:'restore',threadId:'thread-b'});await vi.waitFor(()=>expect(active.restore).toHaveBeenCalledTimes(1));const second=view.receive({type:'restore',threadId:'thread-a'});await Promise.resolve();expect(active.restore).toHaveBeenCalledTimes(1);gate.resolve();await Promise.all([first,second]);expect(active.restore.mock.calls.map(([id])=>id)).toEqual(['thread-b','thread-a']);expect(view.states.at(-1)?.threadId).toBe('thread-a');expect(active.error).toBe('');
 });
 it('acknowledges a search restore only after its own operation completes',async()=>{
  const view=await openReady(),gate=deferred<void>(),restore=active.restore.getMockImplementation()!;active.restore.mockImplementationOnce(async id=>{await gate.promise;await restore(id);});const pending=view.receive({type:'restore',threadId:'thread-b',connectionId:1,selectionId:31});await vi.waitFor(()=>expect(active.restore).toHaveBeenCalledWith('thread-b'));expect(view.webview.postMessage.mock.calls.some(([m])=>m.type==='session-selected')).toBe(false);gate.resolve();await pending;expect(view.states.at(-1)?.threadId).toBe('thread-b');expect(view.webview.postMessage).toHaveBeenCalledWith({type:'session-selected',id:31,threadId:'thread-b',connectionId:1,ok:true,pageId:view.pageId});
 });
 it.each(['restart','ready'])('a started search restore cannot report its late failure into the replacement %s owner',async action=>{
  const view=await openReady(),old=active,gate=deferred<void>();old.restore.mockImplementationOnce(async()=>{await gate.promise;throw Error('obsolete restore failure');});const pending=view.receive({type:'restore',threadId:'thread-b',connectionId:1,selectionId:41});await vi.waitFor(()=>expect(old.restore).toHaveBeenCalledWith('thread-b'));await view.receive({type:action});const pageId=view.pageId;gate.resolve();await pending;expect(active.error).not.toContain('obsolete');expect(view.webview.postMessage.mock.calls.filter(([m])=>m.type==='session-selected'&&m.id===41)).toEqual([]);expect(view.states.at(-1)?.error??'').not.toContain('obsolete');expect(view.pageId).toBe(pageId);
 });
 it('forwards workbench undo and redo only to the visible ready document under its current page lease',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);await activate(context);
  await mock.commands.get('codexPrototype.undoInView')!();const view=await resolveView();await mock.commands.get('codexPrototype.redoInView')!();expect(view.webview.postMessage).not.toHaveBeenCalled();
  await view.receive({type:'ready'});await mock.commands.get('codexPrototype.undoInView')!();expect(view.webview.postMessage.mock.calls.at(-1)![0]).toEqual({type:'exec-edit',command:'undo',pageId:view.pageId});
  const old=view.pageId;await view.receive({type:'ready'});await mock.commands.get('codexPrototype.redoInView')!();expect(view.pageId).not.toBe(old);expect(view.webview.postMessage.mock.calls.at(-1)![0]).toEqual({type:'exec-edit',command:'redo',pageId:view.pageId});
  view.setVisible(false);expect(view.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'session-visibility',pageId:view.pageId,visible:false});const count=view.webview.postMessage.mock.calls.length;await mock.commands.get('codexPrototype.undoInView')!();view.dispose();await mock.commands.get('codexPrototype.redoInView')!();expect(view.webview.postMessage.mock.calls).toHaveLength(count);expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();
 });
 it('keeps an ordinary window inactive until opened and does not inspect the editor, connect or access the online ledger',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);
  mock.editor={get document(){throw Error('ordinary window must not inspect the current document');}};
  await activate(context);
  expect(mock.commands.has('codexPrototype.open')).toBe(true);
  expect(mock.register).toHaveBeenCalledExactlyOnceWith('codexPrototype.chat',{webviewOptions:{retainContextWhenHidden:true}});
  expect(mock.execute).not.toHaveBeenCalled();expect(mock.editorReads).not.toHaveBeenCalled();
  expect(mock.editorListeners.size+mock.saveListeners.size+mock.changeListeners.size).toBe(0);
  expect(await mock.commands.get('codexPrototype.inspect')!()).toMatchObject({offline:true,serverProcessId:null,ledgerAccess:false});
  expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();expect(mock.makeSession).not.toHaveBeenCalled();expect(mock.createPanel).not.toHaveBeenCalled();
 });
 it('repeated ordinary opens only focus the same retained sidebar and cannot import editor content or dispatch',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);
  await activate(context);const view=await resolveView();
  for(let i=0;i<6;i++)await mock.commands.get('codexPrototype.open')!();
  view.setVisible(false);await mock.commands.get('codexPrototype.open')!();view.setVisible(true);
  expect(mock.execute.mock.calls).toEqual(Array.from({length:7},()=>['codexPrototype.chat.focus']));
  expect(mock.register).toHaveBeenCalledOnce();expect(mock.createPanel).not.toHaveBeenCalled();expect(mock.editorReads).not.toHaveBeenCalled();
  expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();expect(mock.makeSession).not.toHaveBeenCalled();
 });
 it('mounts the full disconnected composer, saves its local draft across page and extension rebuilds, and never manufactures a thread or budget',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);
  await activate(context);let view=await resolveView();await view.receive({type:'ready'});
  expect(view.webview.html).toContain('id="prompt"');expect(view.webview.html).not.toContain('Codex 离线显示演示');
  expect(view.states.at(-1)).toMatchObject({status:'未连接',ready:false,threadId:'codex-local-draft',threads:[],items:[],used:null,limit:null,ledgerAccess:false,serverProcessId:null});
  const viewId=randomUUID();await view.receive({type:'draft-read',id:1,viewId,threadId:'codex-local-draft',connectionId:0});
  await view.receive({type:'draft-save',id:2,viewId,threadId:'codex-local-draft',connectionId:0,value:{text:'日常本地草稿',image:'',pathInput:'',imageToken:''}});
  view.dispose();view=await resolveView();await view.receive({type:'ready'});
  await view.receive({type:'draft-read',id:1,viewId:randomUUID(),threadId:'codex-local-draft',connectionId:0});
  expect(view.webview.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({type:'draft-result',ok:true,value:{text:'日常本地草稿'}});
  await deactivate();await activate(context);view=await resolveView();await view.receive({type:'ready'});
  await view.receive({type:'draft-read',id:1,viewId:randomUUID(),threadId:'codex-local-draft',connectionId:0});
  expect(view.webview.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({type:'draft-result',ok:true,value:{text:'日常本地草稿'}});
  await view.receive({type:'restart'});expect(mock.start).toHaveBeenCalledExactlyOnceWith('synthetic-owned-workspace',false,false,undefined);
  expect(view.states.at(-1)).toMatchObject({ready:true,threadId:'codex-local-draft',threads:[],items:[],used:null,limit:null,ledgerAccess:false,threadManagementAvailable:false});
  expect(mock.batch).not.toHaveBeenCalled();expect(mock.makeSession).toHaveBeenCalledOnce();expect(mock.editorReads).not.toHaveBeenCalled();expect(active.restore).not.toHaveBeenCalled();expect(active.send).not.toHaveBeenCalled();
  expect(active.refreshThreads).not.toHaveBeenCalled();expect(active.modelState.store.dispatchReason()).toContain('发送禁用');
  expect(active.modelView()?.observed).toBeUndefined();
  await view.receive({type:'new'});expect(view.states.at(-1).error).toContain('不创建聊天线程');
  await view.receive({type:'send',threadId:'codex-local-draft',connectionId:1,viewId:randomUUID(),requestId:1,text:'never sent',image:'',imageToken:''});expect(active.send).not.toHaveBeenCalled();
  expect(view.states.at(-1).error).toContain('发送禁用');
 });
 it('requires explicit connection and a separate explicit restore even with a selected controlled thread',async()=>{
  await activate(context);const view=await resolveView();await view.receive({type:'ready'});
  expect(mock.start).not.toHaveBeenCalled();expect(view.states.at(-1)).toMatchObject({ready:false,threadId:'codex-local-draft'});
  await view.receive({type:'restart'});expect(mock.start).toHaveBeenCalledOnce();expect(active.restore).not.toHaveBeenCalled();expect(view.states.at(-1)).toMatchObject({ready:true,threadId:'codex-local-draft'});
  await view.receive({type:'restore',threadId:'thread-a'});expect(active.restore).toHaveBeenCalledExactlyOnceWith('thread-a');expect(active.send).not.toHaveBeenCalled();
 });
 it('imports and persists an actual file into the enabled disconnected local draft without connecting or using the execution ledger',async()=>{
  const workspace=ownedDraftWorkspace();await activate(context);let view=await resolveView();await view.receive({type:'ready'});let s=view.states.at(-1);expect(s).toMatchObject({threadId:'codex-local-draft',connectionId:0,ready:false,attachmentImportAvailable:true});
  const viewId=randomUUID();await view.receive({type:'draft-read',id:1,viewId,threadId:s.threadId,connectionId:0});
  await view.receive({type:'attachment-import',id:1,threadId:s.threadId,connectionId:0,name:'offline.md',base64:Buffer.from('离线实际文件').toString('base64')});
  const imported=view.webview.postMessage.mock.calls.map(([m])=>m).find(m=>m.type==='attachment-imported'&&m.id===1);expect(imported).toMatchObject({ok:true,kind:'file'});expect(readFileSync(imported.file.path,'utf8')).toBe('离线实际文件');expect(imported.file.path.startsWith(join(workspace,'.codex-attachments'))).toBe(true);
  await view.receive({type:'draft-save',id:2,viewId,threadId:s.threadId,connectionId:0,value:{text:'文字与文件一起保留',image:'',imageToken:'',pathInput:'',files:[imported.file]}});expect(view.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'draft-result',ok:true,value:{files:[imported.file]}});
  view.dispose();view=await resolveView();await view.receive({type:'ready'});s=view.states.at(-1);await view.receive({type:'draft-read',id:1,viewId:randomUUID(),threadId:s.threadId,connectionId:0});expect(view.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'draft-result',ok:true,value:{text:'文字与文件一起保留',files:[imported.file]}});
  const records=context.workspaceState.get('codexPrototype.attachmentImports.v1');await view.receive({type:'attachment-import',id:9,threadId:'thread-a',connectionId:0,name:'stale.md',base64:Buffer.from('must not import').toString('base64')});expect(context.workspaceState.get('codexPrototype.attachmentImports.v1')).toEqual(records);
  expect(mock.start).not.toHaveBeenCalled();expect(mock.makeSession).not.toHaveBeenCalled();expect(data.attempts).toEqual([]);
 });
 it('imports the enabled editor disk snapshot into a disconnected local draft using its public draft owner',async()=>{
  const workspace=ownedDraftWorkspace(),path=join(workspace,'editor.md');writeFileSync(path,'saved editor snapshot');mock.editor={document:{uri:{scheme:'file',fsPath:path},version:1,isDirty:false}};
  await activate(context);const view=await resolveView();await view.receive({type:'ready'});const s=view.states.at(-1);expect(s.editorContext.source).toMatchObject({name:'editor.md',path:'editor.md'});
  await view.receive({type:'editor-context',id:1,threadId:s.threadId,connectionId:0,action:'import',sourceKey:s.editorContext.source.key});const imported=view.webview.postMessage.mock.calls.map(([m])=>m).find(m=>m.type==='editor-context-result'&&m.id===1);expect(imported).toMatchObject({ok:true,file:{editorSource:'editor.md'}});expect(readFileSync(imported.file.path,'utf8')).toBe('saved editor snapshot');expect(mock.start).not.toHaveBeenCalled();expect(mock.makeSession).not.toHaveBeenCalled();expect(data.attempts).toEqual([]);
 });
 it('keeps local sorting independent of a connection or sending allowance and exposes no thread-only views for a local draft',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);
  await activate(context);const view=await resolveView();await view.receive({type:'ready'});
  await view.receive({type:'thread-sort',connectionId:0,sort:'activity'});expect(view.states.at(-1).sessionCatalog.sort).toBe('activity');expect(mock.start).not.toHaveBeenCalled();
  await view.receive({type:'restart'});const state=view.states.at(-1);expect(state.ready).toBe(true);for(const key of ['history','outline','search','modelSelection','skills'])expect(state[key],key).toBeUndefined();
  await view.receive({type:'thread-sort',connectionId:1,sort:'persisted'});expect(view.states.at(-1).sessionCatalog.sort).toBe('persisted');
  await view.receive({type:'outline-scan',threadId:'codex-local-draft',connectionId:1});expect(view.states.at(-1).error).toContain('尚未打开聊天会话');expect(active.send).not.toHaveBeenCalled();expect(active.restore).not.toHaveBeenCalled();expect(active.refreshThreads).not.toHaveBeenCalled();
 });
 it('opens a single explicitly requested shared offline page, isolates its drafts and rejects send without starting RPC',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);
  await activate(context);await mock.commands.get('codexPrototype.openOfflineExperience')!();const panel=mock.createPanel.mock.results.at(-1)!.value as FakeView;await panel.receive({type:'ready'});
  expect(panel.webview.html).toContain('id="prompt"');expect(panel.states.at(-1)).toMatchObject({offlinePreview:true,ready:false,contentReady:true,used:null,limit:null});const s=panel.states.at(-1),viewId=randomUUID();
  expect(mock.execute).toHaveBeenCalledWith('workbench.action.closeAuxiliaryBar');
  for(const [type,reply] of [['changed-files-fold-read','changed-files-folds'],['changed-review-read','changed-review-records']]){await panel.receive({type,readId:1,threadId:s.threadId,connectionId:s.connectionId});expect(panel.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:reply,readId:1});expect(panel.states.at(-1).error).toBe('');}
  await panel.receive({type:'draft-read',id:1,viewId,threadId:s.threadId,connectionId:s.connectionId});await panel.receive({type:'draft-save',id:2,viewId,threadId:s.threadId,connectionId:s.connectionId,value:{text:'合成草稿',image:'',imageToken:'',pathInput:''}});
  await panel.receive({type:'draft-save',id:3,viewId,threadId:s.threadId,connectionId:s.connectionId,value:{text:'合成草稿',image:'real-file.png',imageToken:'x',pathInput:''}});expect(panel.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'draft-result',ok:false,error:expect.stringContaining('仅保存文字')});
  const daily=new DraftStore(context.workspaceState);expect((await daily.load(s.threadId)).text).toBe('');
  await panel.receive({type:'send',threadId:s.threadId,connectionId:s.connectionId,viewId,requestId:1,text:'blocked'});expect(panel.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'sent',ok:false,unknown:false});
  await mock.commands.get('codexPrototype.openOfflineExperience')!();expect(mock.createPanel).toHaveBeenCalledOnce();expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();expect(mock.editorReads).not.toHaveBeenCalled();
  const other=s.threads.find((id:string)=>id!==s.threadId);await panel.receive({type:'restore',threadId:other});expect(panel.states.at(-1)).toMatchObject({threadId:other,error:''});await panel.receive({type:'outline-scan',threadId:other,connectionId:s.connectionId});expect(panel.states.at(-1).outline).toMatchObject({complete:true,nodes:expect.any(Array)});
  await panel.receive({type:'restore',threadId:'real-thread'});expect(panel.states.at(-1).threadId).toBe(other);expect(panel.states.at(-1).error).toContain('合成会话不存在');
  const previous=panel.pageId;await panel.receive({type:'ready'});const count=panel.webview.postMessage.mock.calls.length;await panel.receive({type:'outline-scan',pageId:previous,threadId:s.threadId,connectionId:s.connectionId});expect(panel.webview.postMessage.mock.calls).toHaveLength(count);
 });
 it('uses the same saved opening policy for the shared experience and applies changes on the next thread selection',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);await activate(context);await mock.commands.get('codexPrototype.openOfflineExperience')!();const panel=mock.createPanel.mock.results.at(-1)!.value as FakeView;await panel.receive({type:'ready'});expect(panel.states.at(-1).history).toMatchObject({loadedTurns:6,complete:true});await panel.receive({type:'settings-save',id:1,key:'sessionHistory.loadAll',value:false});await panel.receive({type:'restore',threadId:'offline-experience-reading'});expect(panel.states.at(-1).history).toMatchObject({loadedTurns:2,hasMore:true});await panel.receive({type:'settings-save',id:2,key:'sessionHistory.loadAll',value:true});expect(panel.states.at(-1).history.loadedTurns).toBe(2);await panel.receive({type:'restore',threadId:'offline-experience-markdown'});await panel.receive({type:'restore',threadId:'offline-experience-reading'});expect(panel.states.at(-1).history).toMatchObject({loadedTurns:48,complete:true,hasMore:false});expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();expect(mock.makeSession).not.toHaveBeenCalled();
 });
 it.each([false,true])('serializes an offline restore already writing across page reload and drops retired queued choices (failure=%s)',async(fail)=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);await activate(context);await mock.commands.get('codexPrototype.openOfflineExperience')!();const panel=mock.createPanel.mock.results.at(-1)!.value as FakeView;await panel.receive({type:'ready'});const first=panel.states.at(-1),original=context.workspaceState.update.bind(context.workspaceState),writes:string[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  context.workspaceState.update=async(key:string,value:any)=>{if(key==='codexPrototype.offlineExperience.v1.selected'){writes.push(value);if(writes.length===1){await gate;if(fail)throw Error('retired save failed');}}return original(key,value);};
  const old=panel.receive({type:'restore',threadId:'offline-experience-images',selectionId:1,connectionId:first.connectionId});await vi.waitFor(()=>expect(writes).toEqual(['offline-experience-images']));const queued=panel.receive({type:'restore',threadId:'offline-experience-markdown',selectionId:2,connectionId:first.connectionId});const ready=panel.receive({type:'ready'}),latest=panel.receive({type:'restore',threadId:'offline-experience-reading',selectionId:3,connectionId:first.connectionId+1});await new Promise(r=>setTimeout(r,10));expect(writes).toEqual(['offline-experience-images']);release();await Promise.all([old,queued,ready,latest]);
  expect(writes).toEqual(['offline-experience-images','offline-experience-reading']);expect(panel.states.at(-1)).toMatchObject({threadId:'offline-experience-reading',connectionId:first.connectionId+1,error:''});expect(context.workspaceState.get('codexPrototype.offlineExperience.v1.selected','')).toBe('offline-experience-reading');expect(panel.webview.postMessage.mock.calls.map(c=>c[0]).filter(m=>m.type==='session-selected')).toEqual([{type:'session-selected',id:3,threadId:'offline-experience-reading',connectionId:first.connectionId+1,ok:true,pageId:panel.pageId}]);expect(mock.start).not.toHaveBeenCalled();
 });
 it('preserves explicit offline demo opening while invalid modes cannot opt into a connection',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE','invalid-online');await activate(context);
  expect(mock.execute).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();
 });
 it('saves a current shared-offline image through the real host handler using the open workspace and chosen local target',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);
  const workspace=join(root,'ordinary');mkdirSync(workspace);mock.workspaceRoot=workspace;
  await activate(context);await mock.commands.get('codexPrototype.openOfflineExperience')!();const panel=mock.createPanel.mock.results.at(-1)!.value as FakeView;await panel.receive({type:'ready'});
  await panel.receive({type:'restore',threadId:'offline-experience-images'});
  const s=panel.states.at(-1),row=s.items.find((row:any)=>row.item.type==='userMessage'&&row.item.content.some((part:any)=>part.displayImage)),image=row.item.content.find((part:any)=>part.displayImage).displayImage,target=join(workspace,'chosen.'+(image.src.startsWith('data:image/png;')?'png':'jpg'));
  mock.saveDialog.mockResolvedValueOnce({scheme:'file',fsPath:target});
  await panel.receive({type:'image-export',id:1,threadId:s.threadId,connectionId:s.connectionId,turnId:row.turnId,itemId:row.item.id,imageId:image.id,kind:'save'});
  expect(panel.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'image-exported',id:1,ok:true,result:'saved'});
  expect(mock.saveDialog.mock.calls[0]![0].defaultUri.fsPath).toBe(join(workspace,image.name));
  expect(readFileSync(target)).toEqual(Buffer.from(image.src.split(',')[1],'base64'));expect(Object.values(IMAGE_ASSETS).some(v=>v.src===image.src)).toBe(true);
  expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();expect(mock.nativeImage).toHaveBeenCalledOnce();
 });
 it('routes a shared-offline formula through the real exporter and selected file without RPC or execution allowance',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE',undefined);vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);
  const workspace=join(root,'ordinary-formulas');mkdirSync(workspace);mock.workspaceRoot=workspace;
  await activate(context);await mock.commands.get('codexPrototype.openOfflineExperience')!();const panel=mock.createPanel.mock.results.at(-1)!.value as FakeView;await panel.receive({type:'ready'});await panel.receive({type:'restore',threadId:'offline-experience-images'});
  const s=panel.states.at(-1),parser=new (require('markdown-it'))(),row=s.items.find((v:any)=>v.item.type==='agentMessage'&&prepareMath(v.item.text,parser).values.size>0),formula=[...prepareMath(row.item.text,parser).values.values()][0]!,svg='<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="10px"><path d="M0 0H10V10H0Z"/></svg>',target=join(workspace,'formula.svg');
  expect(s.formulaExportUnavailableReason).toBeUndefined();mock.saveDialog.mockResolvedValueOnce({scheme:'file',fsPath:target});
  const request={type:'formula-export',id:1,threadId:s.threadId,connectionId:s.connectionId,turnId:row.turnId,itemId:row.item.id,raw:formula.tex,display:formula.display,kind:'save-svg',svg,name:'formula-20261013-120000.svg'};
  await panel.receive(request);expect(panel.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'formula-exported',ok:true,result:'saved'});expect(readFileSync(target,'utf8')).toBe(svg);expect(mock.saveDialog.mock.calls[0]![0].defaultUri.fsPath).toBe(join(workspace,request.name));
  const calls=mock.saveDialog.mock.calls.length;await panel.receive({type:'restore',threadId:'offline-experience-markdown'});await panel.receive({...request,id:2});expect(panel.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'formula-exported',ok:false,error:expect.stringContaining('身份')});expect(mock.saveDialog).toHaveBeenCalledTimes(calls);expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();expect(mock.makeSession).not.toHaveBeenCalled();
 });
 it('exposes current public daily formulas without a controlled-run flag and rejects an obsolete page before a save',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_RUN',undefined);const workspace=join(root,'ordinary-daily-formulas');mkdirSync(workspace);mock.workspaceRoot=workspace;
  const view=await openReady();active.projection.snapshot({id:'thread-a',turns:[{id:'formula-turn',status:'completed',itemsView:'full',items:[{type:'agentMessage',id:'formula-answer',text:'$x$'}]}]} as never);active.emit('change');await vi.waitFor(()=>expect(view.states.at(-1)?.items[0]?.item.id).toBe('formula-answer'));expect(view.states.at(-1).formulaExportUnavailableReason).toBeUndefined();
  const target=join(workspace,'daily.svg'),svg='<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="10px"><path d="M0 0H10V10H0Z"/></svg>',request={type:'formula-export',id:1,threadId:'thread-a',connectionId:1,turnId:'formula-turn',itemId:'formula-answer',raw:'x',display:false,kind:'save-svg',svg,name:'formula-20261013-120000.svg'};mock.saveDialog.mockResolvedValueOnce({scheme:'file',fsPath:target});await view.receive(request);expect(view.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'formula-exported',ok:true,result:'saved'});expect(readFileSync(target,'utf8')).toBe(svg);
  const pageId=view.pageId,calls=mock.saveDialog.mock.calls.length;await view.receive({type:'ready'});await view.receive({...request,id:2,pageId});expect(mock.saveDialog).toHaveBeenCalledTimes(calls);expect(mock.batch).not.toHaveBeenCalled();expect(active.send).not.toHaveBeenCalled();
 });
 it('opens the offline launcher on the daily page and keeps the demo in a separate explicit command',async()=>{
  vi.stubEnv('CODEX_PROTOTYPE_MODE','offline');await activate(context);
  expect(mock.execute).toHaveBeenCalledExactlyOnceWith('codexPrototype.chat.focus');expect(mock.createPanel).not.toHaveBeenCalled();await mock.commands.get('codexPrototype.openOffline')!();expect(mock.createPanel).toHaveBeenCalledExactlyOnceWith('codexPrototype.offline','Codex 离线显示演示',1,expect.any(Object));
  expect(mock.start).not.toHaveBeenCalled();expect(mock.batch).not.toHaveBeenCalled();expect(mock.editorReads).not.toHaveBeenCalled();
 });
 it('reads runtime facts only for the active page and does not reconnect, dispatch or repeat reads on hide/show',async()=>{
  const view=await openReady(),shell=vi.spyOn(localPowerShell7,'binding').mockResolvedValueOnce({path:join(root,'pwsh.exe'),version:'7.6.5',edition:'Core'}),rpcReads=rpc.request.mock.calls.length;
  try{await view.receive({type:'environment-read',id:1,pageId:randomUUID()});expect(shell).not.toHaveBeenCalled();await view.receive({type:'environment-read',id:1});expect(view.webview.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({type:'environment-result',pageId:view.pageId,id:1,ok:true,value:{extensionVersion:null,extensionPath:root,vscodeVersion:'1.136.0',backend:'connected',powershellVersion:'7.6.5'}});view.setVisible(false);view.setVisible(true);await view.receive({type:'environment-read',id:1});expect(shell).toHaveBeenCalledOnce();expect(rpc.request).toHaveBeenCalledTimes(rpcReads);expect(mock.start).toHaveBeenCalledOnce();expect(active.send).not.toHaveBeenCalled();}finally{shell.mockRestore();}
 });
 it('does not deliver an old runtime reply to a replacement document with a reused request number',async()=>{
  const view=await openReady(),old=deferred<PowerShell7Binding>(),shell=vi.spyOn(localPowerShell7,'binding').mockReturnValueOnce(old.promise).mockResolvedValueOnce({path:join(root,'pwsh.exe'),version:'7.6.5',edition:'Core'});
  try{const pending=view.receive({type:'environment-read',id:1});await vi.waitFor(()=>expect(shell).toHaveBeenCalledOnce());const previous=view.pageId;await view.receive({type:'ready'});await view.receive({type:'environment-read',id:1});old.resolve({path:join(root,'pwsh.exe'),version:'7.6.4',edition:'Core'});await pending;const replies=view.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='environment-result');expect(replies).toHaveLength(1);expect(replies[0]).toMatchObject({pageId:view.pageId,id:1,ok:true,value:{powershellVersion:'7.6.5'}});expect(view.pageId).not.toBe(previous);expect(mock.start).toHaveBeenCalledOnce();expect(active.dispose).not.toHaveBeenCalled();}finally{shell.mockRestore();}
 });
 it('reads the real optional skills contract only on explicit request and hide/show never repeats that read',async()=>{const view=await openReady(),cwd=active.modelState.root;expect(view.states.at(-1).skills).toMatchObject({skills:[],complete:false,loading:false,error:'技能目录尚未读取'});rpc.request.mockResolvedValueOnce({data:[{cwd,skills:[],errors:[]}]});await view.receive({type:'skills-refresh',id:1,threadId:'thread-a',connectionId:1});expect(rpc.request).toHaveBeenLastCalledWith('skills/list',{cwds:[cwd],forceReload:true});await vi.waitFor(()=>expect(view.states.at(-1).skills).toMatchObject({complete:true,skills:[],error:''}));const count=rpc.request.mock.calls.length;view.setVisible(false);view.setVisible(true);await view.receive({type:'skills-refresh',id:1,threadId:'thread-a',connectionId:1});expect(rpc.request).toHaveBeenCalledTimes(count);expect(mock.start).toHaveBeenCalledOnce();expect(active.send).not.toHaveBeenCalled();});
 it('publishes editor metadata under the current page/connection lease without reading foreign files or reconnecting',async()=>{const view=await openReady();expect(view.states.at(-1).editorContext).toMatchObject({enabled:true,reason:'没有活动的本地文本编辑器'});mock.editor={document:{uri:{scheme:'file',fsPath:'foreign.ts'},version:1,isDirty:false}};for(const callback of mock.editorListeners)callback(mock.editor);const event=view.webview.postMessage.mock.calls.at(-1)![0];expect(event).toMatchObject({type:'editor-context-view',pageId:view.pageId,threadId:'thread-a',connectionId:1,editorContext:{enabled:true,reason:expect.stringContaining('未读取')}});view.setVisible(false);expect(view.webview.postMessage.mock.calls.at(-1)![0]).toMatchObject({type:'session-visibility',visible:false});const count=view.webview.postMessage.mock.calls.length;for(const callback of mock.editorListeners)callback(mock.editor);expect(view.webview.postMessage.mock.calls).toHaveLength(count);expect(mock.start).toHaveBeenCalledOnce();expect(mock.createPanel).not.toHaveBeenCalled();});
 it('registers a retained sidebar and mounts the unchanged page without opening an editor',async()=>{
  const view=await openReady();
  expect(mock.register).toHaveBeenCalledExactlyOnceWith('codexPrototype.chat',{webviewOptions:{retainContextWhenHidden:true}});
  expect(mock.createPanel).not.toHaveBeenCalled();expect(mock.execute).toHaveBeenCalledWith('codexPrototype.chat.focus');
  expect(view.webview.options).toEqual({enableScripts:true,localResourceRoots:[]});expect(view.webview.html).toContain('window.__codexDisplay.startPage(30000,35000)');
  expect(view.states.at(-1)).toMatchObject({ready:true,threadId:'thread-a',connectionId:1,items:[{item:{text:'thread-a 正文'}}]});
  expect(view.states.at(-1).modelSelection).toMatchObject({models:[{model:'synthetic',efforts:[{value:'balanced'},{value:'careful'}]}],complete:true,stale:false,loading:false,selectionError:'',saving:false,canSelect:true,canDefault:true});
  expect(view.states.at(-1).modelSelection.observed).toBeUndefined();
 });
 it('publishes the real model view with per-thread preferences and unavailable catalog state',async()=>{
  const view=await openReady();await active.modelState.selectNextModel({model:'synthetic',effort:'careful'});
  await vi.waitFor(()=>expect(view.states.at(-1).modelSelection.nextChoice).toEqual({model:'synthetic',effort:'careful'}));
  await view.receive({type:'restore',threadId:'thread-b'});await vi.waitFor(()=>{expect(view.states.at(-1).threadId).toBe('thread-b');expect(view.states.at(-1).modelSelection.nextChoice).toBeUndefined();});
  await view.receive({type:'restore',threadId:'thread-a'});await vi.waitFor(()=>{expect(view.states.at(-1).threadId).toBe('thread-a');expect(view.states.at(-1).modelSelection.nextChoice).toEqual({model:'synthetic',effort:'careful'});});
  active.modelState.models.invalidate('synthetic catalog invalidated');active.modelState.emit('change');
  await vi.waitFor(()=>expect(view.states.at(-1).modelSelection).toMatchObject({complete:false,stale:true,error:'synthetic catalog invalidated',selectionError:expect.stringContaining('未完整核对'),nextChoice:{model:'synthetic',effort:'careful'}}));
  await expect(active.modelState.selectNextModel({model:'synthetic',effort:'balanced'})).rejects.toThrow('未完整核对');
  expect(rpc.request.mock.calls.every(([method]:[string])=>method==='model/list')).toBe(true);
 });
 it('retains the session when hidden and publishes the latest projection on show',async()=>{
  const view=await openReady(),count=view.states.length;
  view.setVisible(false);active.status='hidden update';active.emit('change');await Promise.resolve();
  expect(view.states).toHaveLength(count);expect(active.dispose).not.toHaveBeenCalled();expect(mock.speechStop).toHaveBeenCalled();
  view.setVisible(true);await vi.waitFor(()=>expect(view.states.at(-1)?.status).toBe('hidden update'));
  expect(mock.start).toHaveBeenCalledOnce();expect(view.states.at(-1)?.connectionId).toBe(1);
 });
 it('rebuilds a disposed view using the existing session, selected thread and persisted draft',async()=>{
  const first=await openReady();await first.receive({type:'restore',threadId:'thread-b'});
  const firstId='00000000-0000-4000-8000-000000000001',nextId='00000000-0000-4000-8000-000000000002';
  await first.receive({type:'draft-read',id:1,viewId:firstId,threadId:'thread-b',connectionId:1});
  await first.receive({type:'draft-save',id:2,viewId:firstId,threadId:'thread-b',connectionId:1,value:{text:'未发送草稿',image:'',pathInput:'',imageToken:''}});
  first.dispose();expect(active.dispose).not.toHaveBeenCalled();
  const next=await resolveView();await next.receive({type:'ready'});
  expect(mock.start).toHaveBeenCalledOnce();expect(active.restore).toHaveBeenCalledTimes(2);
  expect(next.states.at(-1)).toMatchObject({threadId:'thread-b',connectionId:1,items:[{item:{text:'thread-b 正文'}}]});
  await next.receive({type:'draft-read',id:1,viewId:nextId,threadId:'thread-b',connectionId:1});
  expect(next.webview.postMessage.mock.calls.map(([m])=>m)).toContainEqual(expect.objectContaining({type:'draft-result',ok:true,value:expect.objectContaining({text:'未发送草稿'})}));
 });
 it('lets a pending connection complete after view replacement without starting another RPC',async()=>{
  const pending=deferred<any>();mock.start.mockReturnValueOnce(pending.promise);
  await activate(context);const first=await resolveView();await first.receive({type:'ready'});const ready=first.receive({type:'restart'});
  await vi.waitFor(()=>expect(mock.start).toHaveBeenCalledOnce());first.dispose();
  const next=await resolveView();await next.receive({type:'ready'});pending.resolve(rpc);await ready;expect(active.restore).not.toHaveBeenCalled();await next.receive({type:'restore',threadId:'thread-a'});
  expect(rpc.dispose).not.toHaveBeenCalled();expect(mock.makeSession).toHaveBeenCalledOnce();
  await vi.waitFor(()=>expect(next.states.at(-1)).toMatchObject({ready:true,threadId:'thread-a',connectionId:1}));
 });
 it('renews document leases on the same view and drops old receipts without reconnecting',async()=>{
  const view=await openReady(),oldId='00000000-0000-4000-8000-000000000003',newId='00000000-0000-4000-8000-000000000004';
  await view.receive({type:'draft-read',id:1,viewId:oldId,threadId:'thread-a',connectionId:1});
   await view.receive({type:'draft-save',id:2,viewId:oldId,threadId:'thread-a',connectionId:1,value:{text:'重建后恢复',image:'',pathInput:'',imageToken:''}});
  const pending=deferred<void>();mock.clipboard.mockReturnValueOnce(pending.promise);
  const oldCopy=view.receive({type:'copy-display',id:1,threadId:'thread-a',connectionId:1,text:'old document'});
  await vi.waitFor(()=>expect(mock.clipboard).toHaveBeenCalledOnce());
  await view.receive({type:'ready'});await view.receive({type:'draft-read',id:1,viewId:newId,threadId:'thread-a',connectionId:1});
  pending.resolve();await oldCopy;
  const messages=view.webview.postMessage.mock.calls.map(([m])=>m);
  expect(messages).toContainEqual(expect.objectContaining({type:'draft-result',viewId:newId,ok:true,value:expect.objectContaining({text:'重建后恢复'})}));
  expect(messages.filter(m=>m.type==='display-copied')).toEqual([]);expect(mock.start).toHaveBeenCalledOnce();
  expect(active.dispose).not.toHaveBeenCalled();
   await view.receive({type:'draft-save',id:3,viewId:oldId,threadId:'thread-a',connectionId:1,value:{text:'obsolete',image:'',pathInput:'',imageToken:''}});
  expect(view.webview.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({type:'draft-result',viewId:oldId,ok:false});
 });
 it('discards delayed old-page receipts and ignores old-page commands after replacement',async()=>{
  const first=await openReady(),pending=deferred<void>();mock.clipboard.mockReturnValueOnce(pending.promise);
  const copy=first.receive({type:'copy-display',id:1,threadId:'thread-a',connectionId:1,text:'old'});
  await vi.waitFor(()=>expect(mock.clipboard).toHaveBeenCalledOnce());first.dispose();
  const next=await resolveView();await next.receive({type:'ready'});pending.resolve();await copy;
  await first.receive({type:'restore',threadId:'thread-b'});
  expect(next.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='display-copied')).toEqual([]);
  expect(active.projection.threadId).toBe('thread-a');expect(first.webview.postMessage.mock.calls.filter(([m])=>m.type==='display-copied')).toEqual([]);
 });
 it('preserves an initial connection failure across rebuild and only retries on explicit restart',async()=>{
  mock.start.mockRejectedValueOnce(Error('synthetic connection failure'));
  const first=await openReady();expect(first.states.at(-1)).toMatchObject({ready:false,error:'synthetic connection failure'});first.dispose();
  const next=await resolveView();await next.receive({type:'ready'});expect(mock.start).toHaveBeenCalledOnce();
  await next.receive({type:'restart'});expect(mock.start).toHaveBeenCalledTimes(2);expect(active.restore).not.toHaveBeenCalled();await next.receive({type:'restore',threadId:'thread-a'});await vi.waitFor(()=>expect(next.states.at(-1)).toMatchObject({ready:true,threadId:'thread-a',connectionId:2}));
 });
 it('does not resurrect a session when a pending RPC start finishes after deactivation',async()=>{
  const pending=deferred<any>();mock.start.mockReturnValueOnce(pending.promise);
  await activate(context);const view=await resolveView();await view.receive({type:'ready'});const ready=view.receive({type:'restart'});
  await vi.waitFor(()=>expect(mock.start).toHaveBeenCalledOnce());await deactivate();pending.resolve(rpc);await ready;
  expect(rpc.dispose).toHaveBeenCalledOnce();expect(mock.makeSession).not.toHaveBeenCalled();
 });
 it('discards an old document action error after a new ready handshake',async()=>{
  const view=await openReady(),pending=deferred<void>();
  active.restore.mockImplementationOnce(async()=>{await pending.promise;throw Error('obsolete page action');});
  const restore=view.receive({type:'restore',threadId:'thread-b'});
  await vi.waitFor(()=>expect(active.restore).toHaveBeenCalledTimes(2));await view.receive({type:'ready'});pending.resolve();await restore;
  expect(active.error).toBe('');expect(view.states.at(-1)).toMatchObject({threadId:'thread-a',error:''});
 });
 it('still disposes the actual session on explicit restart and extension shutdown',async()=>{
  const view=await openReady(),old=active;await view.receive({type:'restart'});
  expect(old.dispose).toHaveBeenCalledExactlyOnceWith('server-restart');expect(mock.start).toHaveBeenCalledTimes(2);
  const current=active;await deactivate();expect(current.dispose).toHaveBeenCalledOnce();
 });
 it('does not submit A or clear its draft when restore wins during draft persistence',async()=>{
  const view=await openReady(),pending=deferred<any>(),begin=vi.spyOn(DraftStore.prototype,'begin').mockReturnValueOnce(pending.promise);
  const finish=vi.spyOn(DraftStore.prototype,'finish').mockResolvedValueOnce({} as never);
  const draftEditId=randomUUID(),send=view.receive({type:'send',viewId:randomUUID(),requestId:1,threadId:'thread-a',connectionId:1,text:'A draft',image:'',draftEditId});
  await vi.waitFor(()=>expect(begin).toHaveBeenCalledOnce());await view.receive({type:'restore',threadId:'thread-b'});pending.resolve({});await send;
  expect(active.send).not.toHaveBeenCalled();expect(finish).toHaveBeenCalledWith('thread-a','A draft','',false,undefined,undefined,undefined,undefined,draftEditId);
  begin.mockRestore();finish.mockRestore();
 });
 it.each([false,true])('Stop during durable draft begin prevents a late dispatch, preserves content and permits a new send (image=%s)',async withImage=>{
  const view=await openReady(),viewId=randomUUID(),draftEditId=randomUUID(),image=withImage?join(root,'image.png'):'',value={text:'cancel before dispatch',image,imageToken:withImage?'image-token':'',pathInput:'',draftEditId};
  await view.receive({type:'draft-read',id:1,viewId,threadId:'thread-a',connectionId:1});
  await view.receive({type:'draft-save',id:2,viewId,threadId:'thread-a',connectionId:1,value});
  const pending=deferred<void>(),update=context.workspaceState.update;let waiting=false;
  context.workspaceState.update=async(key:string,next:any)=>{if(key==='codexPrototype.drafts.v1'&&next.some(([,v]:any)=>v.uncertain)&&!waiting){waiting=true;await pending.promise;}await update(key,next);};
  const message={type:'send',viewId,requestId:1,threadId:'thread-a',connectionId:1,...value,...(withImage?{imageProofs:[{path:image,sha256:'a'.repeat(64)}]}:{})},sending=view.receive(message);
  await vi.waitFor(()=>expect(waiting).toBe(true));await view.receive({type:'stop',threadId:'thread-a',connectionId:1});pending.resolve();await sending;
  expect(active.send).not.toHaveBeenCalled();expect(new DraftStore(context.workspaceState).read('thread-a')).toMatchObject({...value,uncertain:false});
  expect(view.webview.postMessage.mock.calls.map(([m])=>m).filter(m=>m.type==='sent')).toMatchObject([{requestId:1,ok:false,unknown:false}]);
  await view.receive({...message,requestId:2});expect(active.send).toHaveBeenCalledOnce();expect(new DraftStore(context.workspaceState).read('thread-a')).toMatchObject({text:'',image:'',uncertain:false});
 });
 it('cancel completion cannot clear a newer same-text draft queued while begin is still saving',async()=>{
  const view=await openReady(),viewId=randomUUID(),value={text:'same text',image:'',imageToken:'',pathInput:'',draftEditId:randomUUID()};
  await view.receive({type:'draft-read',id:1,viewId,threadId:'thread-a',connectionId:1});await view.receive({type:'draft-save',id:2,viewId,threadId:'thread-a',connectionId:1,value});
  const gate=deferred<void>(),update=context.workspaceState.update;let waiting=false;context.workspaceState.update=async(key:string,next:any)=>{if(key==='codexPrototype.drafts.v1'&&next.some(([,v]:any)=>v.uncertain)&&!waiting){waiting=true;await gate.promise;}await update(key,next);};
  const sending=view.receive({type:'send',viewId,requestId:1,threadId:'thread-a',connectionId:1,...value});await vi.waitFor(()=>expect(waiting).toBe(true));await view.receive({type:'stop',threadId:'thread-a',connectionId:1});
  const next={...value,draftEditId:randomUUID()},saving=view.receive({type:'draft-save',id:3,viewId,threadId:'thread-a',connectionId:1,value:next});gate.resolve();await Promise.all([sending,saving]);
  expect(active.send).not.toHaveBeenCalled();expect(new DraftStore(context.workspaceState).read('thread-a')).toEqual({...next,uncertain:false});expect(active.error).toBe('');
 });
 it('rejects commands queued by the prior document on the same view',async()=>{
  const view=await openReady(),oldId=view.pageId;await view.receive({type:'ready'});
  const count=active.restore.mock.calls.length;await view.receive({type:'restore',threadId:'thread-b',pageId:oldId});
  expect(active.restore).toHaveBeenCalledTimes(count);expect(active.projection.threadId).toBe('thread-a');
  await view.receive({type:'copy-display',id:1,threadId:'thread-a',connectionId:1,text:'new'});
  expect(view.webview.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({type:'display-copied',pageId:view.pageId});
 });
 it('retries a same-thread projection changed during an asynchronous resource check',async()=>{
  const view=await openReady(),image=deferred<any>();
  active.projection.snapshot({id:'thread-a',turns:[{id:'live',status:'inProgress',itemsView:'full',items:[{type:'userMessage',id:'image',content:[{type:'localImage',path:'image.png'}]},{type:'agentMessage',id:'answer',text:'old'}]}]} as never);
  mock.checkImage.mockReturnValueOnce(image.promise);const state=mock.commands.get('codexPrototype.inspect')!();
  await vi.waitFor(()=>expect(mock.checkImage).toHaveBeenCalledOnce());
  active.projection.apply({method:'item/agentMessage/delta',params:{threadId:'thread-a',turnId:'live',itemId:'answer',delta:' + latest'}} as never);active.emit('change');
  image.resolve({id:'image',name:'image.png',error:'synthetic'});
  expect((await state).items.find((row:any)=>row.item.id==='answer').item.text).toBe('old + latest');
  await vi.waitFor(()=>expect(view.states.at(-1)?.items.find((row:any)=>row.item.id==='answer').item.text).toBe('old + latest'));
 });
 it('coalesces superseded image projections into one fresh check and still rechecks the next publish',async()=>{
  const view=await openReady(),image=deferred<any>(),start=view.states.length;
  active.projection.snapshot({id:'thread-a',turns:[{id:'live',status:'inProgress',itemsView:'full',items:[{type:'userMessage',id:'image',content:[{type:'localImage',path:'image.png'}]},{type:'agentMessage',id:'answer',text:'old'}]}]} as never);
  mock.checkImage.mockClear();mock.checkImage.mockReturnValueOnce(image.promise);active.emit('change');
  await vi.waitFor(()=>expect(mock.checkImage).toHaveBeenCalledOnce());
  for(let n=0;n<100;n++){active.projection.apply({method:'item/agentMessage/delta',params:{threadId:'thread-a',turnId:'live',itemId:'answer',delta:'+'}} as never);active.emit('change');}
  image.resolve({id:'image',name:'image.png',error:'superseded'});
  await vi.waitFor(()=>expect(view.states.at(-1)?.items.find((row:any)=>row.item.id==='answer').item.text).toBe('old'+'+'.repeat(100)));
  expect(mock.checkImage).toHaveBeenCalledTimes(2);expect(view.states.slice(start)).toHaveLength(1);
  mock.checkImage.mockResolvedValueOnce({id:'image',name:'image.png',error:'source replaced'});active.emit('change');
  await vi.waitFor(()=>expect(mock.checkImage).toHaveBeenCalledTimes(3));
  await vi.waitFor(()=>expect(view.states).toHaveLength(start+2));
  expect(JSON.stringify(view.states.at(-1))).toContain('source replaced');
 });
 it.each(['hidden','disposed','deactivated'])('does not start a fresh image projection after the page is %s',async end=>{
  const view=await openReady(),image=deferred<any>(),start=view.states.length;
  active.projection.snapshot({id:'thread-a',turns:[{id:'live',status:'inProgress',itemsView:'full',items:[{type:'userMessage',id:'image',content:[{type:'localImage',path:'image.png'}]}]}]} as never);
  mock.checkImage.mockClear();mock.checkImage.mockReturnValueOnce(image.promise);active.emit('change');
  await vi.waitFor(()=>expect(mock.checkImage).toHaveBeenCalledOnce());active.emit('change');
  if(end==='hidden')view.setVisible(false);else if(end==='disposed')view.dispose();else await deactivate();
  image.resolve({id:'image',name:'image.png',error:'superseded'});
  // A task boundary drains the pending projection and any immediately queued retries.
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(mock.checkImage).toHaveBeenCalledOnce();expect(view.states).toHaveLength(start);
  if(end==='hidden'){view.setVisible(true);await vi.waitFor(()=>expect(view.states).toHaveLength(start+1));expect(mock.checkImage).toHaveBeenCalledTimes(2);}
 });
 it('publishes the latest image snapshot only to the replacement ready page',async()=>{
  const view=await openReady(),image=deferred<any>(),start=view.webview.postMessage.mock.calls.length,oldPage=view.pageId;
  active.projection.snapshot({id:'thread-a',turns:[{id:'live',status:'inProgress',itemsView:'full',items:[{type:'userMessage',id:'image',content:[{type:'localImage',path:'image.png'}]},{type:'agentMessage',id:'answer',text:'old'}]}]} as never);
  mock.checkImage.mockClear();mock.checkImage.mockReturnValueOnce(image.promise);active.emit('change');
  await vi.waitFor(()=>expect(mock.checkImage).toHaveBeenCalledOnce());await view.receive({type:'ready'});expect(view.pageId).not.toBe(oldPage);
  active.projection.apply({method:'item/agentMessage/delta',params:{threadId:'thread-a',turnId:'live',itemId:'answer',delta:' newest'}} as never);active.emit('change');image.resolve({id:'image',name:'image.png',error:'superseded'});
  await vi.waitFor(()=>expect(view.states.at(-1)?.items.find((row:any)=>row.item.id==='answer').item.text).toBe('old newest'));
  expect(view.webview.postMessage.mock.calls.slice(start).filter(([m])=>m.type==='state').map(([m])=>m.pageId)).toEqual([view.pageId]);expect(mock.checkImage).toHaveBeenCalledTimes(2);
 });
 it('discards the old image projection when another thread is selected before its check finishes',async()=>{
  const view=await openReady(),image=deferred<any>(),start=view.states.length;
  active.projection.snapshot({id:'thread-a',turns:[{id:'live',status:'completed',itemsView:'full',items:[{type:'userMessage',id:'old-image',content:[{type:'localImage',path:'old.png'}]}]}]} as never);
  mock.checkImage.mockClear();mock.checkImage.mockReturnValueOnce(image.promise);active.emit('change');
  await vi.waitFor(()=>expect(mock.checkImage).toHaveBeenCalledOnce());await view.receive({type:'restore',threadId:'thread-b'});image.resolve({id:'old-image',name:'old.png',error:'stale image'});
  await vi.waitFor(()=>expect(view.states.at(-1)?.threadId).toBe('thread-b'));
  expect(view.states.slice(start).map(state=>state.threadId)).toEqual(['thread-b']);expect(JSON.stringify(view.states.slice(start))).not.toContain('stale image');expect(JSON.stringify(view.states.at(-1))).toContain('thread-b 正文');
 });
 it('serializes state posts across reconnect while the prior enqueue receipt is pending',async()=>{
  const view=await openReady(),count=view.states.length,old=active,queued=deferred<boolean>();
  const original=view.webview.postMessage.getMockImplementation()!;let held=false;view.webview.postMessage.mockImplementation(async message=>{if(message.type==='state'&&!held){held=true;return queued.promise;}return original(message);});
  try{
   old.status='old queued state';old.emit('change');
   await vi.waitFor(()=>expect(view.states).toHaveLength(count+1));
   await view.receive({type:'restart'});expect(mock.start).toHaveBeenCalledTimes(2);expect(active).not.toBe(old);await view.receive({type:'restore',threadId:'thread-a'});
   expect(view.states.slice(count).map(state=>state.connectionId)).toEqual([1]);
   active.emit('change');queued.resolve(true);
   await vi.waitFor(()=>expect(view.states.at(-1)).toMatchObject({connectionId:2,threadId:'thread-a',status:'ready'}));
   const published=view.states.slice(count);expect(published.map(state=>state.connectionId)).toEqual([1,2]);
   expect(published.filter(state=>state.connectionId===2).every(state=>state.status!=='old queued state')).toBe(true);
  }finally{queued.resolve(true);}
 });
 it.each(['pending','rejected']as const)('a %s visibility receipt cannot block the next state publication',async kind=>{const view=await openReady(),count=view.states.length,queued=deferred<boolean>(),original=view.webview.postMessage.getMockImplementation()!;view.webview.postMessage.mockImplementation(async message=>message.type==='session-visibility'?kind==='pending'?queued.promise:Promise.reject(Error('synthetic visibility failure')):original(message));try{active.status='state independent of visibility';active.emit('change');await vi.waitFor(()=>expect(view.states).toHaveLength(count+1));expect(view.states.at(-1).status).toBe('state independent of visibility');}finally{queued.resolve(true);}});
});
