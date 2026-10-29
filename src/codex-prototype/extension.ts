import * as vscode from 'vscode';
import { randomBytes, createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Rpc } from './rpc';
import { Session } from './session';
import {DailySessionStore,DAILY_CHAT_MODEL,DAILY_CHAT_SCOPE} from './daily-session-store';
import { imageInput, assertOwnedWorkspace, authorizeWorkspaceFiles } from './storage';
import { html } from './webview';
import { PIN } from './pin';
import { registerOfflinePanel } from './offline/panel';
import {registerInteractiveOfflinePanel} from './offline/interactive-panel';
import {displayBatch} from './online-batch';
import {connectionOnlyStore,CONNECTION_ONLY_REASON} from './session-access';
import {checkedImage} from './online-image';
import {FormulaExporter,type FormulaRequest} from './formula-export-host';
import {DisplaySettingsStore,handleDisplaySettings,type DisplayStateStorage} from './display-settings';
import {BlockFoldStore,handleBlockFold} from './block-fold-store';
import {UserFoldStore,handleUserFold} from './user-fold-store';
import {handleMessageCopy} from './message-copy';
import {handleDisplayCopy} from './display-copy';
import {ImageExporter,projectionImages,draftImageOwner,type ImageRequest,type ImageSourceRequest,type ImageFrameRequest} from './image-export-host';
import {matchesSendRequest,validSendFiles} from './send-request';
import {DraftStore,DraftHost} from './draft-store';
import {handleAttachmentImport} from './attachment-files';
import {AttachmentPreparations} from './attachment-preparations';
import {FileActionHost,InvalidDraftFile,bodyFileOwner,type FileActionRequest} from './file-action-host';
import {ScrollViewStore,ScrollViewHost} from './scroll-view-store';
import {LocalSpeech} from './local-speech';
import {LocalDictation} from './local-dictation';
import {DictationHost} from './dictation-host';
import {ReplyActionHost} from './reply-action-host';
import {RevertHost} from './revert-host';
import {ToolExpansionStore,handleToolExpansion} from './tool-expansion-store';
import {WorkFoldStore,handleWorkFold} from './work-fold-store';
import {ChangedFilesStore,handleChangedFilesFold} from './changed-files-store';
import {ChangedReviewStore,handleChangedReview} from './changed-review-store';
import {runtimeState} from './runtime-state';
import {codexPageContent} from './codex-page-state';
import {ThreadCatalog,type ThreadMutation} from './thread-catalog';
import {handleThreadReadState} from './thread-read-state';
import {TurnMetricsStore} from './turn-metrics-store';
import {SearchHistoryStore,handleSearchHistory} from './search-history-store';
import {SearchCache} from './search-cache';
import {RailViewStore,handleRailView} from './rail-view-store';
import {LocalQueueStore,LocalQueueRunner} from './local-queue';
import {SubmissionHost,queueDisplay} from './submission-host';
import {AttachmentRetention} from './attachment-retention';
import {AttachmentStorage} from './attachment-storage';
import {startAttachmentMaintenance} from './attachment-maintenance';
import {MessageFileSources} from './message-file-sources';
import {ModelSelections,DAILY_MODEL_SELECTION_KEY} from './model-selection';
import {ModelSelectionHost} from './model-selection-host';
import {PermissionSelectionHost} from './permission-selection-host';
import {ModeSelections} from './collaboration-mode';
import {CollaborationModeHost} from './collaboration-mode-host';
import {SkillsHost} from './skills-host';
import {EditorAttachmentHost} from './editor-attachment-host';
import {EditorCaptureHost} from './editor-capture-host';
import {NativeDiffHost,NativeDiffViews} from './native-diff-host';
import {CompactionHost} from './compaction-host';
import {ServiceStatusHost} from './service-status-host';
import {readRuntimeEnvironment,RuntimeEnvironmentHost} from './runtime-environment-host';
import {AccountLimitsHost} from './account-limits-host';
import {AccountLimitsCache} from './account-limits-cache';
import {FileReferenceHost} from './file-reference-host';
import {openReferencedText,openReferencedFile,openAttachedFile,findReferencedFiles} from './file-reference-vscode';
import {TaskNotifications} from './task-notifications';
import {ImageStateSender,imageStateMessages} from './image-state-host';

