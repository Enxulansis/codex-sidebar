import { EventEmitter } from 'node:events';
import { resolve,join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Transport, Notification, IncomingRequest } from './rpc';
import type { ThreadStartResponse } from './protocol/v2/ThreadStartResponse';
import type { ThreadResumeResponse } from './protocol/v2/ThreadResumeResponse';
import type { ThreadReadResponse } from './protocol/v2/ThreadReadResponse';
import type { ThreadForkResponse } from './protocol/v2/ThreadForkResponse';
import type { TurnStartResponse } from './protocol/v2/TurnStartResponse';
import type { TurnSteerResponse } from './protocol/v2/TurnSteerResponse';
import {RpcRequestRejected} from './rpc';
import type { ConfigReadResponse } from './protocol/v2/ConfigReadResponse';
import type { ListMcpServerStatusResponse } from './protocol/v2/ListMcpServerStatusResponse';
import type { RequestId } from './protocol/RequestId';
import { Projection } from './state';
import type {TurnMetricsPersistence} from './turn-metrics-store';
import { ownedPath } from './storage';
import type {SessionStore} from './session-access';
import {checkConfig, verifyTools, type ToolCheck} from './tools';
import {attachmentInputs} from './attachment-files';
import {createDocumentReader,type DocumentReader} from './document-reader';
import type {ImageProof} from './attachment-policy';
import type {DraftFile} from './draft-store-types';
import type {ThreadCatalog,ThreadMutation} from './thread-catalog';
import {ThreadHistory,HISTORY_TURN_PAGE} from './thread-history';
import {HISTORY_LOAD_DEFAULTS,type HistoryPreferences} from './history-preferences';
import {ThreadOutline} from './thread-outline';
import {ThreadSearch,type SearchAvailability} from './thread-search';
import type {SearchCache} from './search-cache';
import type {AttachmentRetention} from './attachment-retention';
import type {MessageFileSources} from './message-file-sources';
import {ModelCatalog,ModelSelections,type ModelChoice,type ModelSelectionView} from './model-selection';
import {SkillCatalog} from './skills';
import {validSkillReference,skillPrompt,type SkillReference} from './skill-reference';
import {validClientMessageId} from './send-request';
import {PermissionCatalog,permissionRequest,permissionReceipt,type PermissionPreset,type PermissionReceipt,type PermissionSelectionView} from './permission-selection';
import {ModeCatalog,ModeSelections,type ChatMode,type ModeSelectionView} from './collaboration-mode';
import {validateUserInput,userInputResponse,type NativeUserInput} from './native-user-input';
import {ManualCompaction,type CompactionView} from './manual-compaction';
import {readRevertRange,assertRevertThread,type RevertPreview} from './conversation-revert';
import type {ThreadRevertResponse} from './protocol/v2/ThreadRevertResponse';