let session: Session | undefined;
let stopHost=()=>{};
// A workspace-local draft is not a Codex thread and never enters runtime history.
const LOCAL_DRAFT_THREAD='codex-local-draft';
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let attachmentStorage:AttachmentStorage|undefined;
  const workspaceData:DisplayStateStorage={get:<T>(key:string,fallback:T)=>context.workspaceState.get(key,fallback),update:(key,value)=>attachmentStorage?attachmentStorage.state.update(key,value):context.workspaceState.update(key,value)};
  const displaySettings=new DisplaySettingsStore(workspaceData);
  const blockFolds=new BlockFoldStore(workspaceData);
  const userFolds=new UserFoldStore(workspaceData);
  const drafts=new DraftStore(workspaceData);
  const scrollViews=new ScrollViewStore(workspaceData);
  const toolExpansions=new ToolExpansionStore(workspaceData);
  const workFolds=new WorkFoldStore(workspaceData);
  const changedFileFolds=new ChangedFilesStore(workspaceData);
  const changedReviews=new ChangedReviewStore(workspaceData);
  const searchHistory=new SearchHistoryStore(workspaceData);
   const railViews=new RailViewStore(workspaceData);
  const speechHelper=join(context.extensionPath,'dist/local-speech.ps1'),speechAvailable=await new LocalSpeech(speechHelper).probe();
  const localDictation=new LocalDictation(join(context.extensionPath,'dist/local-dictation.ps1'));
  context.subscriptions.push(localDictation);
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.localSpeech',()=>({available:speechAvailable,helper:speechHelper})));
  if(process.env['CODEX_PROTOTYPE_MODE']!=='online')context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.scrollView',async(op:string,thread:string,value?:unknown,protectedThread?:string)=>op==='read'?scrollViews.load(thread):scrollViews.save(thread,value,protectedThread)));
  // Isolated preview fixtures use this same store without creating an RPC/session.
  if(process.env['CODEX_PROTOTYPE_MODE']!=='online')context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.draftStorage',async(op:string,thread:string,...args:any[])=>{if(op==='read')return drafts.load(thread);if(op==='save')return drafts.save(thread,args[0]);if(op==='begin')return drafts.begin(thread,args[0],args[1],args[2],args[3],args[4],args[5],args[6],args[7]);if(op==='finish')return drafts.finish(thread,args[0],args[1],args[2],args[3],args[4],args[5],args[6],args[7]);if(op==='review')return drafts.review(thread,args[0]);if(op==='restore')return drafts.restore(thread,args[0]);throw Error('未知草稿操作');}));
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.userFold',async(key?:unknown,state?:unknown)=>{if(key!==undefined)await userFolds.set(key,state,()=>displaySettings.read().foldMemory);return userFolds.read();}));
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.blockFold',async(key?:unknown,folded?:unknown)=>{if(key!==undefined)await blockFolds.set(key,folded,()=>displaySettings.read().foldMemory);return blockFolds.read();}));
  if(process.env['CODEX_PROTOTYPE_MODE']!=='online')context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.toolExpansion',async(key?:unknown,expanded?:unknown)=>{if(key!==undefined)await toolExpansions.save(key,expanded,()=>displaySettings.read().expandMemory);return toolExpansions.read();}));
  if(process.env['CODEX_PROTOTYPE_MODE']!=='online')context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.workFold',async(key?:unknown,state?:unknown)=>{if(key!==undefined)await workFolds.set(key,state,()=>displaySettings.read().foldMemory&&displaySettings.read().workSegments);return workFolds.load();}));
  // Owned display preview uses the same isolated extension state as real panels.
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.displaySettings',async(key?:unknown,value?:unknown)=>key===undefined?displaySettings.read():displaySettings.set(key,value)));
  const environmentMetadata={extensionVersion:context.extension?.packageJSON?.version,extensionPath:context.extensionPath,vscodeVersion:vscode.version};
  registerOfflinePanel(context,displaySettings,blockFolds,userFolds,false,()=>readRuntimeEnvironment(environmentMetadata,()=> 'offline'));
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath??'';
  const run = process.env['CODEX_PROTOTYPE_MODE']==='online'?process.env['CODEX_PROTOTYPE_RUN']:undefined;
  const dailyMode=context.extension?.packageJSON?.codexDailyChat===true&&!run&&process.env['CODEX_PROTOTYPE_MODE']!=='offline';
  let dailyStore:DailySessionStore|undefined,dailyStorageError='';
  if(dailyMode&&root)try{if(!context.storageUri?.fsPath)throw Error('当前工作区没有可用的插件独立存储目录');dailyStore=new DailySessionStore(context.storageUri.fsPath,root);}catch(error){dailyStorageError=error instanceof Error?error.message:'日常会话存储无法读取；已保留资料，发送禁用';}
  // The selected daily workspace uses the same bounded attachment paths and reference proofs.
  // Its journal registration is separate from experimental markers and backend authority.
  if(root&&(run||dailyStore))try{
    if(dailyStore)context.subscriptions.push(await authorizeWorkspaceFiles(root,()=>dailyStore!.read()));
    else await assertOwnedWorkspace(root);
    attachmentStorage=new AttachmentStorage(context.workspaceState,root,()=>displaySettings.read().attachmentMaxTotalMB);
  }catch(error){dailyStorageError=error instanceof Error?error.message:'附件工作区无法核对；原资料保留';}
  const loadedBundleSha256 = createHash('sha256').update(await readFile(join(context.extensionPath, 'dist/extension.js'))).digest('hex');
  const batch=root&&run?displayBatch(run,root):undefined,store=dailyStore??batch?.store;
  const {oldUsed=null,baselineSha256,batchId,independentBatch}=batch??{};
  const nativeDiffs=store?new NativeDiffViews():undefined;if(nativeDiffs)context.subscriptions.push(nativeDiffs);
  const catalog=new ThreadCatalog(workspaceData);
  const turnMetrics=new TurnMetricsStore(workspaceData),metricsLog=vscode.window.createOutputChannel('DSH Codex 用时统计');context.subscriptions.push(metricsLog);let metricsWarned=false;
  function metricsError(error:unknown){metricsLog.appendLine(new Date().toISOString()+' '+(error instanceof Error?error.message:String(error)));if(metricsWarned)return;metricsWarned=true;void vscode.window.showWarningMessage('用时统计未能保存或恢复；已有正文和草稿保留，详情见统计日志。','查看日志').then(action=>{if(action)metricsLog.show(true);});}
  const localQueue=new LocalQueueStore(workspaceData);
  const retention=new AttachmentRetention(workspaceData,root);
  const fileSources=new MessageFileSources(workspaceData,root);
  const modelSelections=new ModelSelections(workspaceData,dailyStore?DAILY_MODEL_SELECTION_KEY:undefined);
  const modeSelections=dailyStore?new ModeSelections(workspaceData):undefined;
  const searchCache=new SearchCache(workspaceData,root);
  const editorAttachments=new EditorAttachmentHost(root,workspaceData,()=>{if(!store)return;const d=vscode.window.activeTextEditor?.document;return d?{scheme:d.uri.scheme,path:d.uri.fsPath,version:d.version,dirty:d.isDirty}:undefined;},()=>notifyEditorContext(),attachmentStorage?.import,owner=>drafts.read(owner.threadId).files??[]);
  const editorCapture=new EditorCaptureHost(root,()=>{
    if(!store)return;const e=vscode.window.activeTextEditor,d=e?.document;if(!e||!d||!e.selection)return;
    const position=(p:vscode.Position)=>({line:p.line,character:p.character}),selection={start:position(e.selection.start),end:position(e.selection.end)};
    return{scheme:d.uri.scheme,path:d.uri.fsPath,version:d.version,dirty:d.isDirty,selection,lineCount:d.lineCount,lineLength:(line:number)=>d.lineAt(line).text.length,offsetAt:(p:{line:number;character:number})=>d.offsetAt(new vscode.Position(p.line,p.character)),text:(r:{start:{line:number;character:number};end:{line:number;character:number}})=>d.getText(new vscode.Range(r.start.line,r.start.character,r.end.line,r.end.character)),diagnostics:()=>vscode.languages.getDiagnostics(d.uri).map(value=>({range:{start:position(value.range.start),end:position(value.range.end)},severity:value.severity,message:value.message,...(value.source?{source:value.source}:{}),...(value.code!==undefined?{code:typeof value.code==='object'?value.code.value:value.code}:{})}))};
  });
  const draftThread=()=>session?.projection.threadId||LOCAL_DRAFT_THREAD;
  const draftThreads=()=>[LOCAL_DRAFT_THREAD,...(store?.read().threads??[]).filter(id=>!catalog.get(id)?.deleted)];
  const metadataPurges=new Map<string,Promise<void>>();
  function purgeMetadata(id:string){
    const prior=metadataPurges.get(id);if(prior)return prior;
    // The public notification and the local delete receipt may confirm the same
    // deletion. Share cleanup, including its failure, until the next activation.
    const pending=(async()=>{
      await searchCache.forget(id).catch(()=>{}); // Unknown/corrupt cache is reported separately and never blocks public history use.
      const results=await Promise.allSettled([drafts.forget(id),scrollViews.forget(id),blockFolds.forget(id),userFolds.forget(id),toolExpansions.forget(id),workFolds.forget(id),changedFileFolds.forget(id),changedReviews.forget(id),railViews.forget(id),localQueue.forget(id),retention.forget(id),fileSources.forget(id),modelSelections.forget(id),modeSelections?.forget(id),turnMetrics.forget(id)]);
      if(results.some(result=>result.status==='rejected'))throw Error('会话历史已删除；部分本地视图记录清理失败，下次启动将重试，不会恢复或重发会话');
    })();metadataPurges.set(id,pending);return pending;
  }
  // Only acknowledged tombstones authorize local cleanup; unknown deletes retain all data.
  for(const id of store?.read().threads??[])if(catalog.get(id)?.deleted)await purgeMetadata(id);
  const [vendor,display] = await Promise.all(['offline-vendor.js','online-display.js'].map(n=>readFile(join(context.extensionPath,'dist',n),'utf8')));
  const openOfflineExperience=registerInteractiveOfflinePanel(context,displaySettings,{vendor:vendor!,display:display!});
  let view: vscode.WebviewView | undefined;
  let pageReady=false;
  let pageVersion=0;
  let pageId='';
  let stateRevision=0;
  let connectionAttempted=false;
  let ready = false;
  let posting = false;
  let again = false;
  let connecting = false;
  let connectionError = dailyStorageError;
  let generation = 0;
  let replyHost:ReplyActionHost|undefined;
  let dictationHost:DictationHost|undefined;
  let queueRunner:LocalQueueRunner|undefined;
  let taskNotifications:TaskNotifications|undefined;
  let imageState:ImageStateSender|undefined;
  let accountLimits:AccountLimitsCache|undefined;
  function publishAccountLimits(){if(view&&pageReady)void view.webview.postMessage({type:'account-limits-state',pageId,connectionId:generation,accountLimits:accountLimits?.view}).then(undefined,()=>{});}
  context.subscriptions.push(displaySettings.onDidChange(source=>{stateRevision++;if(view&&pageReady&&pageId&&source!==pageId)void view.webview.postMessage({type:'settings-changed',pageId}).then(undefined,()=>{});}));
  const notificationLog=vscode.window.createOutputChannel('DSH Codex 任务通知');context.subscriptions.push(notificationLog);
  let storageCheckPage='',lastStorageCheck=0;
  // DSH165 forwards workbench shortcuts back to the focused editable webview.
  const editInView=(command:'undo'|'redo')=>{if(view?.visible&&pageReady&&pageId)return view.webview.postMessage({type:'exec-edit',command,pageId});};
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.undoInView',()=>editInView('undo')),vscode.commands.registerCommand('codexPrototype.redoInView',()=>editInView('redo')));
  stopHost=()=>{accountLimits?.dispose();dictationHost?.dispose();localDictation.dispose();if(queueRunner&&session?.projection.threadId)void queueRunner.pause(session.projection.threadId,'窗口已关闭或Reload；核对后手动继续本地队列');queueRunner?.dispose();taskNotifications?.dispose();generation++;pageReady=false;view=undefined;replyHost?.stop();};
  async function publicState(publishing=false) {
    for(;;){
    const active=session,threadId=draftThread(),connectionId=generation,revision=stateRevision;
    const thread=active?.projection.threadId?active:undefined;
    const content={...await codexPageContent(active,threadId,(path,id)=>checkedImage(root!,path,id)),accountLimits:accountLimits?.view,compaction:store?thread?.compactionView():undefined,serviceStatusAvailable:!!store&&!!thread,serviceStatusRevision:thread?.serviceStatusRevision??0,appCatalogRevision:thread?.appCatalogRevision??0,dictationAvailable:process.platform==='win32'};
    // An asynchronous file check must not bind old rows under a newly selected owner.
    // Publishing already owns a coalescing loop. Retrying here as well would
    // project the latest rows twice (and reread every local image twice).
    if(session!==active || generation!==connectionId || draftThread()!==threadId || revision!==stateRevision){if(publishing)return;continue;}
    const data = store?.read();
    const sessionCatalog=catalog.snapshot(data?.threads??[]);
    return {...runtimeState(active,ready,connecting,connectionError),offline:!active,offlineExperienceAvailable:!dailyMode,dispatchMode:dailyStore?'daily':store?'experiment':'connection-only',ledgerAccess:!!store,threadManagementAvailable:!!store,version:environmentMetadata.extensionVersion??'development',extensionPath:context.extensionPath,localImagesAvailable:!!root,attachmentImportAvailable:!!attachmentStorage,modelSelection:thread?.modelView(),modeSelection:thread?.modeView(),permissionSelection:dailyStore?thread?.permissionView():undefined,skills:thread?.skills?.snapshot(),editorContext:editorAttachments.snapshot(),editorCapture:editorCapture.snapshot(),turnProgress:thread?.projection.turnProgress.snapshot(thread.projection.turns),localQueue:thread&&queueRunner?queueDisplay(queueRunner,thread):undefined,operating:active?.isOperating??false,history:thread?.history?.snapshot(thread.projection),outline:thread?.outline?.snapshot(thread.projection),search:thread?.search?.snapshot(),toolCheck: active?.toolCheck ?? {verified: false, reason: '尚未连接'}, threadId,connectionId, threads: sessionCatalog.sessions.map(v=>v.id),sessionCatalog, used: dailyStore?null:data?.attempts.length??null,limit:store?.limit??null,oldUsed,batchId,independentBatch,dispatchBlockReason:store?store.dispatchReason():dailyStorageError||CONNECTION_ONLY_REASON,baselineSha256, ...content, invalidations: data?.invalidatedApprovals ?? [], serverProcessId: active?.rpc.processId??null, pin: PIN.version, loadedBundleSha256,copySettings:displaySettings.read(),attachmentStorage:attachmentStorage?.status(),speechAvailable,replyActionsEnabled:true,fileReferencesEnabled:true};
    }
  }
  async function publish() {
    dictationHost?.sync();
    if (!view?.visible || !pageReady) return;
    if (posting) { again = true; return; }
    posting = true;let retryPost=true;
    try { do {
      again=false;
      if(!view?.visible||!pageReady)break;
      const target:vscode.WebviewView=view,version=pageVersion;
      void notifySessionVisibility().catch(()=>{});
      replyHost?.sync();const state=await publicState(true);
      if(!state){again=true;continue;}
      const sender=imageState;
      if(sender){const packed=sender.prepare(state),lease=pageId;let staged=false,committed=false,failed=false;
        try{for(const message of imageStateMessages(packed)){
          if(view!==target||!target.visible||!pageReady||version!==pageVersion||imageState!==sender)break;
          if(state.connectionId!==generation||state.threadId!==draftThread()){again=true;break;}
          staged ||= message.type==='image-state-part';
          let queued=false;try{queued=await target.webview.postMessage({...message,pageId:lease});}catch{/* Rejected queues have the same bounded retry as a false receipt. */}
          if(!queued){failed=true;break;}
          committed=message.type==='state';
        }}finally{
          if(staged&&!committed&&view===target&&pageReady&&version===pageVersion)await target.webview.postMessage({type:'image-state-abort',pageId:lease,connectionId:packed.imageResources.connectionId,sequence:packed.imageResources.sequence}).then(undefined,()=>false);
        }
        // A failed queue operation gets one fresh projection, never unlimited retry.
        if(failed&&retryPost){retryPost=false;again=true;}
      }
    } while (again); }
    finally { posting = false; }
  }
  async function notifySessionVisibility(){if(view&&pageReady)await view.webview.postMessage({type:'session-visibility',pageId,connectionId:generation,visible:view.visible&&vscode.window.state?.focused===true});}
  context.subscriptions.push(vscode.window.onDidChangeWindowState(()=>{void notifySessionVisibility().catch(()=>{});}));
  if(attachmentStorage)context.subscriptions.push(startAttachmentMaintenance(attachmentStorage,()=>publish()));
  function notifyEditorContext(){editorCapture.invalidate();if(view?.visible&&pageReady){void view.webview.postMessage({type:'editor-capture-view',pageId,threadId:draftThread(),connectionId:generation,editorCapture:editorCapture.snapshot()});void view.webview.postMessage({type:'editor-context-view',pageId,threadId:draftThread(),connectionId:generation,editorContext:editorAttachments.snapshot()});}}
  if(store)context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(()=>notifyEditorContext()),vscode.workspace.onDidSaveTextDocument(()=>notifyEditorContext()),vscode.workspace.onDidChangeTextDocument(e=>{if(e.document===vscode.window.activeTextEditor?.document)notifyEditorContext();}));
  if(store)context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(e=>{if(e.textEditor===vscode.window.activeTextEditor)notifyEditorContext();}),vscode.languages.onDidChangeDiagnostics(e=>{const d=vscode.window.activeTextEditor?.document;if(d&&e.uris.some(uri=>uri.scheme===d.uri.scheme&&uri.fsPath===d.uri.fsPath))notifyEditorContext();}));
  async function connect() {
    if (connecting) return;
    if(!root){connectionError='请先打开本地文件夹，再显式连接；不会自动发送或读取编辑器内容。';await publish();return;}
    connecting = true; connectionAttempted=true; ready = false; connectionError = '';
    const epoch = ++generation;
    accountLimits?.dispose();accountLimits=undefined;
    dictationHost?.sync();
    try {
      taskNotifications?.dispose();taskNotifications=undefined;
      if (session) { const old = session;if(queueRunner&&old.projection.threadId)await queueRunner.pause(old.projection.threadId,'连接正在重建；核对后手动继续本地队列');queueRunner?.dispose();queueRunner=undefined;session = undefined; await publish(); await old.dispose('server-restart'); }
      else await publish();
      const rpc = await Rpc.start(root!,!!store,!!modeSelections,dailyStore?join(context.extensionPath,'dist/workspace-files-mcp.cjs'):undefined);
      if (epoch !== generation) { await rpc.dispose(); return; }
      const active=session = new Session(rpc, root!, store??connectionOnlyStore(),catalog,retention,fileSources,modelSelections,searchCache,()=>{const settings=displaySettings.read();return{loadAll:settings.historyLoadAll,maxMessages:settings.historyMaxMessages};},dailyStore?DAILY_CHAT_MODEL:undefined,dailyStore?DAILY_CHAT_SCOPE:undefined,!!dailyStore,modeSelections,turnMetrics);
      const quota=dailyStore?new AccountLimitsCache(rpc,()=>epoch===generation&&session===active&&ready&&active.isConnected,()=>{if(accountLimits===quota)publishAccountLimits();}):undefined;
      accountLimits=quota;
      rpc.on('notification',message=>{if(accountLimits===quota&&message.method==='account/updated')quota?.invalidateAccount();});
      rpc.on('disconnect',()=>quota?.dispose());
      if(store)taskNotifications=new TaskNotifications(active,{
        current:()=>epoch===generation&&session===active,
        usable:id=>{const entry=catalog.get(id);return store.read().threads.includes(id)&&!entry?.deleted&&!entry?.archived&&!entry?.pending;},
        foreground:id=>vscode.window.state?.focused===true&&!!view?.visible&&pageReady&&ready&&active.projection.threadId===id&&!active.sendOutcomeUncertain&&active.toolCheck.verified&&active.toolCheck.threadId===id,
        preference:()=>displaySettings.read().taskNotifications,
        unread:async(id,current)=>{await catalog.setUnread(id,true,current,'task');stateRevision++;await publish();},
        show:async notice=>{const label={completed:'已完成',failed:'执行失败',approval:'等待审批',question:'等待回答'}[notice.kind],title=(catalog.get(notice.threadId)?.title||'会话').replace(/[\r\n\t]/g,' ').slice(0,80),message=`Codex · ${title}：${label}`,action='打开会话';return (notice.kind==='completed'?await vscode.window.showInformationMessage(message,action):await vscode.window.showWarningMessage(message,action))===action;},
        reveal:async(id,current)=>{if(!current())return;if(active.projection.threadId!==id){if(active.busy||active.isOperating)return;await active.restore(id);}if(!current()||active.projection.threadId!==id)return;await open();if(current())await publish();},
        error:error=>notificationLog.appendLine(new Date().toISOString()+' '+(error instanceof Error?error.message:String(error))),
      });
      active.on('metrics-error',metricsError);
      active.on('thread-deleted',(id:string)=>{void purgeMetadata(id).then(()=>publish(),error=>{const message=error instanceof Error?error.message:String(error);if(session)session.error=message;else connectionError=message;stateRevision++;return publish();}).catch(()=>{});});
      if(store){queueRunner=new LocalQueueRunner(localQueue,active);await queueRunner.ready;}
      active.on('change', () => {stateRevision++;void publish().catch(() => {});});
      active.on('evidence', e => {
        // Only task thread lifecycle/usage evidence. Never record auth or account payloads.
        if (run&&store&&/^(turn\/|item\/|thread\/tokenUsage|serverRequest\/resolved)/.test(e.method)) void appendFile(join(dirname(store.path), 'events.jsonl'), JSON.stringify({at: new Date().toISOString(), ...e}) + '\n', 'utf8').catch(() => {});
      });
      await active.preflight();
      if(epoch!==generation||session!==active)return;
      // Connection readiness is separate from recovering a selected thread.
      // A failed restore must still let the user choose another owned history;
      // Session/tool checks continue to block sends from the failed thread.
      ready = true;
      quota?.start();
      if(store&&epoch===generation&&session===active){
        if(!dailyStore||store.read().threads.length)await active.refreshThreads({},()=>epoch===generation&&session===active);
        const selected=dailyStore?.read().selected;
        if(selected&&epoch===generation&&session===active&&!catalog.get(selected)?.deleted&&!catalog.get(selected)?.archived&&!catalog.get(selected)?.pending)await active.restore(selected);
      }
    } catch (e) { if(epoch===generation){if (session) session.error = e instanceof Error?e.message:String(e); else connectionError = e instanceof Error?e.message:String(e);} }
    finally { connecting = false; await publish(); }
  }
  function resolveView(target:vscode.WebviewView) {
    view=target;pageReady=false;pageId='';
    target.webview.options={enableScripts:true,localResourceRoots:[]};
    target.onDidChangeVisibility(()=>{if(view!==target)return;dictationHost?.sync();void notifySessionVisibility().catch(()=>{});if(target.visible)void publish().catch(()=>{});else replyHost?.stop();});
    target.onDidDispose(() => { if(view!==target)return;dictationHost?.dispose();if(queueRunner&&session?.projection.threadId)void queueRunner.pause(session.projection.threadId,'视图已销毁；核对后手动继续本地队列');replyHost?.stop();view=undefined;pageReady=false; });
    // Reload Webviews replaces the document while retaining this WebviewView object.
    // Each ready handshake renews only page leases; the Codex session remains active.
    function bindPage(){
    dictationHost?.dispose();
    const version=++pageVersion,documentId=pageId,current=()=>view===target&&version===pageVersion;
    const pageImages=imageState=new ImageStateSender();
    const attachmentPreparations=new AttachmentPreparations();
    const post=(message:object)=>current()?target.webview.postMessage({...message,pageId:documentId}):Promise.resolve(false);
    const replies=new ReplyActionHost(()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]}:undefined,current,new LocalSpeech(speechHelper),async(turn,item)=>{if(!session)throw Error('连接未就绪');return session.forkTurn(turn,item)},(turn,item)=>session?.forkReason(turn,item)??'连接未就绪');replyHost=replies;
    const dictation=dictationHost=new DictationHost(()=>{
      if(process.platform!=='win32'||!current()||!target.visible||!pageReady)return;
      const threadId=draftThread();try{if(!draftThreads().includes(threadId))return;return{threadId,connectionId:generation,writable:!drafts.read(threadId).uncertain};}catch{return;}
    },current,localDictation,()=>replies.stop());
    const scrollHost=new ScrollViewHost(scrollViews,()=>({threadId:draftThread(),connectionId:generation,threads:draftThreads()}),current);
    const fileActions=new FileActionHost(root!,m=>{if(!current())return;if(m.source!=='body'){const threadId=draftThread();return{threadId,connectionId:generation,files:drafts.read(threadId).files??[]};}if(!session?.projection.threadId)return;const owner={threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]};return bodyFileOwner(owner,fileSources,m);},async name=>{const uri=await vscode.window.showSaveDialog({saveLabel:'保存文件',defaultUri:vscode.Uri.file(join(root!,name))});if(uri&&uri.scheme!=='file')throw Error('只能保存到工作区的本地文件');return uri?.fsPath;},text=>vscode.env.clipboard.writeText(text),openReferencedText,undefined,openAttachedFile);
    const draftHost=new DraftHost(drafts,root,()=>({threadId:draftThread(),connectionId:generation,threads:draftThreads()}),current,text=>vscode.env.clipboard.writeText(text));
    const modelsHost=new ModelSelectionHost(()=>session?{session,connectionId:generation}:undefined,current);
    const modesHost=new CollaborationModeHost(()=>modeSelections&&session?{session,connectionId:generation}:undefined,current);
    const permissionsHost=new PermissionSelectionHost(()=>dailyStore&&session?{session,connectionId:generation}:undefined,current,async option=>{
      const action='使用'+option.title,detail=option.preset==='full-access'?'这会取消此会话新回合的文件沙箱和命令审批，后端可能访问工作区外文件及网络。':'这会允许此会话新回合直接写入当前工作区；工作区外操作和联网仍需审批。';
      return await vscode.window.showWarningMessage('将此会话的下一新回合设为“'+option.title+'”？',{modal:true,detail:detail+' 不修改全局配置或开启MCP/插件，不改变当前运行回合；重连后恢复只读。'},action)===action;
    });
    const skillsHost=new SkillsHost(()=>session?{session,connectionId:generation}:undefined,current);
    const environmentHost=new RuntimeEnvironmentHost(()=>readRuntimeEnvironment(environmentMetadata,()=>connecting?'connecting':session?.isConnected?'connected':connectionAttempted?'disconnected':'not-connected'),current);
    const nativeDiffHost=new NativeDiffHost(()=>{const id=session?.projection.threadId;if(!store||!session||!ready||connecting||!session.isConnected||!id||!store.read().threads.includes(id)||catalog.get(id)?.deleted||catalog.get(id)?.archived)return;return{projection:session.projection,connectionId:generation};},current,async(snapshot,valid)=>{if(!nativeDiffs)throw Error('当前没有原生差异查看器');await nativeDiffs.open(snapshot,valid);});
    const compactionHost=new CompactionHost(()=>store&&session&&ready&&!connecting?{session,connectionId:generation}:undefined,current);
    const revertHost=new RevertHost(()=>store&&session&&queueRunner&&ready&&!connecting?{session,queue:queueRunner,connectionId:generation}:undefined,current,drafts,async preview=>await vscode.window.showWarningMessage('回退到此回合之前？',{modal:true,detail:`将从持久对话历史中移除所选回合及之后共 ${preview.count} 个回合，包含所选回合的提问和回复。\n所选回复：${preview.preview}\n\n当前草稿、附件和本地队列保留；队列暂停。磁盘文件不会恢复。此操作不能撤销。`},'确认回退对话')==='确认回退对话');
    const servicesHost=new ServiceStatusHost(()=>store&&session&&ready&&!connecting?{session,connectionId:generation}:undefined,current);
    const accountLimitsHost=new AccountLimitsHost(()=>dailyStore&&session&&accountLimits?{rpc:session.rpc,cache:accountLimits,threadId:draftThread(),connectionId:generation,ready:ready&&session.isConnected&&!connecting}:undefined,current);
    const fileReferences=new FileReferenceHost(root!,()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]}:undefined,current,openReferencedText,pattern=>findReferencedFiles(root!,pattern),openReferencedFile);
    const imageExporter=new ImageExporter(root,m=>current()?(m.source==='draft'?draftImageOwner({threadId:draftThread(),connectionId:generation},drafts.read(draftThread())):session?.projection.threadId?projectionImages({threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]}):undefined):undefined,async(kind,name)=>{const uri=await vscode.window.showSaveDialog({saveLabel:'保存图片',filters:{图片:kind==='jpg'?['jpg','jpeg']:[kind]},defaultUri:vscode.Uri.file(join(root,name))});if(uri&&uri.scheme!=='file')throw Error('只能保存到工作区的本地文件');return uri?.fsPath;},text=>vscode.env.clipboard.writeText(text));
    const formulaExporter=new FormulaExporter(root!,()=>current()&&session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]}:undefined,async(kind,name)=>{const uri=await vscode.window.showSaveDialog({saveLabel:'保存 '+kind.toUpperCase(),filters:{[kind.toUpperCase()]:[kind]},defaultUri:vscode.Uri.file(join(root!,name))});if(uri&&uri.scheme!=='file')throw Error('只能保存到工作区的本地文件');return uri?.fsPath;});
    let submissions:SubmissionHost|undefined,submissionSession:Session|undefined;
    return async(message:any) => {
      if(!current())return;
      if(await dictation.handle(message,m=>post(m)))return;
      if(message.type==='image-state-ack'){if(message.connectionId===generation&&pageImages.acknowledge(message))await publish();return;}
      if(message.type==='attachment-cancel'){if(message.threadId===draftThread()&&message.connectionId===generation)attachmentPreparations.cancel(message);return;}
      if(await environmentHost.handle(message,m=>post(m)))return;
      if(await nativeDiffHost.handle(message,m=>post(m)))return;
      if(await compactionHost.handle(message,m=>post(m))){await publish();return;}
      if(await revertHost.handle(message,m=>post(m))){await publish();return;}
      if(await servicesHost.handle(message,m=>post(m)))return;
      if(await accountLimitsHost.handle(message,m=>post(m)))return;
      if(await fileReferences.handle(message,m=>post(m)))return;
      if(await modelsHost.handle(message,m=>post(m))){await publish();return;}
      if(await modesHost.handle(message,m=>post(m))){await publish();return;}
      if(await permissionsHost.handle(message,m=>post(m))){await publish();return;}
      if(await skillsHost.handle(message,m=>post(m))){await publish();return;}
      if(message.type==='editor-context'&&message.action==='import'){await attachmentPreparations.run(message,active=>editorAttachments.handle(message,()=>({threadId:draftThread(),connectionId:generation}),()=>current()&&active(),m=>post(m)));return;}
      if(await editorAttachments.handle(message,()=>({threadId:draftThread(),connectionId:generation}),current,m=>post(m)))return;
      if(await editorCapture.handle(message,()=>({threadId:draftThread(),connectionId:generation}),current,m=>post(m)))return;
      if(session&&queueRunner){const active=session;if(submissionSession!==active){submissionSession=active;submissions=new SubmissionHost(queueRunner,drafts,active,()=>({threadId:active.projection.threadId,connectionId:generation,threads:draftThreads()}),()=>current()&&session===active,async()=>await vscode.window.showWarningMessage('确认已经核对公开历史中的发送结果？移出此项只会清理本地队列，不会撤销已发送消息，也不会重发。',{modal:true},'已核对，移出队列')==='已核对，移出队列');}if(await submissions!.handle(message,m=>post(m))){await publish();return;}}
      if(await handleSearchHistory(searchHistory,message,m=>post(m),current))return;
      if(await handleRailView(railViews,message,m=>post(m),()=>session&&draftThreads().includes(session.projection.threadId)?{threadId:session.projection.threadId,connectionId:generation,turnIds:session.outline.snapshot(session.projection).nodes.map(v=>v.turnId)}:undefined,current))return;
      if(await replies.handle(message,m=>post(m))){await publish();return;}
      if(message.type==='attachment-import'&&!attachmentStorage){await post({type:'attachment-imported',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:false,error:'当前未启用受控附件导入；可使用“工作区图片”选择已有 PNG/JPEG，仅保存在本地草稿'});return;}
      if(attachmentStorage&&message.type==='attachment-import'){await attachmentPreparations.run(message,active=>handleAttachmentImport(root,message,()=>({threadId:draftThread(),connectionId:generation}),()=>current()&&active(),m=>post(m),attachmentStorage.import));await publish();return;}
      if(await draftHost.handle(message,m=>post(m)))return;
      if(await scrollHost.handle(message,m=>post(m)))return;
      if(await handleDisplaySettings(displaySettings,message,m=>post(m),current)){if(message.type==='settings-save'&&message.key==='attachmentStore.maxTotalMB'){await attachmentStorage?.maintain();await publish();}return;}
      if(await handleWorkFold(workFolds,message,m=>post(m),()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()],turns:[...session.projection.turns.values()]}:undefined,current,()=>displaySettings.read().foldMemory&&displaySettings.read().workSegments))return;
      if(await handleChangedFilesFold(changedFileFolds,message,m=>post(m),()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()],turns:[...session.projection.turns.values()]}:undefined,current,()=>displaySettings.read().foldMemory))return;
      if(await handleChangedReview(changedReviews,message,m=>post(m),()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()],turns:[...session.projection.turns.values()]}:undefined,current))return;
      if(await handleToolExpansion(toolExpansions,message,m=>post(m),()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]}:undefined,current,()=>displaySettings.read().expandMemory))return;
      if(await handleBlockFold(blockFolds,message,m=>post(m),()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]}:undefined,current,()=>displaySettings.read().foldMemory))return;
      if(await handleUserFold(userFolds,message,m=>post(m),()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]}:undefined,current,()=>displaySettings.read().foldMemory))return;
      if(await handleMessageCopy(message,()=>session?{threadId:session.projection.threadId,connectionId:generation,items:[...session.projection.items.values()]}:undefined,current,text=>vscode.env.clipboard.writeText(text),m=>post(m)))return;
      const epoch = generation;
      const messageThread=draftThread();
      if(await handleThreadReadState(catalog,message,()=>session?{connectionId:generation,threadId:session.projection.threadId,owned:store?.read().threads??[],ready:ready&&!connecting&&session.isConnected,busy:session.busy,operating:session.isOperating,loaded:!session.sendOutcomeUncertain&&session.toolCheck.verified&&session.toolCheck.threadId===session.projection.threadId,visible:target.visible&&pageReady&&vscode.window.state?.focused===true}:undefined,current,m=>post(m))){await publish();return;}
      try {
        switch (message.type) {
          case 'attachment-storage-check': {
            if(!Number.isSafeInteger(message.id)||message.id<1)return;
            if(storageCheckPage!==pageId){storageCheckPage=pageId;lastStorageCheck=0;}
            if(message.id<=lastStorageCheck)return;lastStorageCheck=message.id;
            const status=await attachmentStorage?.maintain();
            if(current()&&epoch===generation)await post({type:'attachment-storage-result',id:message.id,status});
            await publish();return;
          }
          case 'formula-component': {
            const matches=Number.isSafeInteger(message.id)&&message.id>0&&!!session?.projection.threadId&&message.connectionId===generation&&message.threadId===session.projection.threadId;
            if(!matches){await post({type:'formula-component',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:false});return;}
            try{const code=await readFile(join(context.extensionPath,'dist/mathjax-tex-svg.js'),'utf8');await post({type:'formula-component',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:true,code});}
            catch{await post({type:'formula-component',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:false});}return;
          }
          case 'image-origin-read': {
            try{const result=await imageExporter.readOrigin(message as ImageSourceRequest);await post({type:'image-origin-result',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:true,result});}
            catch(error){await post({type:'image-origin-result',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:false,error:error instanceof Error?error.message:'原动图读取失败'});}return;
          }
          case 'image-frame-copy': {
            try{const result=await imageExporter.copyFrame(message as ImageFrameRequest);await post({type:'image-frame-copied',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:true,result});}
            catch(error){await post({type:'image-frame-copied',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:false,error:error instanceof Error?error.message:'帧PNG复制失败'});}return;
          }
          case 'image-export': {
            try{const result=await imageExporter.handle(message as ImageRequest);await post({type:'image-exported',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:true,result});}
            catch(error){await post({type:'image-exported',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:false,error:error instanceof Error?error.message:'图片操作失败'});}return;
          }
          case 'file-action': {
            try{const result=await fileActions.handle(message as FileActionRequest);await post({type:'file-action-result',id:message.id,threadId:message.threadId,connectionId:message.connectionId,...(message.source==='body'?{source:'body',turnId:message.turnId,itemId:message.itemId}:{}),ok:true,result});}
            catch(error){await post({type:'file-action-result',id:message.id,threadId:message.threadId,connectionId:message.connectionId,...(message.source==='body'?{source:'body',turnId:message.turnId,itemId:message.itemId}:{}),ok:false,invalidFile:error instanceof InvalidDraftFile,error:error instanceof Error?error.message:'文件操作失败'});}return;
          }
          case 'formula-export': {
            try{const result=await formulaExporter.handle(message as FormulaRequest);await post({type:'formula-exported',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:true,result});}
            catch(error){await post({type:'formula-exported',id:message.id,threadId:message.threadId,connectionId:message.connectionId,ok:false,error:error instanceof Error?error.message:'公式导出失败'});}return;
          }
          case 'ready': pageReady=true;if(dailyStore&&!connectionAttempted)void connect();break;
          case 'offline-experience-open': await openOfflineExperience();return;
          case 'search-query': {
            const active=session;if(!active||message.connectionId!==epoch||!Number.isSafeInteger(message.id)||message.id<1||typeof message.query!=='string'||!['thread','workspace'].includes(message.scope)||typeof message.includeTools!=='boolean')throw Error('搜索请求条件或身份无效');
            if(message.scope==='thread'&&message.threadId!==active.projection.threadId){await post({type:'search-result',id:message.id,connectionId:epoch,ok:false,error:'搜索起点会话已变化，请重新查询'});return;}
            await active.searchHistory(message.query,message.scope,message.includeTools,message.id,()=>current()&&session===active&&epoch===generation);break;
          }
          case 'search-cancel': if(session&&message.connectionId===epoch&&Number.isSafeInteger(message.id)&&message.id>0)session.cancelSearch(message.id);return;
          case 'outline-scan': {
            const active=session;if(!active?.projection.threadId)throw Error('尚未打开聊天会话；本地草稿没有历史或轨道，可使用离线交互体验');if(message.connectionId!==epoch||message.threadId!==active.projection.threadId)throw Error('回合表请求身份已失效');await active.scanOutline(()=>current()&&session===active&&epoch===generation);break;
          }
          case 'navigate-cancel': if(session&&message.threadId===session.projection.threadId&&message.connectionId===epoch)session.cancelNavigation();return;
          case 'navigate': {
            const active=session;if(!active||message.connectionId!==epoch||message.threadId!==active.projection.threadId||!Number.isSafeInteger(message.id)||message.id<1||typeof message.turnId!=='string'||message.itemId!==undefined&&typeof message.itemId!=='string')throw Error('导航请求身份无效');
            const live=()=>current()&&session===active&&epoch===generation;
            let result;try{result=await active.materialize(message.turnId,message.itemId,live);}catch(error){result={status:'unavailable',reason:error instanceof Error?error.message:'目标暂不可用'};}if(live()){await publish();await post({type:'navigation-result',id:message.id,threadId:message.threadId,connectionId:epoch,turnId:message.turnId,...result});}return;
          }
          case 'history-older':
          case 'history-items': {
            const active=session;if(!active||message.connectionId!==epoch||message.threadId!==active.projection.threadId)throw Error('历史分页请求身份已失效');
            const live=()=>current()&&session===active&&epoch===generation;
            if(message.type==='history-older')await active.loadOlderHistory(live);
            else{if(typeof message.turnId!=='string'||!message.turnId||message.turnId.length>256)throw Error('回合身份无效');await active.loadTurnItems(message.turnId,live);}break;
          }
          case 'thread-list': {
            if(!session||message.connectionId!==epoch||typeof (message.query??'')!=='string'||(message.query??'').length>160)throw Error('会话列表请求身份或条件无效');
            await session.refreshThreads({more:message.more===true,archived:message.archived===true,query:message.query??''},current);break;
          }
          case 'thread-sort': {
            if(session?.busy||session?.isOperating||message.connectionId!==epoch)throw Error('排序身份已失效');await catalog.setSort(message.sort);break;
          }
          case 'thread-reorder': {
            if(session?.busy||session?.isOperating||message.connectionId!==epoch||typeof message.threadId!=='string'||message.before!==undefined&&typeof message.before!=='string')throw Error('排序身份无效');
            await catalog.reorder(catalog.snapshot(store?.read().threads??[]).sessions.map(v=>v.id),message.threadId,message.before);break;
          }
          case 'thread-manage': {
            const active=session,kind=message.action as ThreadMutation;
            if(!active||message.connectionId!==epoch||!['rename','archive','unarchive','delete'].includes(kind)||typeof message.threadId!=='string'||!Number.isSafeInteger(message.id)||message.id<1)throw Error('会话操作请求无效');
            const live=()=>current()&&session===active&&generation===epoch;
            try{
              if(kind==='delete'){
                const notice=catalog.get(message.threadId)?.localOnly?'移除此空会话的本地记录？该会话没有已保存的Codex历史；草稿和阅读/折叠记忆将一并清理。':'永久删除此会话的Codex历史？本地文件改动不会恢复。草稿和阅读/折叠记忆将一并清理。';
                const confirmed=await vscode.window.showWarningMessage(notice,{modal:true},'永久删除');
                if(!live())return;
                if(confirmed!=='永久删除'){await post({type:'thread-result',id:message.id,connectionId:epoch,cancelled:true});return;}
              }
              await active.manageThread(kind,message.threadId,live,message.name);
              if(kind==='delete')try{await purgeMetadata(message.threadId);}catch(error){const notice=error instanceof Error?error.message:String(error);active.error=notice;await post({type:'thread-result',id:message.id,connectionId:epoch,ok:true,cleanupPending:true,error:notice});await publish();return;}
              if(kind==='unarchive'&&live())await active.restore(message.threadId);
              await post({type:'thread-result',id:message.id,connectionId:epoch,ok:true});
            }catch(error){await post({type:'thread-result',id:message.id,connectionId:epoch,ok:false,unknown:!!catalog.get(message.threadId)?.pending,error:error instanceof Error?error.message:String(error)});throw error;}
            break;
          }
          case 'new': if(!store)throw Error('当前仅连接核对；尚未配置获准的会话与发送额度，不创建聊天线程');dictation.cancel();await session?.newThread(); break;
          case 'restore': {
            const active=session,selection=message.selectionId;
            if(selection!==undefined&&(!Number.isSafeInteger(selection)||selection<1||message.connectionId!==epoch))return;
            const selected=(ok:boolean)=>selection!==undefined&&current()&&epoch===generation&&active===session?post({type:'session-selected',id:selection,threadId:message.threadId,connectionId:epoch,ok}):Promise.resolve(false);
            try{if(!active||typeof message.threadId!=='string')throw Error('会话切换目标或连接无效');dictation.cancel();await active.restore(message.threadId);await publish();await selected(true);}
            catch(error){await selected(false);throw error;}break;
          }
          case 'restart': if (session?.busy && !session.approvals.size&&!session.waitingForUserInput) throw new Error('先停止生成，再重启本连接'); await connect(); break;
          case 'send': {
            const active=session,reply=(ok:boolean,unknown=false)=>post({type:'sent',viewId:message.viewId,requestId:message.requestId,threadId:message.threadId,connectionId:message.connectionId,ok,unknown});
            if(!store){await reply(false);throw Error(CONNECTION_ONLY_REASON);}
            if(!current()||message.mode!==undefined&&message.mode!=='send'||!validSendFiles(message)||!matchesSendRequest(message,active?.projection.threadId?{threadId:active.projection.threadId,connectionId:epoch}:undefined)){await reply(false);return;}
            let begun=false,started=false;const cancellationVersion=active!.cancellationVersion;
            try{
              await drafts.begin(message.threadId,message.text,message.image||'',message.imageToken,message.files,message.extraImages,message.skill,message.draftEditId);begun=true;
              const ownerCurrent=()=>current()&&epoch===generation&&active===session&&active?.projection.threadId===message.threadId;
              const canDispatch=()=>ownerCurrent()&&active!.cancellationVersion===cancellationVersion;
              if(!ownerCurrent())throw Error('发送准备期间身份已失效，未提交轮次');
              if(canDispatch())started=await active!.send(message.text,message.image||undefined,message.files,message.extraImages,canDispatch,message.imageProofs,message.skill,message.clientUserMessageId);
              if(catalog.get(message.threadId)?.deleted)return;
              await drafts.finish(message.threadId,message.text,message.image||'',started,message.imageToken,message.files,message.extraImages,message.skill,message.draftEditId);
              if(epoch===generation&&active===session&&current()&&messageThread===session?.projection.threadId)await reply(started);
            }
            catch(e){if(catalog.get(message.threadId)?.deleted)return;let unknown=started||!!active?.sendOutcomeUncertain||(!begun&&drafts.read(message.threadId).uncertain);if(begun&&!unknown)try{await drafts.finish(message.threadId,message.text,message.image||'',false,message.imageToken,message.files,message.extraImages,message.skill,message.draftEditId);}catch{unknown=true;}if(epoch===generation&&active===session&&current())await reply(false,unknown);throw e;}break;
          }
          case 'stop': if(message.threadId!==messageThread||message.connectionId!==epoch)return;attachmentPreparations.cancel(message);await session?.cancel(); break;
          case 'decision': {
            if (!session || (typeof message.id !== 'number' && typeof message.id !== 'string') || typeof message.accept !== 'boolean' || typeof message.callbackToken !== 'string') throw new Error('审批已失效：缺少本次审批标识或连接已关闭');
            await session.decide(message.id, message.accept, message.callbackToken); break;
          }
          case 'native-input': {
            const reply=(ok:boolean,error?:string)=>post({type:'native-input-result',sequence:message.sequence,requestId:message.requestId,callbackToken:message.callbackToken,threadId:message.threadId,connectionId:message.connectionId,ok,...(error?{error}:{})});
            try{if(!session||message.threadId!==session.projection.threadId||message.connectionId!==epoch||!Number.isSafeInteger(message.sequence)||message.sequence<1||!['string','number'].includes(typeof message.requestId)||typeof message.callbackToken!=='string'||!['answer','skip','stop'].includes(message.action))throw Error('原生问题页面或连接已失效，未提交回答');await session.answerUserInput(message.requestId,message.callbackToken,message.action,message.answers);await reply(true);}
            catch(error){await reply(false,error instanceof Error?error.message:'回答未确认，未自动重发');}break;
          }
          case 'image': {
            if(message.threadId!==messageThread||message.connectionId!==epoch)throw Error('图片草稿身份已失效');
            if(!root)throw Error('请先打开包含该图片的本地文件夹；不会读取其他位置');
            const picked = typeof message.path === 'string' && message.path.trim() ? [vscode.Uri.file(await imageInput(root!, message.path.trim()))] : await vscode.window.showOpenDialog({defaultUri: vscode.Uri.file(root!), canSelectMany: false, filters: {图片: ['png', 'jpg', 'jpeg']}});
            if (picked?.[0]) { const path = await imageInput(root, picked[0].fsPath); const image=await checkedImage(root,path,'draft');if(!image.src)throw Error(image.error);if(epoch===generation&&messageThread===draftThread())await post({type: 'attached', path, preview:image.src,threadId:messageThread,connectionId:epoch}); } break;
          }
          case 'copy-display': {
            await handleDisplayCopy(message,()=>session?{threadId:session.projection.threadId,connectionId:generation}:undefined,current,text=>vscode.env.clipboard.writeText(text),post);return;
          }
        }
      } catch (e) { if (current() && epoch === generation){const error=e instanceof Error?e.message:String(e);if(session)session.error=error;else connectionError=error;} await publish(); }
      await publish();
    };
    }
    let receive=bindPage(),sessionActions:Promise<unknown>=Promise.resolve(),sessionActionOwner=-1;
    target.webview.onDidReceiveMessage(message=>{
      if(view!==target)return;
      if(message?.type==='ready'){
        if(typeof message.pageId!=='string'||!/^[0-9a-f-]{36}$/i.test(message.pageId))return;
        if(message.pageId===pageId)return;
        if(pageId&&queueRunner&&session?.projection.threadId)void queueRunner.pause(session.projection.threadId,'页面已Reload；核对后手动继续本地队列');pageId=message.pageId;replyHost?.stop();receive=bindPage();
      }else if(!pageId||message?.pageId!==pageId)return;
      if(['new','restore','thread-manage'].includes(message?.type)){
        // UI state publication is asynchronous: two enabled gestures can arrive
        // before Session exposes its operating lock. Preserve their order, while
        // stop/cancel/draft traffic remains immediate and old owners cannot replay.
        const handler=receive,documentId=pageId,epoch=generation;
        if(epoch!==sessionActionOwner){sessionActionOwner=epoch;sessionActions=Promise.resolve();}
        const task=sessionActions.then(()=>{if(view!==target||pageId!==documentId||generation!==epoch)return;return handler(message);});
        sessionActions=task.catch(()=>{});return task;
      }
      return receive(message);
    });
    // Bind all host listeners before the page can issue its startup reads.
    target.webview.html=html(randomBytes(16).toString('hex'),{vendor:vendor!,display:display!});
  }
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('codexPrototype.chat',{resolveWebviewView:resolveView},{webviewOptions:{retainContextWhenHidden:true}}));
  async function open(){await vscode.commands.executeCommand('codexPrototype.chat.focus');view?.show(true);}
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.open', open));
  const toolbarAction=(action:'refresh'|'reconnect'|'sort',sort?:'persisted'|'activity')=>{
    if(view?.visible&&pageReady&&pageId)return view.webview.postMessage({type:'session-toolbar',pageId,connectionId:generation,action,...(sort?{sort}:{})});
  };
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.refreshSessions',()=>toolbarAction('refresh')),vscode.commands.registerCommand('codexPrototype.reconnect',()=>toolbarAction('reconnect')),vscode.commands.registerCommand('codexPrototype.sortSessions',async()=>{
    if(!view?.visible||!pageReady||!pageId)return;const owner=pageId,connection=generation;
    const selected=catalog.snapshot(store?.read().threads??[]).sort;
    const choice=await vscode.window.showQuickPick([{label:'手动排序',description:selected==='persisted'?'当前；可拖动会话标签':'可拖动会话标签',sort:'persisted' as const},{label:'最近活动',description:selected==='activity'?'当前':'按最近活动排列',sort:'activity' as const}],{title:'会话排序',placeHolder:'仅调整本插件的会话排列'});
    if(choice&&owner===pageId&&connection===generation)return toolbarAction('sort',choice.sort);
  }));
  // Read-only diagnostic command in this experimental extension, useful to the owned dev-host probe.
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.inspect', ()=>publicState()));
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.showBuildInfo',async()=>{await vscode.window.showInformationMessage(`Codex ${environmentMetadata.extensionVersion??'development'} · ${context.extensionPath} · SHA256 ${loadedBundleSha256}`);}));
  context.subscriptions.push(vscode.commands.registerCommand('codexPrototype.audit', () => session?.audit()));
  // The isolated offline launcher may reveal the same daily page; demos are a separate command.
  if(process.env['CODEX_PROTOTYPE_MODE']==='offline')void open();
}
export async function deactivate(): Promise<void> { stopHost();const old = session; session = undefined; await old?.dispose(); }