type Approval = Extract<IncomingRequest, {method: 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval'}> & {callbackToken: string};
const SCOPE = 'This is a restricted integration test. Only use the current temporary workspace. Do not read or modify anything outside it. Do not use network tools, plugins, subagents, or inspect credentials. Ask for approval when required; do not find alternatives after a declined operation.';
const APPROVAL_SHELL = join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell','pwsh.exe');
const READ_WINDOW_THREADS=4,READ_WINDOW_PAGES=8,READ_WINDOW_TURNS=READ_WINDOW_PAGES*HISTORY_TURN_PAGE;
export function allowedCommand(command: string): boolean {
  const wrapper = command.match(/^"([^"]+)"(?: -NoProfile)? -Command "([^"]+)"$/);
  let body = command;
  if (wrapper) {
    // Official displays may add exactly NoProfile and escape separators. No other shell arguments.
    if (resolve(wrapper[1]!.replace(/\\{2,}/g, '\\')).toLowerCase() !== resolve(APPROVAL_SHELL).toLowerCase()) return false;
    body = wrapper[2]!;
  }
  return /^(?:Write-Output '[a-zA-Z0-9 _-]{1,80}'|Start-Sleep -Seconds [1-3]; Write-Output '[a-zA-Z0-9 _-]{1,80}')$/.test(body);
}
export class Session extends EventEmitter {
  readonly projection:Projection;
  readonly history=new ThreadHistory();
  readonly outline:ThreadOutline;
  readonly search:ThreadSearch;
  private navigationIntent=0;
  readonly approvals = new Map<RequestId, Approval>();
  readonly userInputs = new Map<RequestId, NativeUserInput>();
  readonly modes:ModeCatalog;
  get waitingForUserInput(){return this.userInputs.size>0;}
  status = '未连接';
  private errorText = '';
  errorTurnId: string | undefined;
  get error():string { return this.errorText; }
  set error(value:string) { this.errorText=value;this.errorTurnId=undefined; }
  model = '';
  reasoningEffort:string|null=null;
  readonly models:ModelCatalog;
  readonly skills:SkillCatalog;
  readonly permissions:PermissionCatalog;
  private permissionChoices=new Map<string,PermissionPreset>();
  private permissionReceipts=new Map<string,PermissionReceipt>();
  private permissionRevision=0;
  private submittedPermission:{threadId:string;preset:PermissionPreset;outcome:'accepted'|'rejected'|'unknown'}|undefined;
  private observedModelThread='';
  private observedServiceTier:string|null|undefined;
  private submittedModel:{threadId:string;turnId?:string;choice:ModelChoice;outcome:'accepted'|'rejected'|'unknown'}|undefined;
  auth = '';
  busy = false;
  private canceled = false;
  private cancelVersion = 0;
  /** Captured before durable submission preparation; Stop invalidates old work without blocking a later explicit send. */
  get cancellationVersion(){return this.cancelVersion;}
  private connected = true;
  private operation = false;
  private reverting:'preparing'|'submitted'|undefined;
  private revertConflict=false;
  private revertedTurns=new Set<string>();
  private compaction:ManualCompaction|undefined;
  private compactionLock:ManualCompaction|undefined;
  private compactionCheck:{value:ManualCompaction;previous:ToolCheck}|undefined;
  private needsRecovery = false;
  private attempt: string | undefined;
  private pendingStart = false;
  private documentPreparation:AbortController|undefined;
  private currentTurnId: string | undefined;
  private turnAttempts = new Map<string, string>();
  private interrupting = new Set<string>();
  private retired = false;
  private invalidatedTurns = new Set<string>();
  private historyInvalidation=0;
  // Only a range boundary, never cached bodies, official versions or reusable cursors.
  private readWindows=new Map<string,string>();
  private archiveNotifications=new Map<string,boolean>();
  private managedThreadId='';
  private deletedNotifications=new Set<string>();
  // Only thread/start receipts verified on this live connection. Never persist
  // these as recoverable history: the server has not materialized an empty thread.
  private emptyStarts=new Map<string,ThreadStartResponse>();
  private titleTurn='';
  permissionSnapshot: unknown;
  serviceStatusRevision=0;
  appCatalogRevision=0;
  toolCheck: ToolCheck = {verified: false, reason: '尚未核对实例配置与工具目录', threadId: ''};
  constructor(readonly rpc: Transport, readonly root: string, readonly store: SessionStore,readonly catalog?:ThreadCatalog,private readonly retention?:Pick<AttachmentRetention,'retain'|'beginFork'|'finishFork'|'cancelFork'>,readonly fileSources?:MessageFileSources,readonly modelSelections?:ModelSelections,readonly searchCache?:SearchCache,private readonly historyPreferences:()=>HistoryPreferences=()=>HISTORY_LOAD_DEFAULTS,private readonly initialModel?:ModelChoice,private readonly instructions=SCOPE,private readonly documentText=false,readonly modeSelections?:ModeSelections,metricsPersistence?:TurnMetricsPersistence) {
    super();
    this.projection=new Projection(metricsPersistence,error=>this.emit('metrics-error',error));
    this.models=new ModelCatalog(rpc);
    this.skills=new SkillCatalog(rpc,root);
    this.permissions=new PermissionCatalog(rpc,root);
    this.modes=new ModeCatalog(rpc);
    this.outline=new ThreadOutline(searchCache);
    this.search=new ThreadSearch(rpc,root,searchCache,id=>this.isConnected&&!this.store.hasAttempts(id)&&!(this.store.read().invalidatedApprovals??[]).some(a=>a.threadId===id)?this.emptyStarts.get(id)?.thread:undefined,id=>this.searchAvailability(id));
    rpc.on('disconnect',()=>this.abandonCompaction('压缩连接已断开，结果未确认；请恢复核对，未自动重试'));
    rpc.on('disconnect',()=>{this.documentPreparation?.abort();this.emptyStarts.clear();this.permissionChoices.clear();this.permissionReceipts.clear();this.permissionRevision++;this.permissions.invalidate('连接已断开，权限目录待重新核对');this.modes.invalidate('连接已断开，模式目录待重新核对');});
    for (const item of store.read().attempts) if (item.turnId) this.turnAttempts.set(item.turnId, item.id);
    rpc.on('notification', (n: Notification) => this.notification(n));
    rpc.on('request', (r: IncomingRequest) => void this.request(r).catch(e => this.problem(e)));
    rpc.on('disconnect', (e: Error) => { this.readWindows.clear();this.skills.invalidate('连接已断开，技能目录待重新核对');this.models.invalidate('连接已断开，模型目录待重新核对');this.emit('queue-pause','连接已断开；核对历史后手动继续本地队列');this.search.cancel('连接已断开，搜索结果仅为旧快照');this.navigationIntent++;this.outline.invalidate('连接已断开，节点范围待核对');this.history.invalidate('连接已断开，历史覆盖范围未重新核对');this.projection.metrics.disconnect();this.toolCheck = {verified: false, reason: '连接已断开，工具核对失效', threadId: ''}; this.connected = false; this.busy = false; this.invalidate('connection-disconnected'); this.status = '连接断开，'+this.invalidatedRequestLabel(this.projection.threadId)+'已失效，请恢复'; this.problem(e); });
  }
  private changed(): void { this.emit('change'); }
  private problem(e: unknown): void { this.error = e instanceof Error ? e.message : String(e); this.changed(); }
  private invalidate(reason: string): void {
    if (this.projection.threadId) for (const value of this.store.invalidate(this.projection.threadId, reason)) this.invalidatedTurns.add(value.turnId);
    this.approvals.clear();
    this.userInputs.clear();
  }
  private invalidatedRequestLabel(thread:string){const records=(this.store.read().invalidatedApprovals??[]).filter(value=>value.threadId===thread),input=records.some(value=>value.kind==='item/tool/requestUserInput');return input?records.some(value=>value.kind!=='item/tool/requestUserInput')?'旧提问和审批':'旧提问':'旧审批';}
  private rememberPermissions(result: ThreadStartResponse | ThreadResumeResponse): void {
    // A fresh start/resume receipt supersedes an older accepted model request.
    // Inherited mode settings must not resurrect a previous override after restore.
    this.submittedModel=undefined;
    this.model = result.model ?? this.model;this.reasoningEffort=typeof result.reasoningEffort==='string'?result.reasoningEffort:null;this.observedModelThread=typeof result.model==='string'&&result.model.trim()?result.thread.id:'';
    this.observedServiceTier=result.serviceTier===null?null:typeof result.serviceTier==='string'&&result.serviceTier.length<=64?result.serviceTier:undefined;
    this.permissionSnapshot = {cwd: result.cwd, model: result.model, modelProvider: result.modelProvider, approvalPolicy: result.approvalPolicy, approvalsReviewer: result.approvalsReviewer, sandbox: result.sandbox, instructionSources: result.instructionSources, disabledPluginIds: result.disabledPluginIds};
    this.permissionChoices.delete(result.thread.id);this.permissionRevision++;
    this.permissionReceipts.set(result.thread.id,permissionReceipt({approvalPolicy:result.approvalPolicy,approvalsReviewer:result.approvalsReviewer,sandboxPolicy:result.sandbox},this.root,'thread-receipt'));
  }
  permissionView():PermissionSelectionView{
    const thread=this.projection.threadId;
    return {...this.permissions.snapshot(),desired:this.permissionChoices.get(thread)??'read-only',observed:this.permissionReceipts.get(thread),submitted:this.submittedPermission?.threadId===thread?{preset:this.submittedPermission.preset,outcome:this.submittedPermission.outcome}:undefined,canSelect:this.isConnected&&!this.busy&&!this.operation&&!this.pendingStart&&!this.needsRecovery&&!this.approvals.size&&!this.waitingForUserInput&&!!thread&&this.store.read().threads.includes(thread)&&this.toolCheck.verified&&this.toolCheck.threadId===thread};
  }
  async refreshPermissions(current:()=>boolean=()=>true){if(!this.permissionView().canSelect||!current())throw Error('当前不能读取权限目录');const refresh=this.permissions.refresh(()=>this.isConnected&&current());this.changed();try{await refresh;}finally{this.changed();}}
  selectNextPermission(preset:PermissionPreset,current:()=>boolean=()=>true){
    const thread=this.projection.threadId;if(!this.permissionView().canSelect||!current())throw Error('权限选择线程或状态已失效');this.catalog?.assertUsable(thread);this.permissions.require(preset);
    this.permissionChoices.set(thread,preset);this.permissionRevision++;this.emit('queue-pause','权限选择已修改；已有队列暂停，请核对后手动继续');this.changed();
  }
  /** Public metadata APIs only: discard all raw credentials, config text and MCP argument values. */
  modelView():ModelSelectionView|undefined{
    if(!this.modelSelections)return;const thread=this.projection.threadId;let nextChoice:ModelChoice|undefined,defaultChoice:ModelChoice|undefined,selectionError='';
    try{nextChoice=this.modelSelections.read(thread);defaultChoice=this.modelSelections.default();if(nextChoice)this.models.require(nextChoice);}catch(error){selectionError=error instanceof Error?error.message:'模型选择未核对';}
    const enabled=this.isConnected&&!this.operation&&!this.pendingStart&&!this.needsRecovery&&!this.approvals.size&&!this.waitingForUserInput&&!this.modelSelections.error()&&!this.modelSelections.saving;
    return{...this.models.snapshot(),nextChoice,defaultChoice,selectionError,saving:this.modelSelections.saving,observed:thread&&this.observedModelThread===thread?{model:this.model,effort:this.reasoningEffort,...(this.observedServiceTier!==undefined?{serviceTier:this.observedServiceTier}:{})}:undefined,submitted:this.submittedModel?.threadId===thread?structuredClone(this.submittedModel):undefined,canSelect:enabled&&!!thread&&this.store.read().threads.includes(thread),canDefault:enabled};
  }
  async refreshModels(current:()=>boolean=()=>true){if(!this.isConnected||this.operation||!current())throw Error('当前不能刷新模型目录');const refresh=this.models.refresh(()=>this.isConnected&&current());this.changed();try{await refresh;}finally{this.changed();}}
  async refreshSkills(current:()=>boolean=()=>true){if(!this.isConnected||this.operation||!current())throw Error('当前不能读取技能目录');const refresh=this.skills.refresh(()=>this.isConnected&&current());this.changed();try{await refresh;}finally{this.changed();}}
  async selectNextModel(choice:ModelChoice|undefined,current:()=>boolean=()=>true,scope:'thread'|'default'='thread'){
    if(!this.modelSelections)throw Error('当前宿主未接入模型选择存储');const thread=this.projection.threadId,live=()=>this.isConnected&&!this.operation&&!this.pendingStart&&!this.needsRecovery&&!this.approvals.size&&!this.waitingForUserInput&&this.projection.threadId===thread&&current();
    if(!live())throw Error('模型选择线程或状态已失效');if(scope==='thread'){if(!this.store.read().threads.includes(thread))throw Error('只能选择本任务线程模型');this.catalog?.assertUsable(thread);}let selected:ModelChoice|undefined;
    if(choice){const model=this.models.require(choice);selected={...choice,effort:choice.effort??model.defaultEffort};this.models.require(selected);}
    const saving=scope==='default'?this.modelSelections.setDefault(selected,live):this.modelSelections.set(thread,selected,live);this.changed();try{await saving;}finally{this.changed();}
  }
  private nextModelRequest(images:boolean):ModelChoice|undefined{
    if(!this.modelSelections)return;if(this.modelSelections.saving)throw Error('模型选择尚在保存；请等待确认后发送新回合');const choice=this.modelSelections.read(this.projection.threadId);let selected:ModelChoice|undefined;
    if(choice){const model=this.models.require(choice);selected={...choice,effort:choice.effort??model.defaultEffort};this.models.require(selected);}
    if(images){const name=selected?.model??(this.observedModelThread===this.projection.threadId?this.model:'');if(!this.models.require({model:name}).inputModalities.includes('image'))throw Error('所选模型未声明图片输入；请保留草稿并选择支持图片的模型');}return selected;
  }
  modeView():ModeSelectionView|undefined{
    if(!this.modeSelections)return;const thread=this.projection.threadId;let desired:ChatMode='default',explicit=false,selectionError='';
    try{const stored=this.modeSelections.read(thread);explicit=stored!==undefined;desired=stored??'default';if(explicit)this.nextModeRequest(this.nextModelRequest(false));}catch(error){selectionError=error instanceof Error?error.message:'模式选择未核对';}
    return{...this.modes.snapshot(),desired,explicit,selectionError,saving:this.modeSelections.saving,canSelect:this.isConnected&&!this.busy&&!this.operation&&!this.pendingStart&&!this.needsRecovery&&!this.approvals.size&&!this.waitingForUserInput&&!this.modeSelections.saving&&!this.modeSelections.error()&&!!thread&&this.store.read().threads.includes(thread)};
  }
  async refreshModes(current:()=>boolean=()=>true){if(!this.modeSelections||!this.isConnected||this.operation||!current())throw Error('当前不能读取模式目录');const refresh=this.modes.refresh(()=>this.isConnected&&current());this.changed();try{await refresh;}finally{this.changed();}}
  async selectNextMode(mode:ChatMode,current:()=>boolean=()=>true){
    const thread=this.projection.threadId,live=()=>!!this.modeView()?.canSelect&&this.projection.threadId===thread&&current();
    if(!live())throw Error('模式选择会话或状态已失效');this.catalog?.assertUsable(thread);this.modes.require(mode);
    this.emit('queue-pause','聊天模式已修改；已有队列暂停，请核对后手动继续');
    const saving=this.modeSelections!.set(thread,mode,()=>this.isConnected&&!this.busy&&!this.operation&&!this.pendingStart&&!this.needsRecovery&&!this.waitingForUserInput&&this.projection.threadId===thread&&current());this.changed();try{await saving;}finally{this.changed();}
  }
  private nextModeRequest(choice:ModelChoice|undefined){
    if(!this.modeSelections)return;if(this.modeSelections.saving)throw Error('模式选择尚在保存，请等待确认');const mode=this.modeSelections.read(this.projection.threadId);if(mode===undefined)return;
    const effective=choice??(this.submittedModel?.threadId===this.projection.threadId&&this.submittedModel.outcome==='accepted'?this.submittedModel.choice:this.observedModelThread===this.projection.threadId&&this.reasoningEffort?{model:this.model,effort:this.reasoningEffort}:undefined);
    if(!effective)throw Error('模式切换需要明确的模型和思考强度，请先在输入框选择；不会自动采用预设强度');this.models.require(effective);return this.modes.request(mode,effective);
  }
  /** Public metadata APIs only: discard all raw credentials, config text and MCP argument values. */
  async audit(): Promise<unknown> {
    const result = await this.rpc.request<'config/read', ConfigReadResponse>('config/read', {cwd: this.root, includeLayers: false});
    const c = result.config;
    const mcp: unknown[] = [];
    let cursor: string | null = null;
    do {
      const page: ListMcpServerStatusResponse = await this.rpc.request('mcpServerStatus/list', {threadId: this.projection.threadId, cursor, limit: 100, detail: 'full'});
      for (const server of page.data) mcp.push({name: server.name, runtimeStatus: server.runtimeStatus, pluginId: server.pluginId, authStatus: server.authStatus, toolNames: Object.keys(server.tools), toolInputs: Object.fromEntries(Object.entries(server.tools).map(([name, tool]) => [name, Object.keys((tool?.inputSchema as {properties?: object})?.properties ?? {})])), resourceCount: server.resources.length, resourceTemplateCount: server.resourceTemplates.length, toolsError: server.toolsError ? '工具目录读取失败' : null});
      cursor = page.nextCursor;
    } while (cursor);
    return {at: new Date().toISOString(), config: {model: c.model, modelProvider: c.model_provider, approvalPolicy: c.approval_policy, approvalsReviewer: c.approvals_reviewer, sandboxMode: c.sandbox_mode, sandboxWorkspaceWrite: c.sandbox_workspace_write, webSearch: c.web_search, modelReasoningEffort: c.model_reasoning_effort, features: c['features']}, threadPermissions: this.permissionSnapshot, mcp, inspection: 'metadata only; no MCP tools/resources called and no outside-workspace content probes'};
  }
  async preflight(): Promise<void> {
    await checkConfig(this.rpc, this.root);
    const probe = await this.rpc.request<'thread/start', ThreadStartResponse>('thread/start', {cwd: this.root, ephemeral: true,...(this.initialModel?{model:this.initialModel.model}:{}), sandbox: 'read-only', approvalPolicy: 'untrusted', approvalsReviewer: 'user', developerInstructions: this.instructions});
    await this.checkTools(probe.thread.id);
    // Account metadata can require workspace routing and is not a handshake or
    // thread/tool permission receipt. Read account limits only on explicit demand.
    // Authentication remains owned by Codex; a real auth failure stays a request error.
    this.auth = '账户信息未读取';
    await this.models.refresh(()=>this.isConnected);this.model=(this.initialModel?this.models.require(this.initialModel):this.models.defaultImage()).model;
    // Unavailable experimental modes must not break ordinary chat. A saved mode
    // still requires a complete fresh catalog before its next dispatch.
    if(this.modeSelections)try{await this.modes.refresh(()=>this.isConnected);}catch{}
    this.status = '就绪'; this.changed();
  }
  async newThread(): Promise<void> {
    if (!this.connected) throw new Error('连接已断开，请先手动重连');
    if (this.retired || this.busy || this.operation) throw new Error('当前轮次未结束或连接已停用');
    if(this.modelSelections?.saving||this.modeSelections?.saving)throw Error('模型或模式选择尚在保存，请等待确认');const defaultChoice=this.modelSelections?.default()??this.initialModel;if(defaultChoice)this.models.require(defaultChoice);
    this.compaction=undefined;this.rememberReadWindow();this.navigationIntent++;this.operation = true;
    this.toolCheck = {verified: false, reason: '新线程工具目录待核对', threadId: ''};
    try {
      await checkConfig(this.rpc, this.root);
      if(!this.isConnected)throw Error('新建前连接已失效，未提交');
      const result = await this.rpc.request<'thread/start', ThreadStartResponse>('thread/start', {
        cwd: this.root, model: defaultChoice?.model??this.model, modelProvider: 'openai', sandbox: 'read-only', approvalPolicy: 'untrusted', approvalsReviewer: 'user', developerInstructions: this.instructions,
      });
      if(!this.isConnected)throw Error('新建回执已失效，未接纳或重试');
      if(typeof result.thread?.id!=='string'||!result.thread.id||result.thread.id.length>256||!['legacy','paginated'].includes(result.thread.historyMode)||this.store.read().threads.includes(result.thread.id)||typeof result.cwd!=='string'||typeof result.thread.cwd!=='string'||resolve(result.cwd).toLowerCase()!==resolve(this.root).toLowerCase()||resolve(result.thread.cwd).toLowerCase()!==resolve(this.root).toLowerCase())throw Error('新建线程的身份或工作区回执未核对，未接纳');
      const previous=this.projection.threadId;
      this.store.own(result.thread.id);await this.catalog?.observe(result.thread,false,previous);
      if(defaultChoice)await this.modelSelections!.set(result.thread.id,defaultChoice,()=>this.isConnected);
      this.search.markScopeChanged();
      if(!this.isConnected)throw Error('新建回执已失效，未切换');
      this.projection.snapshot(result.thread);
      if(!result.thread.turns.length)this.projection.metrics.primeNewThread();
      this.history.completeSnapshot(result.thread);
      this.outline.reset(result.thread,this.projection);
      this.rememberPermissions(result);
      await this.checkTools(result.thread.id);
      if(!result.thread.turns.length&&result.thread.status?.type!=='active'&&!this.store.hasAttempts(result.thread.id))this.emptyStarts.set(result.thread.id,structuredClone(result));
      this.needsRecovery = false; this.status = '新线程已建立'; this.error = ''; this.changed();
    } finally { this.operation = false; }
  }
  async restore(id: string): Promise<void> {
    if (!this.connected) throw new Error('连接已断开，请先手动重连');
    if (this.retired || this.busy || this.operation) throw new Error('先停止当前轮次');
    if (!this.store.read().threads.includes(id)) throw new Error('无法恢复非本任务创建的线程');
    this.catalog?.assertUsable(id);
    this.compaction=undefined;
    this.permissionChoices.delete(id);this.permissionRevision++;
    const emptyStart=this.projection.threadId!==id?this.emptyStarts.get(id):undefined;
    this.rememberReadWindow();const readBoundary=this.readWindows.get(id);
    this.emit('queue-pause','正在恢复会话；核对后手动继续本地队列');
    const invalidation=this.historyInvalidation,assertRestore=()=>{if(!this.isConnected||this.projection.threadId!==id||this.historyInvalidation!==invalidation)throw Error('恢复期间线程、连接或历史状态已失效，请重新核对');};
    this.operation = true;
    this.toolCheck = {verified: false, reason: '恢复线程工具目录待核对', threadId: ''};
    this.navigationIntent++;this.history.invalidate('');this.outline.invalidate('');this.projection.clear(id); this.error = ''; this.changed();
    try {
      await checkConfig(this.rpc, this.root);
      assertRestore();
      this.projection.threadId = id;
      this.invalidate('restore-pending-state');
      for (const value of this.store.read().invalidatedApprovals ?? []) if (value.threadId === id) this.invalidatedTurns.add(value.turnId);
      if(emptyStart&&this.emptyStarts.get(id)===emptyStart&&!this.store.hasAttempts(id)&&!(this.store.read().invalidatedApprovals??[]).some(a=>a.threadId===id)){
        await this.checkTools(id);assertRestore();
        if(this.emptyStarts.get(id)!==emptyStart)throw Error('空会话状态已变化，请重新恢复核对');
        this.projection.snapshot(emptyStart.thread);this.history.completeSnapshot(emptyStart.thread);this.outline.reset(emptyStart.thread,this.projection);this.rememberPermissions(emptyStart);
        this.currentTurnId=undefined;this.busy=false;this.canceled=false;this.interrupting.clear();this.needsRecovery=false;this.status='新会话';this.changed();return;
      }
      // Inspect without loading execution. Never resume an unconfirmed formerly-pending tool turn.
      let beforeResume: ThreadReadResponse;
      try {
        beforeResume = await this.readHistory(id,true);
      } catch (e) {
        const data = this.store.read();
        // The pinned server does not persist a never-sent empty thread. Do not
        // resume blindly, fabricate history, delete ownership, or hide failures
        // for a thread with attempts or formerly pending approvals.
        if (e instanceof Error && (e.message === `thread not loaded: ${id}` ||
            e.message === `thread ${id} is not materialized yet; thread/turns/list is unavailable before first user message`) &&
            !this.store.hasAttempts(id) &&
            !(data.invalidatedApprovals ?? []).some(a => a.threadId === id)) {
          this.store.clearSelection(id);
          this.needsRecovery = false;
          this.status = '空会话尚无已保存的Codex历史；草稿可编辑，继续聊天请新建会话';
          this.toolCheck = {verified: false, reason: '空会话未保存；草稿已保留，请新建会话后发送', threadId: id};
          this.history.invalidate('未发送的空会话没有可恢复正文');this.outline.invalidate('空会话没有已保存节点');
          this.changed(); return;
        }
        throw e;
      }
      if (resolve(beforeResume.thread.cwd).toLowerCase() !== resolve(this.root).toLowerCase()) throw new Error('恢复线程的工作区不匹配');
      assertRestore();
      await this.catalog?.observe(beforeResume.thread);
      assertRestore();
      if ([...this.projection.turns.values()].some(t => t.status === 'inProgress' && this.invalidatedTurns.has(t.id))) {
        this.busy = false; this.needsRecovery = true; this.status = this.invalidatedRequestLabel(id)+'已失效，尚未确认旧轮次停止；只能新建测试线程'; this.changed(); return;
      }
      const result = await this.rpc.request<'thread/resume', ThreadResumeResponse>('thread/resume', {threadId: id, cwd: this.root, sandbox: 'read-only', approvalPolicy: 'untrusted', approvalsReviewer: 'user', excludeTurns: beforeResume.thread.historyMode==='paginated'});
      assertRestore();
      if(result.thread.id!==id||resolve(result.thread.cwd).toLowerCase()!==resolve(this.root).toLowerCase())throw Error('恢复回执的线程或工作区未核对');
      this.rememberPermissions(result);
      // Read by public API only. Do not inspect paths or private persisted log formats.
      const read = await this.readHistory(id,false);
      assertRestore();
      if (resolve(read.thread.cwd).toLowerCase() !== resolve(this.root).toLowerCase()) throw new Error('恢复线程的工作区不匹配');
      if(read.thread.status?.type==='active'&&!this.projection.activeTurn())throw Error('服务端仍报告运行，活动回合尚未加载；发送禁用，请稍后恢复核对');
      await this.checkTools(id);
      assertRestore();
      this.approvals.clear(); this.canceled = false; this.interrupting.clear();
      this.busy = !!this.projection.activeTurn();
      this.currentTurnId = this.projection.activeTurn();
      this.needsRecovery = false;
      if (this.currentTurnId && this.invalidatedTurns.has(this.currentTurnId)) {
        const turnId = this.currentTurnId;
        await this.interrupt(turnId);
        await this.waitTerminal(turnId, 2000);
        if (this.projection.turns.get(turnId)?.status === 'inProgress') {
          await this.readHistory(id,false);
        }
        this.busy = !!this.projection.activeTurn(); this.needsRecovery = this.busy;
        if (this.needsRecovery) { this.busy = false; this.status = this.invalidatedRequestLabel(id)+'已失效，尚未确认旧轮次停止；只能新建测试线程'; this.changed(); return; }
      }
      const invalidated = this.store.read().invalidatedApprovals?.some(v => v.threadId === id);
      if (this.projection.turns.size || this.store.hasAttempts(id)) this.store.select(id);
      this.status = invalidated ? '历史已恢复；'+this.invalidatedRequestLabel(id)+'已失效，未自动重发' : this.busy ? '已恢复运行状态；可停止' : this.projection.turns.size && [...this.projection.turns.values()].some(t => t.status === 'interrupted') ? '历史已恢复（中断时未落盘的部分回答可能缺失）' : '历史已恢复'; this.error = ''; this.changed();
    } catch (e) {
      this.needsRecovery = true;
      this.status='会话恢复失败，请核对提示后重试';
      this.toolCheck = {verified: false, reason: '线程恢复失败，发送禁用', threadId: id};
      this.problem(e); throw e;
    } finally { this.operation = false;if(this.projection.threadId===id&&!this.needsRecovery)this.startReadWindow(readBoundary); }
  }
  private rememberReadWindow(){
    const thread=this.projection.threadId,history=this.history.snapshot(this.projection);
    if(!thread||!this.isConnected||this.operation||this.busy||this.needsRecovery||this.approvals.size||this.projection.activeTurn()||history.mode!=='paginated'||history.hasMore===null||history.loading||history.loadingTurn||history.error)return;
    const boundary=[...this.projection.turns.keys()].slice(-READ_WINDOW_TURNS)[0];if(!boundary)return;
    this.readWindows.delete(thread);this.readWindows.set(thread,boundary);while(this.readWindows.size>READ_WINDOW_THREADS)this.readWindows.delete(this.readWindows.keys().next().value!);
  }
  private startReadWindow(boundary:string|undefined){
    if(!boundary){this.rememberReadWindow();return;}
    const thread=this.projection.threadId,generation=this.history.generation,intent=this.navigationIntent,base=this.status;
    const owner=()=>this.isConnected&&this.projection.threadId===thread&&this.history.generation===generation;
    const valid=()=>owner()&&this.navigationIntent===intent&&!this.operation&&!this.busy&&!this.needsRecovery&&!this.approvals.size&&!this.projection.activeTurn();
    if(!valid())return;
    void this.restoreReadWindow(boundary,valid).then(notice=>{if(!valid())return;this.status=base+(notice?'；'+notice:'');this.rememberReadWindow();this.changed();},error=>{
      if(valid()){this.history.error=error instanceof Error?error.message:String(error);this.changed();}
      else if(owner()&&!this.operation&&!this.busy&&!this.needsRecovery&&this.status==='正在重读原阅读窗口（仅当前连接）'){this.status=base+'；原窗口补读已停止；可手动继续';this.changed();}
    });
  }
  private async restoreReadWindow(boundary:string|undefined,current:()=>boolean):Promise<string>{
    if(!boundary||this.history.snapshot(this.projection).mode!=='paginated')return '';
    const generation=this.history.generation,valid=()=>current()&&this.history.generation===generation;
    for(let pages=1;;pages++){
      if(!valid())throw Error('原阅读窗口核对期间身份或历史代次已失效');
      if(this.projection.turns.has(boundary))return '已重读原阅读窗口';
      const history=this.history.snapshot(this.projection);
      if(history.hasMore===false)return '原窗口边界已变化，按当前公开历史恢复';
      if(pages>=READ_WINDOW_PAGES){this.history.error='原窗口尚未到达，已到本批8页上限；可手动继续加载更早历史';return this.history.error;}
      this.status='正在重读原阅读窗口（仅当前连接）';const pending=this.history.older(this.rpc,this.projection,valid);this.changed();let loaded:boolean;
      try{loaded=await pending;}finally{this.changed();}
      if(!loaded){if(!valid())throw Error('原阅读窗口补读回执已失效');return '原窗口补读未完成；可手动重试';}
    }
  }
  get sendOutcomeUncertain(){return this.needsRecovery;}
  /** Metadata selects the public persisted history contract; absence never means legacy. */
  private async readHistory(id:string,fresh:boolean):Promise<ThreadReadResponse>{
    const preferences={...this.historyPreferences()};
    const current=()=>this.isConnected&&this.projection.threadId===id;
    let historyEpoch=this.history.generation;
    const metadata=await this.rpc.request<'thread/read',ThreadReadResponse>('thread/read',{threadId:id,includeTurns:false});
    const checked=(read:ThreadReadResponse)=>{if(!current()||this.history.generation!==historyEpoch||read.thread.id!==id||resolve(read.thread.cwd).toLowerCase()!==resolve(this.root).toLowerCase())throw Error('历史读取的线程、连接、历史代次或工作区身份未核对');};
    checked(metadata);this.history.reset(metadata.thread);historyEpoch=this.history.generation;
    if(metadata.thread.historyMode==='legacy'){
      const revision=this.projection.revision,read=await this.rpc.request<'thread/read',ThreadReadResponse>('thread/read',{threadId:id,includeTurns:true});checked(read);
      if(read.thread.historyMode!=='legacy')throw Error('历史模式在读取期间变化，请恢复核对');
      if(this.projection.revision===revision)this.projection.snapshot(read.thread);else this.projection.prependHistory(read.thread.turns);
      this.history.legacyLoaded();this.outline.reset(read.thread,this.projection);return read;
    }
    if(fresh)this.projection.snapshot({...metadata.thread,turns:[]});
    const loaded=fresh?await this.history.older(this.rpc,this.projection,current):await this.history.initial(this.rpc,this.projection,current,preferences,()=>this.changed(),true);
    if(!loaded)throw Error(this.history.error||'历史分页身份已失效');
    this.outline.reset(metadata.thread,this.projection);
    return metadata;
  }
  async loadOlderHistory(current:()=>boolean=()=>true){
    if(!this.isConnected||this.operation||!this.store.read().threads.includes(this.projection.threadId))throw Error('历史读取身份未就绪');
    const id=this.projection.threadId,pending=this.history.older(this.rpc,this.projection,()=>this.isConnected&&this.projection.threadId===id&&current());this.changed();try{return await pending;}finally{this.changed();}
  }
  async loadTurnItems(turnId:string,current:()=>boolean=()=>true){
    if(!this.isConnected||this.operation||!this.store.read().threads.includes(this.projection.threadId))throw Error('历史读取身份未就绪');
    const id=this.projection.threadId,pending=this.history.items(this.rpc,this.projection,turnId,()=>this.isConnected&&this.projection.threadId===id&&current());this.changed();try{return await pending;}finally{this.changed();}
  }
  async scanOutline(current:()=>boolean=()=>true){
    if(!this.isConnected||this.operation||this.needsRecovery||!this.store.read().threads.includes(this.projection.threadId))throw Error('回合表读取身份未就绪');
    const id=this.projection.threadId,pending=this.outline.scan(this.rpc,this.projection,()=>this.isConnected&&this.projection.threadId===id&&current());this.changed();try{await pending;}finally{this.changed();}
  }
  private searchAvailability(id:string):SearchAvailability{
    if(id===this.managedThreadId)return 'unavailable';
    const item=this.catalog?.get(id);
    if(this.catalog&&(!item?.observed||item.deleted||item.pending))return 'unavailable';
    return (this.archiveNotifications.get(id)??item?.archived)?'archived':'active';
  }
  async searchHistory(query:string,scope:'thread'|'workspace',includeTools:boolean,requestId:number,current:()=>boolean){
    if(!this.isConnected||this.operation)throw Error('搜索连接或会话尚未就绪');
    const owned=this.store.read().threads.filter(id=>this.searchAvailability(id)!=='unavailable'),threads=scope==='workspace'?owned:owned.includes(this.projection.threadId)&&this.searchAvailability(this.projection.threadId)==='active'?[this.projection.threadId]:[];
    this.search.start(query,threads,scope,includeTools,()=>this.isConnected&&current(),requestId);const epoch=this.search.generation;this.changed();
    while(this.search.generation===epoch&&this.search.snapshot().hasMore){await this.search.runBatch();this.changed();await new Promise<void>(resolve=>setImmediate(resolve));}
  }
  cancelSearch(requestId?:number){const search=this.search.snapshot();if(search.hasMore&&(requestId===undefined||requestId===search.requestId)){this.search.cancel();this.changed();}}
  cancelNavigation(){this.navigationIntent++;}
  async materialize(turnId:string,itemId:string|undefined,current:()=>boolean){
    if(!turnId||turnId.length>256||itemId!==undefined&&(!itemId||itemId.length>256))throw Error('导航目标身份无效');
    if(!this.isConnected||this.operation||this.needsRecovery||!this.store.read().threads.includes(this.projection.threadId))throw Error('导航身份或恢复状态未就绪');
    this.catalog?.assertUsable(this.projection.threadId);
    const id=this.projection.threadId,intent=++this.navigationIntent,valid=()=>this.isConnected&&this.projection.threadId===id&&intent===this.navigationIntent&&current();
    for(let pages=0;pages<8;pages++){
      if(!valid())return{status:'cancelled' as const};
      const row=itemId?this.projection.items.get(itemId):[...this.projection.items.values()].find(row=>row.turnId===turnId&&row.item.type!=='reasoning');
      if(row&&row.turnId===turnId&&row.item.type!=='reasoning')return{status:'loaded' as const,itemId:row.item.id};
      if(this.history.loading||this.history.loadingTurn)return{status:'waiting' as const};
      const turn=this.projection.turns.get(turnId);
      if(turn){
        if(turn.itemsView==='full'||turn.status==='inProgress')return{status:'unavailable' as const,reason:'目标消息不在当前公开回合正文中'};
        const loaded=await this.loadTurnItems(turnId,valid);if(!valid())return{status:'cancelled' as const};if(!loaded)return{status:'unavailable' as const,reason:this.history.error||'回合正文暂不可用'};
      }else{
        if(this.history.snapshot(this.projection).hasMore===false)return{status:'unavailable' as const,reason:'已核对公开历史，未找到目标回合'};
        const loaded=await this.loadOlderHistory(valid);if(!valid())return{status:'cancelled' as const};if(!loaded)return{status:'unavailable' as const,reason:this.history.error||'历史分页暂不可用'};
      }
    }
    if(!valid())return{status:'cancelled' as const};
    const reached=itemId?this.projection.items.get(itemId):[...this.projection.items.values()].find(row=>row.turnId===turnId&&row.item.type!=='reasoning');
    return reached?.turnId===turnId&&reached.item.type!=='reasoning'?{status:'loaded' as const,itemId:reached.item.id}:{status:'more' as const,reason:'已读取本批历史，目标尚未到达；可继续定位'};
  }
  get isConnected(){return this.connected&&!this.retired;}
  get isOperating(){return this.operation;}
  get steerableTurnId(){return this.isConnected&&this.busy&&!this.operation&&!this.pendingStart&&!this.canceled&&!this.needsRecovery&&!this.approvals.size&&!this.waitingForUserInput&&this.toolCheck.verified&&this.toolCheck.threadId===this.projection.threadId?this.projection.activeTurn():undefined;}
  get isStarting(){return this.pendingStart;}
  private compactionReason():string{
    const id=this.projection.threadId;
    if(!this.isConnected)return '请先连接 Codex';
    if(!id||!this.store.read().threads.includes(id))return '请先选择本任务会话';
    if(this.needsRecovery)return '请先恢复并核对会话状态';
    if(this.busy||this.operation||this.pendingStart||this.projection.activeTurn()||this.approvals.size||this.waitingForUserInput)return '请先结束当前回合或操作';
    if(this.modelSelections?.saving||this.modeSelections?.saving)return '请等待模型或模式选择保存';
    if(!this.projection.turns.size)return '当前会话尚无可压缩的公开历史';
    if(!this.toolCheck.verified||this.toolCheck.threadId!==id)return '压缩前工具目录尚未核对';
    try{this.catalog?.assertUsable(id);}catch(error){return error instanceof Error?error.message:'会话状态待核对';}
    return this.store.dispatchReason('compact');
  }
  compactionView():CompactionView{
    const reason=this.compactionReason(),value=this.compaction;
    return value?.threadId===this.projection.threadId?value.view(reason):{reason:reason||'压缩当前会话上下文；保留草稿并暂停本地队列',canStart:!reason,active:false};
  }
  private syncCompaction(value:ManualCompaction){
    if(this.compaction!==value)return;
    if(value.attempt){
      if(value.turnId)this.turnAttempts.set(value.turnId,value.attempt);
      const usage=value.turnId?this.projection.metrics.forTurn(this.projection.turns.get(value.turnId),true)?.tokenUsage:undefined;
      this.store.record(value.attempt,{...(value.turnId?{turnId:value.turnId}:{}),status:['completed','interrupted','failed'].includes(value.phase)?value.phase:'compact:'+value.phase,...(usage?{usage}:{})});
    }
    if(value.phase==='unknown'){this.needsRecovery=true;this.toolCheck={verified:false,threadId:value.threadId,reason:'压缩结果未确认，请恢复核对'};}
    if(this.compactionLock===value){
      this.status=value.label;
      if(value.phase==='canceled'&&this.compactionCheck?.value===value&&this.isConnected)this.toolCheck=this.compactionCheck.previous;
      if(!value.active){this.compactionLock=undefined;this.busy=false;this.operation=false;}
    }
    this.changed();
  }
  private abandonCompaction(reason:string){const value=this.compaction;if(!value?.active)return;value.abandon(reason);this.syncCompaction(value);}
  /** Explicit model dispatch, separately reserved; no draft, attachment, model-choice or permission mutation. */
  async compact(current:()=>boolean=()=>true):Promise<void>{
    const reason=this.compactionReason();if(reason)throw Error(reason);if(!current())throw Error('压缩页面已失效，未提交');
    const thread=this.projection.threadId,value=new ManualCompaction(thread);
    this.compaction=value;this.compactionLock=value;this.compactionCheck={value,previous:this.toolCheck};this.operation=true;this.busy=true;this.canceled=false;this.error='';this.navigationIntent++;
    this.emit('queue-pause','手动压缩上下文；核对后手动继续本地队列');this.syncCompaction(value);
    const live=()=>this.compaction===value&&this.isConnected&&this.projection.threadId===thread;
    const beforeDispatch=()=>live()&&value.phase==='preparing'&&!this.needsRecovery&&!this.projection.activeTurn()&&current();
    try{
      await this.checkTools(thread,beforeDispatch);
      if(!beforeDispatch()){if(live()&&value.phase==='preparing'){value.stop();this.syncCompaction(value);}return;}
      value.submit(this.store.reserve(thread,'compact'),this.projection.turns.keys());this.syncCompaction(value);
      const result=await this.rpc.request('thread/compact/start',{threadId:thread});
      // Once submitted, the Session owns the operation across page replacement. A stale receipt cannot release a newer operation.
      if(!live())return;
      if(!result||typeof result!=='object'||Array.isArray(result)||Object.keys(result).length)throw Error('压缩受理回执格式未核对');
      value.accept();this.syncCompaction(value);
    }catch(error){
      if(!live()||value.phase==='canceled')return;
      if(['completed','interrupted','failed'].includes(value.phase))return;
      if(value.phase==='preparing'&&!beforeDispatch()){value.stop();this.syncCompaction(value);return;}
      value.reject(error instanceof Error?error.message:String(error),!value.submitted||error instanceof RpcRequestRejected);
      this.syncCompaction(value);throw error;
    }
  }
  async refreshThreads(options:{more?:boolean;archived?:boolean;query?:string}={},current:()=>boolean=()=>true){
    if(!this.catalog||!this.isConnected)throw Error('会话目录未连接');
    const pending=this.catalog.list(this.rpc,this.root,()=>this.store.read().threads,()=>this.isConnected&&current(),options);
    this.changed();try{await pending;}finally{this.search.markScopeChanged();this.changed();}
  }
  async manageThread(kind:ThreadMutation,id:string,current:()=>boolean,name?:string){
    if(!this.catalog||!this.isConnected||this.operation||this.busy||this.compaction?.phase==='unknown'||this.approvals.size||this.projection.activeTurn())throw Error('请先结束当前操作，再管理会话');
    if(!this.store.read().threads.includes(id))throw Error('只能管理本任务拥有的会话');
    const source=this.projection.threadId,valid=()=>this.isConnected&&this.projection.threadId===source&&current();
    this.navigationIntent++;this.operation=true;this.managedThreadId=id;this.search.availabilityChanged();this.changed();
    try{
      let read:ThreadReadResponse|undefined,missing=false,localOnly=false;
      const noAttempts=()=>!this.store.hasAttempts(id)&&!(this.store.read().invalidatedApprovals??[]).some(a=>a.threadId===id);
      try{read=await this.rpc.request<'thread/read',ThreadReadResponse>('thread/read',{threadId:id,includeTurns:false});}
      catch(error){if(!(error instanceof RpcRequestRejected)||error.message!==`thread not loaded: ${id}`||!noAttempts())throw error;missing=true;}
      if(!valid()||read&&(read.thread.id!==id||resolve(read.thread.cwd).toLowerCase()!==resolve(this.root).toLowerCase()))throw Error('会话管理身份或工作区未核对');
      if(read?.thread.status?.type==='active')throw Error('该会话仍在运行，操作未提交');
      if(read&&this.catalog.get(id)?.localOnly)await this.catalog.observe(read.thread,this.catalog.get(id)!.archived);
      this.search.markStale(id);
      if(kind==='archive'||kind==='delete'){this.readWindows.delete(id);this.emptyStarts.delete(id);}
      if(kind==='unarchive')this.search.markScopeChanged();
      if(missing&&this.catalog.get(id)?.localOnly&&(kind==='unarchive'||kind==='rename')){await this.catalog.mutateEmpty(id,kind,()=>valid()&&noAttempts(),name);localOnly=true;}
      else try{await this.catalog.mutate(this.rpc,this.root,id,kind,valid,name);}
      catch(error){if(!missing||!['archive','delete'].includes(kind)||!(error instanceof RpcRequestRejected)||error.message!==`no rollout found for thread id ${id}`||!noAttempts())throw error;await this.catalog.mutateEmpty(id,kind,()=>valid()&&noAttempts(),name);localOnly=true;}
      if(kind!=='delete'&&this.catalog.get(id)?.deleted)throw Error('会话已永久删除，原操作不再适用');
      if(kind==='delete'){this.search.forget(id);await this.search.discardCache(id);}
      else this.search.availabilityChanged();
      if(!valid())throw Error('会话操作回执已失效');
      if((kind==='archive'||kind==='delete')&&id===source){this.store.clearSelection(id);this.projection.clear();this.needsRecovery=false;this.currentTurnId=undefined;this.toolCheck={verified:false,threadId:'',reason:'请选择会话或新建'};}
      this.error='';this.status=localOnly?kind==='archive'?'无已存历史的空会话已移入本地回收站；草稿保留':kind==='delete'?'无已存历史的空会话本地记录已移除':kind==='rename'?'空会话已在本地重命名':'空会话草稿已恢复；继续聊天请新建会话':kind==='rename'?'会话已重命名':kind==='archive'?'会话已移入回收站（Codex归档）':kind==='delete'?'会话历史已永久删除':'会话已恢复；尚未发送';
    }finally{
      if(this.catalog.get(id)?.deleted&&this.projection.threadId===id){this.store.clearSelection(id);this.projection.clear();this.needsRecovery=false;this.currentTurnId=undefined;this.toolCheck={verified:false,threadId:'',reason:'请选择会话或新建'};}
      this.managedThreadId='';this.operation=false;this.search.availabilityChanged();this.changed();
    }
  }
  revertReason(turnId:string,itemId:string):string {
    if(this.history.snapshot(this.projection).mode!=='paginated')return '仅支持分页会话的对话回退';
    if(this.waitingForUserInput||this.pendingStart)return '请先完成当前请求';
    if(!this.store.read().threads.includes(this.projection.threadId))return '只能回退本任务会话';
    return this.forkReason(turnId,itemId);
  }
  /** No file rollback, draft replacement, queue drain or model dispatch. */
  async revertTurn(turnId:string,itemId:string,current:()=>boolean,protect:()=>Promise<void>,confirm:(preview:RevertPreview)=>Promise<boolean>):Promise<boolean>{
    const reason=this.revertReason(turnId,itemId);if(reason)throw Error(reason);
    const thread=this.projection.threadId,revision=this.projection.revision,invalidation=this.historyInvalidation;
    const cancellation=++this.cancelVersion;
    let submitted=false,acknowledged=false;
    const owned=()=>this.isConnected&&this.projection.threadId===thread&&!this.deletedNotifications.has(thread)&&!this.revertConflict;
    const preparing=()=>owned()&&current()&&cancellation===this.cancelVersion&&invalidation===this.historyInvalidation&&revision===this.projection.revision&&!this.needsRecovery&&!this.busy&&!this.pendingStart&&!this.approvals.size&&!this.waitingForUserInput&&!this.projection.activeTurn();
    const check=()=>{if(!preparing())throw Error('回退准备已取消或历史已变化，未提交');};
    this.operation=true;this.reverting='preparing';this.revertConflict=false;this.navigationIntent++;this.status='正在核对回退范围，草稿保留';this.changed();
    try{
      await protect();check();this.catalog?.assertUsable(thread);
      const range=await readRevertRange(this.rpc,this.root,thread,turnId,itemId,preparing);
      if(!await confirm(range.preview)){this.status='已取消回退，草稿和附件保留';return false;}check();
      await protect();check();
      const again=await readRevertRange(this.rpc,this.root,thread,turnId,itemId,preparing);
      if(again.fingerprint!==range.fingerprint)throw Error('确认期间对话历史已变化，请重新选择回退范围');
      await this.retention?.retain(thread,range.turns.flatMap(turn=>turn.items.flatMap(item=>item.type==='userMessage'?item.content.flatMap(input=>input.type==='localImage'?[input.path]:[]):[])));check();
      submitted=true;this.reverting='submitted';this.status='正在回退对话，等待回执；草稿和附件保留';this.changed();
      const result=await this.rpc.request<'thread/revert',ThreadRevertResponse>('thread/revert',{threadId:thread,beforeTurnId:turnId});
      acknowledged=true;
      if(!owned())throw Error('回退回执身份已失效');assertRevertThread(result?.thread,thread,this.root);
      const cursor=(value:unknown)=>value===null||typeof value==='string'&&!!value;
      if(!Array.isArray(result.thread.turns)||result.thread.turns.length||!cursor(result.turnsBackwardsCursor)||!cursor(result.itemsBackwardsCursor))throw Error('回退回执格式未核对');
      for(const turn of range.turns)this.revertedTurns.add(turn.id);
      this.historyInvalidation++;this.navigationIntent++;this.readWindows.delete(thread);this.emptyStarts.delete(thread);
      this.history.invalidate('回退后正在重新读取历史');this.outline.invalidate('回退后回合表已失效');this.search.markStale(thread);
      const epoch=this.historyInvalidation,valid=()=>owned()&&this.historyInvalidation===epoch;
      this.needsRecovery=true;this.toolCheck={verified:false,threadId:thread,reason:'回退后正在重新核对历史与工具'};
      await this.search.discardCache(thread);if(!valid())throw Error('回退后的历史核对已失效');
      this.projection.clear(thread);
      const read=await this.readHistory(thread,false);if(!valid())throw Error('回退后的历史读取已失效');assertRevertThread(read.thread,thread,this.root);
      if(range.turns.some(turn=>this.projection.turns.has(turn.id)))throw Error('回退后仍读到已移除回合，请恢复核对');
      await this.checkTools(thread,valid);if(!valid())throw Error('回退后的工具核对已失效');
      await this.catalog?.observe(read.thread,false);if(!valid())throw Error('回退后的目录保存已失效');
      this.currentTurnId=undefined;this.busy=false;this.canceled=false;this.needsRecovery=false;this.error='';
      this.status='对话已回退；草稿和附件保留，本地队列已暂停，磁盘文件未回退';return true;
    }catch(error){
      const unknown=submitted&&(acknowledged||!(error instanceof RpcRequestRejected)||this.historyInvalidation!==invalidation);
      if(unknown){this.needsRecovery=true;this.toolCheck={verified:false,threadId:thread,reason:'回退结果待核对，请恢复会话'};this.history.invalidate('回退结果待核对；旧正文仅供查看');this.outline.invalidate('回退结果待核对');this.search.markStale(thread);this.emit('queue-pause','回退结果待核对，未自动重试');}
      this.error=error instanceof Error?error.message:String(error);this.status=unknown?'回退结果未确认，请恢复核对；草稿保留，未自动重试':'回退未执行；草稿和附件保留';throw error;
    }finally{this.reverting=undefined;this.operation=false;this.changed();}
  }
  forkReason(turnId:string,itemId:string):string {
    if(this.modelSelections?.saving||this.modeSelections?.saving)return '模型或模式选择尚在保存，请等待确认';
    if(this.retired||!this.connected||this.busy||this.operation||this.needsRecovery||this.approvals.size||this.projection.activeTurn())return '请先结束当前操作并核对恢复状态';
    if(!this.toolCheck.verified||this.toolCheck.threadId!==this.projection.threadId)return '实例工具尚未核对，分支禁用';
    const row=this.projection.items.get(itemId),turn=this.projection.turns.get(turnId);
    return row?.turnId===turnId&&row.complete&&row.item.type==='agentMessage'&&turn?.status==='completed'?'':'仅可从已完成回合的助手回复创建分支';
  }
  /** Official turn-boundary fork; never starts a turn or inherits a pending approval. */
  async forkTurn(turnId:string,itemId:string):Promise<string>{
    const reason=this.forkReason(turnId,itemId);if(reason)throw Error(reason);if(!this.store.read().threads.includes(this.projection.threadId))throw Error('只能对本任务线程创建分支');
    const source=this.projection.threadId,expected=[...this.projection.turns.keys()].slice(0,[...this.projection.turns.keys()].indexOf(turnId)+1);
    this.rememberReadWindow();this.navigationIntent++;this.operation=true;this.status='正在创建此回合的分支';this.changed();let requested=false,forkToken:string|undefined;
    try{
      await checkConfig(this.rpc,this.root);
      if(this.retired||!this.connected||this.projection.threadId!==source||this.busy||this.needsRecovery||this.approvals.size||this.projection.activeTurn())throw Error('分支身份或当前状态已失效');
      forkToken=await this.retention?.beginFork(source);
      if(this.retired||!this.connected||this.projection.threadId!==source||this.busy||this.needsRecovery||this.approvals.size||this.projection.activeTurn())throw Error('分支留存期间身份或当前状态已失效');
      const sourceChoice=this.modelSelections?.read(source),sourceMode=this.modeSelections?.read(source);if(sourceChoice)this.models.require(sourceChoice);
      requested=true;
      const result=await this.rpc.request<'thread/fork',ThreadForkResponse>('thread/fork',{threadId:source,lastTurnId:turnId,cwd:this.root,...(!this.modelSelections?{model:this.model}:{}),modelProvider:'openai',sandbox:'read-only',approvalPolicy:'untrusted',approvalsReviewer:'user',developerInstructions:this.instructions,excludeTurns:false});
      if(this.retired||!this.connected||this.projection.threadId!==source||this.busy||this.needsRecovery||this.approvals.size||this.projection.activeTurn())throw Error('分支回执已失效，未切换或重发');
      const thread=result.thread;
      if(result.modelProvider!=='openai'||resolve(result.cwd).toLowerCase()!==resolve(this.root).toLowerCase()||result.approvalPolicy!=='untrusted'||result.approvalsReviewer!=='user'||result.sandbox.type!=='readOnly'||result.sandbox.networkAccess!==false)throw Error('分支权限与受限实例不一致，未切换');
      if(!thread.id||thread.id===source||resolve(thread.cwd).toLowerCase()!==resolve(this.root).toLowerCase()||thread.forkedFromId!==source||thread.turns.some(t=>t.status==='inProgress')||JSON.stringify(thread.turns.map(t=>t.id))!==JSON.stringify(expected))throw Error('分支历史或工作区未核对，未切换或自动重试');
      this.store.own(thread.id);await this.retention?.finishFork(forkToken,thread.id);await this.fileSources?.fork(source,thread.id,thread.turns.flatMap(turn=>turn.items.map(item=>({turnId:turn.id,item}))));await this.checkTools(thread.id);
      if(sourceChoice)await this.modelSelections!.set(thread.id,sourceChoice,()=>this.isConnected&&this.projection.threadId===source);
      if(sourceMode!==undefined)await this.modeSelections!.set(thread.id,sourceMode,()=>this.isConnected&&this.projection.threadId===source);
      this.search.markScopeChanged();
      if(this.retired||!this.connected||this.projection.threadId!==source)throw Error('分支核对期间身份已失效');
      await this.catalog?.observe(thread,false,source);
      if(this.retired||!this.connected||this.projection.threadId!==source)throw Error('分支保存期间身份已失效，未切换');
      this.store.select(thread.id);this.projection.snapshot(thread);this.history.completeSnapshot(thread);this.outline.reset(thread,this.projection);this.rememberPermissions(result);this.currentTurnId=undefined;this.canceled=false;this.needsRecovery=false;this.error='';this.status='已从此回合创建分支；原线程与草稿保留，未自动发送';return thread.id;
    }catch(e){let cleanup='';if(requested)this.needsRecovery=true;else try{await this.retention?.cancelFork(forkToken);}catch{cleanup='；附件临时留存撤销未确认，原文件仍保留';}this.error=(e instanceof Error?e.message:String(e))+cleanup;this.toolCheck={verified:false,reason:'分支未完成核对，请先恢复并重新核对实例状态',threadId:source};this.status=requested?'分支结果未确认；未自动重试，请先核对恢复状态':'分支未创建';throw e;}
    finally{this.operation=false;}
  }
  private readDocuments(files:DraftFile[],controller:AbortController):DocumentReader|false{
    if(!this.documentText)return false;
    const reader=createDocumentReader(controller.signal),checked=new Set<string>();
    return async(file,bytes)=>{
      if(!checked.has(file.path)){checked.add(file.path);this.status=`正在读取文档 ${checked.size}/${files.length}：${file.name}`;this.changed();}
      return reader(file,bytes);
    };
  }
  async send(text: string, image?: string, files:DraftFile[]=[],extraImages:{path:string}[]=[],canDispatch:()=>boolean=()=>true,imageProofs?:ImageProof[],skill?:SkillReference,providedClientId?:string): Promise<boolean> {
    if(providedClientId!==undefined&&!validClientMessageId(providedClientId))throw Error('消息标识无效，未提交');
    const blocked=this.store.dispatchReason();if(blocked)throw Error(blocked);
    if (this.retired || !this.connected || this.busy || this.operation || this.needsRecovery) throw new Error('当前无法开始新轮次，请先恢复');
    if (!this.projection.threadId) throw new Error('请先新建线程');
    this.catalog?.assertUsable(this.projection.threadId);
    if ((!text.trim()&&!image&&!extraImages.length&&!files.length) || text.length > 20_000) throw new Error('请输入文本或附加图片/文件；文本最多20000字符');
    if (!this.toolCheck.verified || this.toolCheck.threadId !== this.projection.threadId) throw new Error(`发送已禁用：${this.toolCheck.reason}`);
    if(skill){if(!validSkillReference(skill))throw Error('技能选择格式无效');this.skills.require(skill);skillPrompt(text,skill);}
    const skillGeneration=this.skills.snapshot().generation,thread=this.projection.threadId,modelChoice=this.nextModelRequest(!!image||!!extraImages.length),modeChoice=this.nextModeRequest(modelChoice),modeRevision=this.modeSelections?.revision,modeGeneration=this.modes.snapshot().generation,modelRevision=this.modelSelections?.revision,modelGeneration=this.models.snapshot().generation,permission=this.permissionChoices.get(thread)??'read-only',permissionRevision=this.permissionRevision;
    if(permission!=='read-only')this.permissions.require(permission);const requestedPermissions=permissionRequest(permission,this.root),current=()=>canDispatch()&&!this.canceled&&!this.retired&&!this.needsRecovery&&this.connected&&this.projection.threadId===thread&&this.permissionRevision===permissionRevision&&(!skill||this.skills.snapshot().generation===skillGeneration)&&!this.modeSelections?.saving&&!this.modeSelections?.error()&&this.modeSelections?.revision===modeRevision&&this.modes.snapshot().generation===modeGeneration&&!this.modelSelections?.saving&&!this.modelSelections?.error()&&this.modelSelections?.revision===modelRevision&&this.models.snapshot().generation===modelGeneration;
    if(!canDispatch())throw Error('发送页面或队列身份已失效，未提交');
    const preparation=new AbortController(),readDocuments=this.readDocuments(files,preparation);this.documentPreparation=preparation;
    this.navigationIntent++;this.busy = true; this.canceled = false; this.error = ''; this.status = '准备发送'; this.changed();
    this.attempt = undefined;
    this.currentTurnId = undefined;
    const clientUserMessageId=providedClientId??randomUUID();let sourceId:string|undefined,requested=false,rejected=false;
    try {
      const inputs=async()=>{const source=await this.skills.input(skill,text,current);return [...source.prefix,...await attachmentInputs(this.root,source.text,image,files,extraImages,imageProofs,readDocuments)];};let input=await inputs();
      if (!current()) { this.busy = false; this.status = '已取消准备'; return false; }
      await this.checkTools(this.projection.threadId);
      if (!current()) { this.busy = false; this.status = '已取消准备'; return false; }
      await this.retention?.retain(thread,[...(image?[image]:[]),...extraImages.map(value=>value.path),...files.map(value=>value.path)]);
      if (!current()) { this.busy = false; this.status = '已取消准备'; return false; }
      sourceId=await this.fileSources?.prepare(thread,input,files,undefined,clientUserMessageId);
      if (!current()) { this.busy = false; this.status = '已取消准备'; return false; }
      if(skill||image||extraImages.length||files.length)input=await inputs();
      if (!current()) { this.busy = false; this.status = '已取消准备'; return false; }
      this.fileSources?.verify(thread,sourceId,input);
      if(modelChoice)this.models.require(modelChoice);
      if(modeChoice)this.modes.require(modeChoice.mode);
      this.attempt = this.store.reserve(this.projection.threadId, image||extraImages.length ? 'image' : 'text/tool');
      if(this.emptyStarts.delete(thread))this.search.markStale(thread);
      this.pendingStart = true;
      if(modelChoice)this.submittedModel={threadId:thread,choice:{...modelChoice},outcome:'unknown'};
      this.submittedPermission={threadId:thread,preset:permission,outcome:'unknown'};
      requested=true;const result = await this.rpc.request<'turn/start', TurnStartResponse>('turn/start', {threadId: this.projection.threadId, input,...(clientUserMessageId?{clientUserMessageId}:{}),...(modelChoice?{model:modelChoice.model,effort:modelChoice.effort,...(modelChoice.serviceTier!==undefined?{serviceTierForTurn:modelChoice.serviceTier}:{})}:{}),...(modeChoice?{collaborationMode:modeChoice}:{}), cwd: this.root,...requestedPermissions});
      if(!this.isConnected||typeof result?.turn?.id!=='string'||!result.turn.id)throw Error('发送回执身份未核对，结果未知');
      // The receipt still accounts for the submitted attempt, but cannot recreate
      // a publicly deleted turn or interrupt a different/empty selection.
      if(this.deletedNotifications.has(thread)){this.store.record(this.attempt,{turnId:result.turn.id,status:'threadDeleted'});return true;}
      this.currentTurnId = result.turn.id;
      if(modelChoice)this.submittedModel={threadId:thread,turnId:result.turn.id,choice:{...modelChoice},outcome:'accepted'};
      this.submittedPermission={threadId:thread,preset:permission,outcome:'accepted'};
      this.turnAttempts.set(result.turn.id, this.attempt);
      this.store.record(this.attempt, {turnId: result.turn.id});
      // Notification may complete before the response. Never overwrite a terminal state.
      if (!this.projection.turns.has(result.turn.id)) this.projection.turns.set(result.turn.id, result.turn);
      const earlyUsage=this.projection.metrics.forTurn(this.projection.turns.get(result.turn.id),true)?.tokenUsage;if(earlyUsage)this.store.record(this.attempt,{usage:earlyUsage});
      if (this.projection.turns.get(result.turn.id)?.status === 'inProgress') {
        this.busy=true;
        this.status = this.canceled ? '正在停止' : this.waitingForUserInput?'等待回答':this.approvals.size?'等待审批':'生成中';
        if (this.canceled) await this.interrupt(result.turn.id);
      } else {this.busy=false;const terminal=this.projection.turns.get(result.turn.id)!;this.status=terminal.status;this.store.record(this.attempt,{status:terminal.status});this.emit('queue-terminal',{threadId:this.projection.threadId,turnId:terminal.id,status:terminal.status,canceled:this.canceled});}
      return true;
    } catch (e) {
      if(this.canceled&&!this.attempt&&!requested){this.busy=false;this.status='已取消准备，草稿和附件保留';return false;}
      rejected=e instanceof RpcRequestRejected;
      if(requested&&modelChoice&&rejected)this.submittedModel={threadId:thread,choice:{...modelChoice},outcome:'rejected'};
      if(requested&&rejected)this.submittedPermission={threadId:thread,preset:permission,outcome:'rejected'};
      if (this.attempt) this.store.record(this.attempt, {status: rejected?'requestRejected':'requestFailedOrDisconnected'});
      // Do not claim idle after an ambiguous turn-start failure. Require public recovery.
      this.needsRecovery = this.needsRecovery||!!this.attempt&&!rejected; this.busy = false; this.status = this.needsRecovery?'发送失败，请恢复后重试':'未发送，草稿保留；请检查提示'; this.problem(e); throw e;
    } finally {
      if(this.deletedNotifications.has(thread))this.busy=true;
      preparation.abort();if(!requested||rejected)try{await this.fileSources?.drop(thread,sourceId);}catch{/* Source record remains protected and visibly unavailable until reread. */}
      if(this.documentPreparation===preparation)this.documentPreparation=undefined;
      this.pendingStart=false;if(this.deletedNotifications.has(thread)){this.busy=false;this.needsRecovery=false;this.status='会话历史已永久删除';}this.changed();
    }
  }
  /** Public steer targets the existing turn. Its dispatch consumes an attempt but does not duplicate turn usage. */
  async steer(text:string,image?:string,files:DraftFile[]=[],extraImages:{path:string}[]=[],expectedTurnId?:string,canDispatch:()=>boolean=()=>true,imageProofs?:ImageProof[],skill?:SkillReference):Promise<boolean>{
    const blocked=this.store.dispatchReason('steer');if(blocked)throw Error(blocked);
    const thread=this.projection.threadId,turn=this.projection.activeTurn(),skillGeneration=this.skills.snapshot().generation;
    const current=()=>canDispatch()&&this.isConnected&&this.projection.threadId===thread&&this.projection.activeTurn()===turn&&(!skill||this.skills.snapshot().generation===skillGeneration)&&this.busy&&!this.canceled&&!this.needsRecovery&&!this.approvals.size&&!this.waitingForUserInput;
    if(this.operation||this.pendingStart||!turn||turn!==expectedTurnId||!current())throw Error('当前没有可插话的已确认活动回合，或正在等待审批/停止/恢复');
    this.catalog?.assertUsable(thread);
    if((!text.trim()&&!image&&!extraImages.length&&!files.length)||text.length>20000)throw Error('插话文本、图片或文件无效；文本最多20000字符');
    if(!this.toolCheck.verified||this.toolCheck.threadId!==thread)throw Error('插话前工具目录尚未核对');
    if(skill){if(!validSkillReference(skill))throw Error('技能选择格式无效');this.skills.require(skill);skillPrompt(text,skill);}
    if((image||extraImages.length)&&this.modelSelections){const activeModel=this.submittedModel?.threadId===thread&&this.submittedModel.turnId===turn?this.submittedModel.choice.model:this.model;if(!this.models.require({model:activeModel}).inputModalities.includes('image'))throw Error('当前活动回合模型未声明图片输入；下一轮选择不改变本轮插话能力');}
    const preparation=new AbortController(),readDocuments=this.readDocuments(files,preparation);this.documentPreparation=preparation;
    this.operation=true;this.changed();let attempt:string|undefined,clientUserMessageId:string|undefined,requested=false,rejected=false;
    try{
      const inputs=async()=>{const source=await this.skills.input(skill,text,current);return [...source.prefix,...await attachmentInputs(this.root,source.text,image,files,extraImages,imageProofs,readDocuments)];};let input=await inputs();if(!current())throw Error('插话准备期间活动回合已变化，未提交');
      await this.checkTools(thread);if(!current())throw Error('插话核对期间活动回合已变化，未提交');
      await this.retention?.retain(thread,[...(image?[image]:[]),...extraImages.map(value=>value.path),...files.map(value=>value.path)]);if(!current())throw Error('插话留存期间活动回合已变化，未提交');
      clientUserMessageId=await this.fileSources?.prepare(thread,input,files,turn);if(!current())throw Error('插话来源保存期间活动回合已变化，未提交');
      if(skill||image||extraImages.length||files.length)input=await inputs();
      if(!current())throw Error('插话附件复核期间活动回合已变化，未提交');
      this.fileSources?.verify(thread,clientUserMessageId,input);
      attempt=this.store.reserve(thread,'steer (usage included in original turn)');
      requested=true;const result=await this.rpc.request<'turn/steer',TurnSteerResponse>('turn/steer',{threadId:thread,expectedTurnId:turn,input,...(clientUserMessageId?{clientUserMessageId}:{})});
      if(!this.isConnected||result?.turnId!==turn)throw Error('插话回执回合未核对，结果未知');
      this.store.record(attempt,{turnId:turn,status:'steerAccepted'});if(this.projection.activeTurn()===turn)this.status='插话已受理，仍在当前回合';return true;
    }catch(error){rejected=error instanceof RpcRequestRejected;if(attempt){this.store.record(attempt,{turnId:turn,status:rejected?'steerRejected':'steerOutcomeUnknown'});if(!rejected){this.needsRecovery=true;this.emit('queue-pause','插话结果未知；请先核对历史，未自动重发');}}this.problem(error);throw error;}
    finally{preparation.abort();if(!requested||rejected)try{await this.fileSources?.drop(thread,clientUserMessageId);}catch{/* Do not drop uncertain persisted provenance or replay the request. */}if(this.documentPreparation===preparation)this.documentPreparation=undefined;this.operation=false;if(this.deletedNotifications.has(thread)){this.busy=false;this.needsRecovery=false;this.status='会话历史已永久删除';}this.changed();}
  }
  private async checkTools(threadId: string,current:()=>boolean=()=>true): Promise<void> {
    this.toolCheck = {verified: false, reason: '正在核对实际配置与工具目录', threadId}; this.changed();
    try {
      const checked = await verifyTools(this.rpc, this.root, threadId);
      if(!current())throw Error('工具核对来源已失效');
      if (this.retired || !this.connected) throw new Error('核对期间连接已失效');
      this.toolCheck = checked;
    } catch (e) {
      if(!current())throw e;
      this.toolCheck = {verified: false, reason: e instanceof Error ? e.message : String(e), threadId};
      this.problem(e); throw e;
    } finally { this.changed(); }
  }
  private refreshTitle(threadId:string,turnId:string){
    if(!this.catalog||this.titleTurn===turnId)return;this.titleTurn=turnId;
    const before=this.catalog.get(threadId);
    // The server may update preview without emitting thread/name/updated.
    // Read metadata once, never generate a title with a model or fetch bodies.
    void this.rpc.request<'thread/read',ThreadReadResponse>('thread/read',{threadId,includeTurns:false}).then(async read=>{
      if(!this.isConnected||read.thread.id!==threadId||resolve(read.thread.cwd).toLowerCase()!==resolve(this.root).toLowerCase()||!this.store.read().threads.includes(threadId))return;
      const current=this.catalog!.get(threadId);if(current?.deleted||current?.pending||current?.title!==before?.title)return;
      await this.catalog!.observe(read.thread,current?.archived??false);this.changed();
    }).catch(error=>{if(this.isConnected)this.emit('evidence',{method:'local/title-refresh-failed',params:{threadId,reason:error instanceof Error?error.message:String(error)}});});
  }
  async cancel(): Promise<void> {
    this.cancelVersion++;
    if(this.reverting){this.status=this.reverting==='submitted'?'回退已提交，无法撤销请求；仍在等待核对，草稿保留':'已取消回退准备，草稿保留';this.changed();return;}
    this.documentPreparation?.abort();
    this.navigationIntent++;
    this.emit('queue-pause','用户已停止当前回合；核对后手动继续本地队列');
    this.canceled = true;
    const compaction=this.compaction;
    if(compaction&&(compaction.active||compaction.phase==='unknown')){
      const id=compaction.stop();this.syncCompaction(compaction);if(id)await this.interruptCompaction(compaction,id);return;
    }
    const pending = [...this.approvals.keys()];
    if (pending.length||this.waitingForUserInput) this.invalidate('canceled');
    for (const id of pending) { try { this.rpc.respond(id, {decision: 'decline'}); } catch { /* connection loss cannot grant approval */ } }
    const id = this.projection.activeTurn();
    if (id) await this.interrupt(id);
    this.status = this.busy ? '正在停止' : '已停止'; this.changed();
  }
  private async interrupt(turnId: string): Promise<void> {
    if (this.interrupting.has(turnId)) return;
    this.interrupting.add(turnId);
    try { await this.rpc.request('turn/interrupt', {threadId: this.projection.threadId, turnId}); }
    catch (e) { this.interrupting.delete(turnId); this.problem(e); }
  }
  private async interruptCompaction(value:ManualCompaction,turnId:string){
    try{await this.rpc.request('turn/interrupt',{threadId:value.threadId,turnId});}
    catch(error){if(this.compaction!==value||!this.isConnected||this.projection.threadId!==value.threadId)return;value.uncertain('停止压缩未确认：'+(error instanceof Error?error.message:String(error))+'；请恢复核对，未自动重试');this.syncCompaction(value);}
  }
  private notification(n: Notification): void {
    this.emit('evidence', {method: n.method, params: n.params});
    // Global directory notifications have no thread identity. Invalidate display data; never adopt their payload.
    if(n.method==='app/list/updated'){this.appCatalogRevision++;this.changed();return;}
    if(n.method==='account/updated'){this.serviceStatusRevision++;this.changed();}
    if('threadId' in n.params&&typeof n.params.threadId==='string'&&(/^(?:turn\/started|item\/|thread\/(?:reverted|deleted|archived|closed))/.test(n.method)||n.method==='thread/status/changed'&&n.params.status.type==='active')&&this.emptyStarts.delete(n.params.threadId)&&this.search.markStale(n.params.threadId))this.changed();
    if(n.method==='thread/name/updated'){
      const {threadId,threadName}=n.params;
      if(this.catalog&&this.isConnected&&this.store.read().threads.includes(threadId))void this.catalog.nameUpdated(threadId,threadName).then(()=>this.changed(),error=>this.problem(error));
      return;
    }
    // 0.163 read markers do not change turn bodies or invalidate pending item pages.
    if(n.method==='thread/readState/changed')return;
    if(n.method==='thread/deleted'){
      const id=n.params.threadId;if(!this.isConnected||!this.store.read().threads.includes(id)||this.deletedNotifications.has(id))return;
      this.deletedNotifications.add(id);this.store.clearSelection(id);
      this.emptyStarts.delete(id);this.readWindows.delete(id);this.archiveNotifications.delete(id);
      this.search.forget(id);void this.search.discardCache(id).finally(()=>this.changed());
      if(this.catalog)void this.catalog.deletedUpdated(id).then(()=>{this.emit('thread-deleted',id);this.changed();},error=>this.problem(error));
      if(id===this.projection.threadId){
        this.abandonCompaction('压缩期间会话已删除，旧请求结果不再适用');
        this.documentPreparation?.abort();this.canceled=true;this.cancelVersion++;this.historyInvalidation++;this.navigationIntent++;
        this.emit('queue-pause','会话已永久删除，本地队列停止');this.invalidate('thread-deleted');
        this.outline.invalidate('会话已永久删除');this.history.invalidate('会话已永久删除');this.busy=!!this.documentPreparation||this.pendingStart;this.currentTurnId=undefined;
        this.toolCheck={verified:false,threadId:'',reason:'请选择会话或新建'};
        // Keep a local mutation's identity until its own receipt is processed.
        if(this.managedThreadId!==id){this.projection.clear();this.needsRecovery=false;}
        else this.needsRecovery=true;
        this.status='会话历史已永久删除';
      }
      this.changed();return;
    }
    if('threadId' in n.params&&typeof n.params.threadId==='string'&&/^(?:turn\/(?:started|completed)|item\/|thread\/(?:reverted|archived|unarchived))/.test(n.method))this.readWindows.delete(n.params.threadId);
    if(n.method==='skills/changed'){this.skills.invalidate('Codex技能目录已变化；原选择保留，请主动刷新后核对');this.changed();return;}
    if((n.method==='thread/archived'||n.method==='thread/unarchived')&&this.store.read().threads.includes(n.params.threadId)){
      const id=n.params.threadId,archived=n.method==='thread/archived';this.archiveNotifications.set(id,archived);this.search.markStale(id);this.search.markScopeChanged();this.search.availabilityChanged();this.changed();
      if(this.catalog)void this.catalog.archiveUpdated(id,archived).then(()=>{if(this.archiveNotifications.get(id)===archived)this.archiveNotifications.delete(id);this.changed();},error=>this.problem(error));
    }
    if('threadId' in n.params&&typeof n.params.threadId==='string'&&/^(?:turn\/(?:started|completed)|item\/|thread\/(?:reverted|archived|name\/updated))/.test(n.method)&&this.search.markStale(n.params.threadId))this.changed();
    if(n.method==='thread/reverted'&&this.store.read().threads.includes(n.params.threadId))void this.search.discardCache(n.params.threadId).finally(()=>this.changed());
    if ('threadId' in n.params && n.params.threadId !== this.projection.threadId) return;
    const eventTurn='turnId' in n.params?n.params.turnId:'turn' in n.params?n.params.turn.id:undefined;
    if(typeof eventTurn==='string'&&this.revertedTurns.has(eventTurn)&&/^(turn\/|item\/)/.test(n.method)){
      this.revertConflict=true;this.historyInvalidation++;this.navigationIntent++;this.needsRecovery=true;
      this.toolCheck={verified:false,threadId:this.projection.threadId,reason:'收到已回退回合的迟到通知，请恢复核对'};
      this.history.invalidate('已丢弃被回退回合的迟到通知，请恢复核对');this.outline.invalidate('回退后的迟到通知待核对');this.search.markStale(this.projection.threadId);this.emit('queue-pause','已丢弃旧回合通知，请恢复核对');this.status='旧回合通知已隔离，请恢复核对；草稿保留';this.changed();return;
    }
    if(this.reverting&&(/^(turn\/|item\/)/.test(n.method)||['thread/archived','thread/settings/updated','model/rerouted'].includes(n.method)))this.revertConflict=true;
    if(n.method==='thread/settings/updated'){
      const {threadId,threadSettings:value}=n.params;if(!this.isConnected||!this.store.read().threads.includes(threadId)||!value||typeof value.cwd!=='string'||resolve(value.cwd).toLowerCase()!==resolve(this.root).toLowerCase())return;
      const receipt=permissionReceipt(value,this.root,'settings-notification');this.permissionReceipts.set(threadId,receipt);this.permissionSnapshot={cwd:value.cwd,model:value.model,modelProvider:value.modelProvider,approvalPolicy:value.approvalPolicy,approvalsReviewer:value.approvalsReviewer,sandbox:value.sandboxPolicy};
      const expected=this.permissionChoices.get(threadId)??'read-only';if(!this.pendingStart&&receipt.preset!==expected){this.needsRecovery=true;this.error='后端权限回执与本会话选择不一致；已暂停，请恢复核对，未自动改档';this.emit('queue-pause','权限回执未匹配，队列暂停');if(this.busy)void this.cancel();}this.changed();return;
    }
    if(n.method==='model/rerouted'){
      const expected=this.submittedModel?.turnId===n.params.turnId?this.submittedModel.choice.model:this.model;
      if(n.params.toModel!==expected){this.needsRecovery=true;this.error=`Codex 报告模型由 ${n.params.fromModel} 变为 ${n.params.toModel}；已请求停止，请核对，未自动重试`;this.errorTurnId=n.params.turnId;void this.cancel();this.changed();}return;
    }
    if(n.method==='thread/reverted'||n.method==='thread/archived'){
      this.abandonCompaction('压缩期间历史或归档状态已变化，请恢复核对');
      this.emit('queue-pause','历史或归档状态已变化；队列暂停，核对后手动继续');
      this.historyInvalidation++;this.navigationIntent++;this.outline.invalidate('历史状态已变化，回合表失效');this.history.invalidate('服务端历史或归档状态已变化，请恢复核对；旧正文仅供查看');this.needsRecovery=true;this.invalidate('history-invalidated');this.status='历史状态待核对，发送与旧审批已禁用';this.changed();return;
    }
    this.projection.apply(n);
    const compaction=this.compaction;
    const compactStart=n.method==='turn/started'&&!!compaction&&(compaction.watches(n.params.turn.id)||compaction.owns(n.params.turn.id));
    if(compaction&&this.isConnected){
      const phase=compaction.phase,turnId=compaction.turnId;compaction.observe(n);
      if(phase!==compaction.phase||turnId!==compaction.turnId)this.syncCompaction(compaction);
      const stop=compaction.takeInterrupt();if(stop)void this.interruptCompaction(compaction,stop);
    }
    if (n.method === 'turn/started'&&!compactStart) {
      const id = n.params.turn.id;
      if (this.projection.turns.get(id)?.status === 'inProgress' && this.currentTurnId === id) {
        this.currentTurnId = id; this.busy = true;
        if (this.attempt && !this.turnAttempts.has(id)) { this.turnAttempts.set(id, this.attempt); this.store.record(this.attempt, {turnId: id}); }
        if (this.canceled) void this.interrupt(id);
      } else if(this.projection.turns.get(id)?.status==='inProgress'&&!this.pendingStart){
        // An unmatched public start may be delayed. Preserve the current attempt/cancel
        // owner and require a public reread before treating it as the current turn.
        this.navigationIntent++;if(this.operation)this.historyInvalidation++;this.needsRecovery=true;this.toolCheck={verified:false,threadId:this.projection.threadId,reason:'运行回合通知身份待核对，请恢复'};
        this.emit('queue-pause','收到未匹配的运行回合通知；请恢复核对，未自动继续队列');this.status='服务端报告运行回合，当前归属待核对；请恢复';
      }
    }
    if (n.method === 'turn/completed') {
      const id = n.params.turn.id;
      for(const [requestId,value] of this.userInputs)if(value.params.turnId===id)this.userInputs.delete(requestId);
      this.store.clearPending(this.projection.threadId, id);
      const attempt = this.turnAttempts.get(id);
      if (attempt&&!this.compaction?.owns(id)) this.store.record(attempt, {turnId: id, status: n.params.turn.status});
      if (this.currentTurnId === id) {
        this.busy = false; this.status = n.params.turn.status; this.approvals.clear();
        this.refreshTitle(this.projection.threadId,id);
        if (n.params.turn.error) { this.error = n.params.turn.error.message; this.errorTurnId = id; }
        this.emit('queue-terminal',{threadId:this.projection.threadId,turnId:id,status:n.params.turn.status,canceled:this.canceled});
      }
    }
    if (n.method === 'thread/tokenUsage/updated') { const attempt = this.turnAttempts.get(n.params.turnId); if (attempt) this.store.record(attempt, {usage: n.params.tokenUsage}); }
    if (n.method === 'serverRequest/resolved') {
      const input=this.userInputs.get(n.params.requestId),approval=this.approvals.get(n.params.requestId);
      this.approvals.delete(n.params.requestId);this.userInputs.delete(n.params.requestId);
      const request=input??approval;if(request)this.clearRequestPending(request.params.threadId,request.params.turnId);
      if(this.busy&&!this.canceled)this.status=this.waitingForUserInput?'等待回答':this.approvals.size?'等待审批':'生成中';
    }
    this.changed();
  }
  private async request(r: IncomingRequest): Promise<void> {
    const compact=this.compaction;
    if(compact?.submitted&&(compact.active||compact.phase==='unknown')){
      if(r.method==='item/commandExecution/requestApproval'||r.method==='item/fileChange/requestApproval')this.rpc.respond(r.id,{decision:'decline'});else this.rpc.reject(r.id,'压缩操作不提供工具、审批或问答授权');
      this.error='压缩期间收到额外服务端请求，已拒绝；请核对压缩状态';await this.cancel();return;
    }
    if(r.method==='item/tool/requestUserInput'){
      try{validateUserInput(r.params);}catch(error){this.rpc.reject(r.id,'原生问题格式未核对；停止本回合');await this.cancel();throw error;}
      const p=r.params;
      if(this.retired||this.canceled||this.needsRecovery||this.invalidatedTurns.has(p.turnId)||!this.busy||p.threadId!==this.projection.threadId||p.turnId!==this.projection.activeTurn()||this.listenerCount('change')===0){this.rpc.reject(r.id,'原生问题已失效，未提交回答');if(p.threadId===this.projection.threadId&&p.turnId===this.projection.activeTurn())await this.cancel();return;}
      if(this.userInputs.has(r.id)||this.approvals.has(r.id)){this.rpc.reject(r.id,'重复服务端请求标识；未提交回答');await this.cancel();return;}
      try{this.store.pending({threadId:p.threadId,turnId:p.turnId,kind:r.method});}catch(error){this.rpc.reject(r.id,'提问状态保存未确认');await this.cancel();throw error;}
      this.userInputs.set(r.id,{id:r.id,callbackToken:randomUUID(),params:structuredClone(p),status:'pending'});this.status=p.isBlocking?'等待回答':'可选问题待回答';this.changed();return;
    }
    const supported = r.method === 'item/commandExecution/requestApproval' || r.method === 'item/fileChange/requestApproval';
    if (supported) {
      const approval: Approval = {...r as Approval, callbackToken: randomUUID()};
      if (this.retired || this.canceled || this.invalidatedTurns.has(approval.params.turnId) || !this.busy || approval.params.threadId !== this.projection.threadId || approval.params.turnId !== this.projection.activeTurn() || this.listenerCount('change') === 0) {
        this.rpc.respond(r.id, {decision: 'decline'});
        if (this.invalidatedTurns.has(approval.params.turnId)) await this.interrupt(approval.params.turnId);
        return;
      }
      if (this.approvals.has(r.id)||this.userInputs.has(r.id)) { this.rpc.respond(r.id, {decision: 'decline'}); await this.cancel(); return; }
      try { this.store.pending({threadId: approval.params.threadId, turnId: approval.params.turnId, kind: approval.method}); }
      catch (e) { this.rpc.respond(r.id, {decision: 'decline'}); await this.cancel(); throw e; }
      this.approvals.set(r.id, approval); this.status = '等待审批'; this.changed();
    } else {
      // No tokens, permission grants, arbitrary dynamic tools or attestations supplied.
      this.rpc.reject(r.id, '受限原型未接入此请求；停止轮次');
      this.error = `未接入的服务端请求: ${r.method}`;
      await this.cancel();
    }
  }
  private clearRequestPending(threadId:string,turnId:string){if(![...this.approvals.values(),...this.userInputs.values()].some(value=>value.params.threadId===threadId&&value.params.turnId===turnId))this.store.clearPending(threadId,turnId);}
  async answerUserInput(id:RequestId,callbackToken:string,action:'answer'|'skip'|'stop',answers?:unknown):Promise<void>{
    const input=this.userInputs.get(id);
    if(!this.isConnected||this.canceled||this.needsRecovery||!this.busy||!input||input.callbackToken!==callbackToken||input.params.threadId!==this.projection.threadId||input.params.turnId!==this.projection.activeTurn())throw Error('原生问题已失效或回答已提交；未重复发送');
    if(action==='stop'){await this.cancel();return;}
    if(input.status!=='pending')throw Error('回答已提交；未重复发送');
    const response=userInputResponse(input.params,action==='skip'?{}:answers);
    input.status='submitted';
    try{this.rpc.respond(id,response);}catch(error){this.needsRecovery=true;this.emit('queue-pause','问题回答结果未知；请恢复核对，未自动重发');this.invalidate('user-input-outcome-unknown');this.status='问题回答结果未确认，请恢复核对';this.problem(error);throw error;}
    this.status='回答已提交，等待后端确认';this.changed();
  }
  private async checkApprovalAcceptance(approval: Approval): Promise<void> {
    if (this.canceled || !this.busy || approval.params.turnId !== this.projection.activeTurn()) throw new Error('该轮次已停止');
    if (approval.method === 'item/commandExecution/requestApproval') {
      const p = approval.params;
      // Narrow prototype allowlist, not a shell safety parser. No expansion, paths or network.
      if (p.kind !== 'command' || !p.cwd || resolve(p.cwd).toLowerCase() !== resolve(this.root).toLowerCase() || !allowedCommand(p.command ?? '') || p.networkApprovalContext || (p.environmentId && p.environmentId !== 'local')) throw new Error('此命令超出原型允许范围；请拒绝');
    } else {
      if (approval.params.grantRoot) throw new Error('原型不允许扩大写入范围');
      const item = this.projection.items.get(approval.params.itemId)?.item;
      if (item?.type !== 'fileChange' || !item.changes.length) throw new Error('缺少可核对的文件差异；请拒绝');
      for (const change of item.changes) {
        await ownedPath(this.root, change.path);
        if (change.kind.type === 'update' && change.kind.move_path) await ownedPath(this.root, change.kind.move_path);
      }
    }
  }
  /** Read-only affordance check. Decide still rechecks the exact live request. */
  async approvalAcceptance(id:RequestId,callbackToken:string):Promise<{allowed:boolean;reason:string}> {
    try {
      const approval=this.approvals.get(id);
      if(this.retired||!approval||callbackToken!==approval.callbackToken)throw Error('审批已失效');
      await this.checkApprovalAcceptance(approval);
      if(this.retired||this.canceled||this.approvals.get(id)!==approval)throw Error('审批已失效');
      return{allowed:true,reason:''};
    }catch(error){return{allowed:false,reason:error instanceof Error?error.message:'审批范围未能核对；可以拒绝此请求'};}
  }
  async decide(id: RequestId, accept: boolean, callbackToken: string): Promise<void> {
    const approval = this.approvals.get(id);
    if (this.retired || !approval || callbackToken !== approval.callbackToken) throw new Error('审批已失效');
    if (accept) await this.checkApprovalAcceptance(approval);
    // An async path check may outlive cancellation/resolution: check the same callback again.
    if (this.retired || this.approvals.get(id) !== approval || this.canceled) throw new Error('审批已失效');
    this.rpc.respond(id, {decision: accept ? 'accept' : 'decline'}); this.approvals.delete(id);
    this.clearRequestPending(approval.params.threadId,approval.params.turnId);
    this.status = this.approvals.size ? '等待审批' : this.waitingForUserInput?'等待回答':'生成中'; this.changed();
  }
  private async waitTerminal(turnId: string, timeoutMs: number): Promise<void> {
    if (this.projection.turns.get(turnId)?.status !== 'inProgress') return;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); this.off('change', check); resolve(); };
      const check = () => { if (this.projection.turns.get(turnId)?.status !== 'inProgress') finish(); };
      const timer = setTimeout(finish, timeoutMs); this.on('change', check); check();
    });
  }
  async dispose(reason = 'window-reload-or-close'): Promise<void> {
    this.readWindows.clear();
    this.emptyStarts.clear();
    this.permissionChoices.clear();this.permissionReceipts.clear();this.permissionRevision++;this.permissions.invalidate('连接已停用，权限目录失效');
    this.retired = true;
    this.modes.invalidate('连接已停用，模式目录失效');
    this.search.cancel('连接已停用，搜索结果仅为旧快照');
    this.skills.invalidate('连接已停用，技能目录失效');
    this.toolCheck = {verified: false, reason: '服务器已停用，工具核对失效', threadId: ''};
    const pending = [...this.approvals.keys()];
    this.invalidate(reason);
    for (const id of pending) { try { this.rpc.respond(id, {decision: 'decline'}); } catch {} }
    const turnId = this.projection.activeTurn();
    if (this.busy) { await this.cancel(); if (turnId) await this.waitTerminal(turnId, 2000); }
    try{await this.rpc.dispose();}finally{try{await this.projection.metrics.flush();}catch(error){this.emit('metrics-error',error);}try{await this.searchCache?.flush();}catch{/* The shared cache retains its visible unconfirmed notice; reconnect must remain available. */}}
  }
}
