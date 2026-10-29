/** Existing page interactions. The injected host owns only message transport. */
import type { displayLibrary } from './display/browser-entry';
import type { FormulaExport, FormulaExportResult } from './display/dsh-math-export';
import type { PageHost } from './page-host';
import {isPageItem,inputUnavailableText,pageContentReady,type PageLocalImage,type PageState} from './page-model';
import {composerSendReason,composerNoticeReason,hasDispatchCapacity} from './composer-reasons';
import {EditorAttachmentControl} from './display/editor-attachment-control';
import {EditorCaptureControl} from './display/editor-capture-control';
import {DictationControl} from './display/dictation-control';
import {RevertBridge} from './display/revert-bridge';
import {insertDictation} from './dictation-types';
import {appendEditorCapture} from './editor-capture-types';
import {NativeTurnControl} from './display/native-turn-control';
import {CompactionControl} from './display/compaction-control';
import {DraftRecoveryPanel} from './display/draft-recovery';
import {NativeSkills} from './display/native-skills';
import type {SkillReference} from './skill-reference';
import type { DraftFile, DraftImage } from './draft-store-types';
import type {ImageProof} from './attachment-policy';
import {SessionBar} from './display/session-bar';
import {HistoryControls} from './display/history-controls';
import {TurnRail} from './display/turn-rail';
import {SearchPanel} from './display/search-panel';
import {SessionSelection} from './display/session-selection';
import {QueuePanel} from './display/queue-panel';
import {originDescription} from './image-formats';
import {DraftAnimation} from './display/draft-animation';
import {bindOriginalAnimation,type DisplayImage} from './display/image-preview';
import {ModelPicker} from './display/model-picker';
import {PermissionPicker} from './display/permission-picker';
import {NativeUserInputPanel} from './display/native-user-input-panel';
import {FileReferenceBridge} from './display/file-reference-bridge';
import {isToolDisplayItem} from './tool-display';
import {ChangedFiles} from './display/changed-files';
import {renderQuestionRecord} from './display/question-record';
import {agentPublicText} from './public-questions';
import {clearSearchHighlights} from './display/search-highlights';
import {BodyWindowPrototype} from './display/body-window-prototype';
import {rowIdentity} from './display/body-window-units';
import {PendingSendEcho} from './display/pending-send-echo';
import {CodexWelcome} from './display/codex-presence';
type DisplayLibrary = typeof displayLibrary;
// These preferences are applied outside message articles. Actual dimensions
// still invalidate the window's height calibration when the column changes.
const NON_BODY_SETTINGS=new Set(['animationStyle','contentMaxWidth','previewMinScale','previewMaxScale','busyEnter','sessionTabMinWidth','sessionTabRenameButton','sessionTabArchiveButton','attachmentBatchMaxFiles','attachmentBatchMaxTotalMB','hintSeconds','historyLoadAll','historyMaxMessages','railScrollbar','railNodeBadge','attachmentMaxTotalMB','railMinGap','railDragEdgePx','railDragSpeed','railSummaryLength','railNumberStyle','railTipTwoLine','railMarkNoteOnly','railMarkColor','searchHighlightColor','searchSnippetView','searchResultOrder','searchReturnPill','searchReturnPillSeconds']);
/** Public PageState values are JSON data; compare without serializing every old body on each page. */
function samePublicValue(left:unknown,right:unknown):boolean{
    if(left===right)return true;
    if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
    const a=left as Record<string,unknown>,b=right as Record<string,unknown>,keys=Object.keys(a);
    return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&samePublicValue(a[key],b[key]));
}
type SendSnapshot = {
    clientUserMessageId?:string;
    mode?: 'queue'|'steer';
    queueId?: string;
    expectedTurnId?: string;
    viewId: string;
    requestId: number;
    threadId: string;
    connectionId: number;
    text: string;
    image: string;
    imageToken: string;
    draftEditId?: string;
    extraImages: DraftImage[];
    imageProofs: ImageProof[];
    files?: DraftFile[];
    skill?: SkillReference;
    attachmentVersion: number;
};
type Pending<T> = {
    resolve: (value: T) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
    epoch: number;
};
type PageElements = Record<'composer' | 'history' | 'usage-control' | 'scroll-status' | 'draft-memory-status' | 'draft-recovery' | 'draft-status' | 'copy-status' | 'composer-model' | 'usage' | 'tools' | 'status' | 'error' | 'approvals' | 'attachment-status' | 'experience' | 'experience-note', HTMLElement> & Record<'send' | 'stop' | 'attach' | 'new' | 'restore' | 'restart' | 'draft-retry' | 'draft-review' | 'experience-open', HTMLButtonElement> & {
    prompt: HTMLTextAreaElement;
    threads: HTMLSelectElement;
};
declare global {
    interface Window {
        __codexDisplay: DisplayLibrary & {
            startPage: (sendAckTimeoutMs:number,formulaExportTimeoutMs:number) => void;
        };
        __prototypeState: PageState;
        __prototypePlain?: boolean;
    }
}
/** Called once, after the existing vendor/display scripts and HTML have loaded. */
export function startPage(host:PageHost,sendAckTimeoutMs: number, formulaExportTimeoutMs: number): void {
    // Announce the new document before component reads, with every listener already bound.
    const transport=host,startup:unknown[]=[];let mounted=false;
    host={messages:transport.messages,postMessage:message=>mounted?transport.postMessage(message):startup.push(message)};
    const by = <K extends keyof PageElements>(id: K) => document.getElementById(id) as PageElements[K];
    let state: PageState;
    let attachment = '', attachmentVersion = 0, pathInput = '';
    const action = (type: string, extra: object = {}) => host.postMessage({ type, ...extra });
    const display = window.__codexDisplay, preview = new display.ImagePreview(() => display.previewLimits(state?.copySettings),()=>state?.copySettings?.gifAutoplay!==false);
    let owner = '', viewEpoch = 0, copyId = 0;
    // Only the current body's articles are retained. Paging/status receipts must
    // not recreate every earlier Markdown tree and its listeners.
    let bodyContext = '';
    let bodyRows = new Map<string, {signature:string;row:PageState['items'][number];article:HTMLElement}>();
    let componentFrame: number | undefined;
    // Several independent fold reads can arrive together. Refresh the current
    // body once in that frame so their acknowledgements and draft reads remain
    // responsive; host state/owner changes still render immediately.
    function refreshComponents() {
        if (!state || componentFrame !== undefined) return;
        componentFrame = requestAnimationFrame(() => { componentFrame = undefined; if (state) render(state, true); });
    }
    let draftChip: InstanceType<DisplayLibrary['DraftImageChip']>, attachmentInput: InstanceType<DisplayLibrary['AttachmentInput']>;
    let animations:DraftAnimation|undefined;
    let editorAttachment:EditorAttachmentControl|undefined;
    let editorCapture:EditorCaptureControl|undefined;
    let dictation:DictationControl|undefined;
    let nativeSkills:NativeSkills|undefined;
    let welcome:CodexWelcome|undefined;
    const copies = new Map<number, Pending<void>>();
    const usageDetails = new display.UsageDetailsControl(by('composer'),host);
    by('usage-control').append(usageDetails.element);
    const column = new display.ContentColumn(by('history')), promptComposer = new display.PromptComposer(by('prompt'), by('send'));
    const pendingEcho=new PendingSendEcho(by('history'),()=>state?.dispatchMode==='daily',true,(row,choice)=>userFolds.adopt([state.threadId,row.turnId,row.item.id],choice));
    const modelPicker=new ModelPicker(host,by('composer-model'),()=>updateSend());
    const permissionPicker=new PermissionPicker(host,by('composer'),()=>updateSend());
    const userInputPanel=new NativeUserInputPanel(host,by('composer'));
    column.apply();
    const activity = new display.ActivityIndicator();
    const scrollView = new display.ConversationScroll(by('history'), host, text => { const visible=state?.dispatchMode==='daily'&&text.startsWith('正在通过公开历史恢复阅读停点')?'':text;by('scroll-status').textContent = visible; by('scroll-status').hidden = !visible; });
    const bodyWindow=new BodyWindowPrototype(by('history'),preserveAnchor=>{if(state){scrollView.prepareBodyWindow(preserveAnchor);render(state,true);}},change=>scrollView.bodyWindowLayout(change));scrollView.connectBodyWindow(bodyWindow);
    new HistoryControls(host,by('history'));
    let sendSequence = 0, pendingSend: SendSnapshot | undefined, sendTimer: ReturnType<typeof setTimeout> | undefined;
    const sendViewId = crypto.randomUUID(), sendAckTimeout = sendAckTimeoutMs;
    function resetPendingSend() { clearTimeout(sendTimer); sendTimer = undefined; pendingSend = undefined; by('draft-status').textContent = ''; }
    let preparingSend = false, preparationSequence=0, focusDraft = false;
    let queuePanel:QueuePanel|undefined;
    let railPanel:TurnRail|undefined;
    let recoveryPanel:DraftRecoveryPanel|undefined;
    const drafts = new display.DraftMemory(m => host.postMessage(m), () => { by('draft-memory-status').textContent = pendingSend||state?.dispatchMode==='daily'&&drafts.notice==='正在恢复草稿…' ? '' : drafts.notice; by('draft-retry').hidden = !drafts.canRetry; by('draft-review').hidden = !!pendingSend || !drafts.needsReview; by('draft-recovery').hidden = !by('draft-memory-status').textContent && !drafts.canRetry && !drafts.needsReview; recoveryPanel?.refresh(); updateSend(); draftChip?.refresh(); attachmentInput?.refresh(); if (focusDraft && drafts.ready) {
        focusDraft = false;
        if (([by('restore'), by('threads')] as (Element | null)[]).includes(document.activeElement)) {
            by('prompt').focus({ preventScroll: true });
            const end = by('prompt').value.length;
            by('prompt').setSelectionRange(end, end);
        }
    } }, (v, _src) => { by('prompt').value = v.text; pathInput = v.pathInput; attachment = v.image; attachmentVersion++; promptComposer.resize(); draftChip?.refresh(); attachmentInput?.refresh(); });
    function rememberDraft(preview?: string) { drafts.edit({ text: by('prompt').value, image: attachment, pathInput }, preview); }
    draftChip = new display.DraftImageChip(() => drafts.images.map(v => ({ threadId: state?.threadId || '', connectionId: state?.connectionId, image: { id: v.token, name: drafts.originFor(v.token)?.name || v.path.split(/[\\/]/).at(-1) || '', src: drafts.previewFor(v.token) || undefined }, path: v.path, error: drafts.errorFor(v.token), animation:animations?.source(v.token), originalName: drafts.originFor(v.token)?.name, note: drafts.originErrorFor(v.token)||(drafts.originFor(v.token)?originDescription(drafts.originFor(v.token)!):''), format: state?.copySettings?.imageCopyFormat || 'original' })), preview, token => { if (!attachmentInput?.busy&&!animations?.remove(token))
        drafts.removeImage(token); }, token => drafts.imageFailed(token), async (kind, token) => { const identity = owner, src = drafts.previewFor(token); if (!await drafts.flush() || identity !== owner || !src || drafts.errorFor(token) || src !== drafts.previewFor(token))
        throw Error('图片草稿已改变或保存未确认'); const bytes = Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), v => v.charCodeAt(0)), digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join(''); if (identity !== owner || !drafts.images.some(v => v.token === token) || src !== drafts.previewFor(token))
        throw Error('图片草稿已改变'); return imageExports.runDraft(token, kind, digest); },token=>animations?.pick(token));
    const fileActions = new display.FileActionBridge(host, () => ({ threadId: state?.threadId || '', connectionId: state?.connectionId }));
    const fileReferences=new FileReferenceBridge(host,()=>({threadId:state?.threadId||'',connectionId:state?.connectionId}),(source,current)=>preview.openReference(source,current));
    const referenceOpener=(turnId:string,itemId:string)=>state?.fileReferencesEnabled?(reference:import('./file-reference').FileReference)=>fileReferences.run(reference,turnId,itemId):undefined;
    attachmentInput = new display.AttachmentInput(host, () => ({ threadId: state?.threadId || '', connectionId: state?.connectionId }), () => drafts.ready, () => state?.attachmentImportAvailable!==false, () => drafts.files, files => drafts.setFiles(files), (images, files, owner) => drafts.addAttachments(images, files, owner), () => updateSend(), () => drafts.images.length, { error: path => drafts.fileErrorFor(path), invalid: path => drafts.fileFailed(path), removed:file=>editorAttachment?.removed(file), run: async (file, kind) => { const identity = owner; if (!await drafts.flush() || identity !== owner || !drafts.files.some(v => v.path === file.path && v.sha256 === file.sha256))
            throw Error('文件草稿已改变或保存未确认'); return fileActions.run(file, kind); } },()=>({maxFiles:state?.copySettings?.attachmentBatchMaxFiles,maxTotalMB:state?.copySettings?.attachmentBatchMaxTotalMB}),()=>state?.dispatchMode==='daily');
    function updateSend() { const s = state, value = by('prompt').value, recovery = display.recoverySendReason(s || {}); by('stop').disabled = !s?.busy&&!preparingSend&&!attachmentInput?.busy&&!editorCapture?.busy&&!pendingSend; by('stop').title = preparingSend||attachmentInput?.busy||editorCapture?.busy?'取消准备，已有草稿保留':pendingSend?'停止请求；结果未确认时继续保留草稿':'停止当前回合'; by('prompt').disabled = !drafts.ready; by('attach').disabled = !drafts.ready || s?.attachmentImportAvailable===false; for (const remove of document.querySelectorAll<HTMLButtonElement>('#draft-images .attachment-remove'))
        remove.disabled = !drafts.ready || !!attachmentInput?.busy; by('send').disabled = !!s?.dispatchBlockReason || !!nativeSkills?.blockReason || modelPicker.blocksNewTurn || !!permissionPicker.newTurnBlockReason || !!s?.modelSelection?.saving || !!s?.modeSelection?.saving || preparingSend || attachmentInput?.busy || editorCapture?.busy || dictation?.busy || drafts.blocked || !!pendingSend || !s?.ready || s.busy || !!s.operating || !!recovery || !s.toolCheck?.verified || s.toolCheck.threadId !== s.threadId || !hasDispatchCapacity(s) || (!value.trim() && !drafts.images.length && !drafts.files.length) || value.length > 20000; by('send').title = pendingSend ? '等待发送确认，草稿保留' : recovery || (attachmentInput?.busy ? '正在附加文件，请稍候' : drafts.blocked ? drafts.notice : value.length > 20000 ? '消息最多发送 20000 字符' : '发送（Enter）；Shift+Enter 换行'); updateComposerReasons(); queuePanel?.refresh(); editorAttachment?.refresh(); editorCapture?.refresh(); dictation?.refresh(); nativeSkills?.refresh(); }
    function submitReason(mode:'send'|'queue'|'steer'='send'){return dictation?.busy?'正在听写，请先停止':editorCapture?.busy?'正在读取编辑器上下文，请等待或取消':nativeSkills?.blockReason||composerSendReason(state,{text:by('prompt').value,images:drafts.images.length,files:drafts.files.length,preparing:preparingSend,pending:!!pendingSend,attachmentBusy:!!attachmentInput?.busy,blocked:drafts.blocked,notice:drafts.notice,modelBlocked:modelPicker.newTurnBlockReason||permissionPicker.newTurnBlockReason},mode);}
    function updateComposerReasons(){const reason=submitReason();by('send').title=by('send').disabled?reason:'发送（Enter）；Shift+Enter 换行';by('send').setAttribute('aria-describedby','tools');if(state){by('tools').textContent=composerNoticeReason(state,reason)||(state.dispatchMode==='daily'?'':state.toolCheck?.reason||'');by('tools').hidden=!by('tools').textContent;}by('attach').title=state?.attachmentImportAvailable===false?'当前未启用附件导入；文字草稿仍可编辑':drafts.ready?(state?.dispatchMode==='daily'?'附加图片或文档':'附加图片或文件；文件作为引用，尚未解析'):'草稿尚未恢复，请稍候';for(const id of ['new','restore'] as const)if(by(id).disabled)by(id).title=!state?.ready?'尚未连接，请先核对连接状态':state.busy?'当前回合尚未结束，请先结束或停止当前回合':'草稿或附件尚未确认';else by(id).title=id==='new'?'新建会话':'恢复所选会话';}
    function canSubmitMode(mode:'queue'|'steer'){const s=state,value=by('prompt').value;if(s?.dispatchBlockReason||nativeSkills?.blockReason||!s?.localQueue||!s.ready||!s.threadId||s.operating||s.needsRecovery||preparingSend||pendingSend||attachmentInput?.busy||editorCapture?.busy||dictation?.busy||drafts.blocked||(!value.trim()&&!drafts.images.length&&!drafts.files.length)||value.length>20000)return false;return mode==='queue'?!s.localQueue.blocked&&s.localQueue.items.length<20:!!s.localQueue.steerTurnId&&s.toolCheck?.verified===true&&s.toolCheck.threadId===s.threadId&&hasDispatchCapacity(s);}
    nativeSkills=new NativeSkills(host,by('prompt'),by('composer'),()=>drafts.skill,()=>drafts.ready&&!drafts.restoring&&!preparingSend&&!pendingSend,(skill,text)=>drafts.useSkill(skill,text),()=>updateSend());
    queuePanel=new QueuePanel(host,by('prompt'),by('composer'),canSubmitMode,mode=>void submitRequest(mode),submitReason);
    editorAttachment=new EditorAttachmentControl(host,attachmentInput,()=>drafts.ready&&!drafts.restoring&&!preparingSend&&!pendingSend,()=>drafts.files,files=>drafts.setFiles(files),()=>!drafts.blocked);
    editorCapture=new EditorCaptureControl(host,by('composer'),()=>drafts.ready&&!drafts.restoring&&!preparingSend&&!pendingSend&&!drafts.blocked,text=>{by('prompt').value=appendEditorCapture(by('prompt').value,text);promptComposer.resize();rememberDraft();updateSend();},()=>updateSend());
    const nativeTurnControl=new NativeTurnControl(host,by('composer'));
    const compactionControl=new CompactionControl(host,by('composer'),()=>drafts.ready&&!drafts.restoring&&!preparingSend&&!pendingSend&&!attachmentInput?.busy&&!editorCapture?.busy&&!drafts.blocked);
    usageDetails.attach(compactionControl.action);
    const editableDictation=()=>drafts.ready&&!drafts.restoring&&!preparingSend&&!pendingSend&&!drafts.blocked;
    dictation=new DictationControl(host,by('composer'),editableDictation,text=>{
        if(!editableDictation())return false;
        const prompt=by('prompt'),active=document.activeElement,next=insertDictation(prompt.value,prompt.selectionStart,prompt.selectionEnd,text);
        prompt.value=next.text;prompt.setSelectionRange(next.start,next.end);promptComposer.resize();rememberDraft();
        if(active===document.body||active===prompt||active instanceof HTMLElement&&(active.id==='dictation-open'||!!active.closest('#dictation-bar')))prompt.focus({preventScroll:true});
        updateSend();return true;
    },()=>updateSend());
    by('prompt').addEventListener('input', () => { if (!pendingSend)
        by('draft-status').textContent = ''; rememberDraft(); });
    by('prompt').addEventListener('blur', () => void drafts.flush());
    by('draft-retry').onclick = () => drafts.retry();
    by('draft-review').onclick = () => drafts.review();
    recoveryPanel=new DraftRecoveryPanel(by('draft-recovery'),drafts,by('draft-review'));
    const blockFolds = new display.BlockFoldMemory(host, () => ({ threadId: state?.threadId, connectionId: state?.connectionId }), refreshComponents);
    const userFoldMemory = new display.UserFoldMemory(host, () => ({ threadId: state?.threadId, connectionId: state?.connectionId }), refreshComponents);
    const userFolds = new display.UserMessageFolds(() => by('history'), userFoldMemory);
    const toolCards = new display.ToolCards(), toolMemory = new display.ToolExpansionMemory(host, () => ({ threadId: state?.threadId, connectionId: state?.connectionId }), key => { if (key)
        toolCards.forget(key); refreshComponents(); });
    const workMemory = new display.WorkFoldMemory(host, () => ({ threadId: state?.threadId, connectionId: state?.connectionId }), refreshComponents);
    const changedFilesTail=new ChangedFiles(host,()=>({threadId:state?.threadId||'',connectionId:state?.connectionId}),refreshComponents);
    const userCopy = new display.MessageCopyBridge(host, () => ({ threadId: state?.threadId, connectionId: state?.connectionId })), userActions = new display.MessageActions(by('history'));
    const replyActions = new display.ReplyActionBridge(host, () => ({ threadId: state?.threadId, connectionId: state?.connectionId }), () => userActions.refreshReplies());
    const revertBridge=new RevertBridge(host,()=>({threadId:state?.threadId,connectionId:state?.connectionId}));
    async function revertReply(turn:string,item:string){
        const identity=owner,ready=()=>drafts.ready&&!drafts.restoring&&!drafts.blocked&&!preparingSend&&!pendingSend&&!attachmentInput?.busy&&!editorCapture?.busy&&!dictation?.busy;
        if(!ready()||revertBridge.busy)throw Error('请先完成当前草稿、附件或发送操作');
        if(!await drafts.flush()||identity!==owner||!ready())throw Error('草稿保存未确认，回退未提交');
        scrollView.flush();await revertBridge.run(turn,item);
    }
    async function forkReply(turn: string, item: string) { const identity = owner; scrollView.flush(); if (!await drafts.flush() || identity !== owner || drafts.blocked || pendingSend)
        throw Error('草稿或发送状态未确认，分支禁用'); await replyActions.fork(turn, item); }
    new display.DisplaySettingsPanel(host, copySettings => { if (state) {
        queuePanel?.configure(copySettings.busyEnter);
        const prior = state.copySettings || {}, onlyLayout = (Object.keys(copySettings) as (keyof typeof copySettings)[]).every(k => NON_BODY_SETTINGS.has(k) || copySettings[k] === prior[k]);
        if (onlyLayout) {
            state = { ...state, copySettings };
            window.__prototypeState = state;
            display.applyMotion(copySettings.animationStyle);
            column.apply(copySettings.contentMaxWidth);
            railPanel?.configure(copySettings.railScrollbar,copySettings.railNodeBadge!==false,copySettings);
            if (typeof prior.contentMaxWidth === 'number' && prior.contentMaxWidth !== copySettings.contentMaxWidth)
                scrollView.settleWidth();
            promptComposer.resize();
            preview.applyLimits();
            draftChip.refresh();
        }
        else
            render({ ...state, copySettings }, true);
    } });
    const imageExports = new display.ImageExportBridge(host, () => ({ threadId: state?.threadId, connectionId: state?.connectionId }));
    animations=new DraftAnimation(drafts,attachmentInput,imageExports,preview,()=>owner,()=>state?.copySettings);
    const formulaExports = new Map<number, Pending<FormulaExportResult>>();
    const components = new Map<number, Pending<string>>();
    const formulaExportTimeout = formulaExportTimeoutMs;
    function clearFormulaExports() { for (const map of [formulaExports, components]) {
        for (const p of map.values()) {
            clearTimeout(p.timer);
            p.reject(Error('公式显示身份已失效'));
        }
        map.clear();
    } display.closeMathMenu(); }
    function loadMathJax(): Promise<string> { const id = ++copyId, epoch = viewEpoch; return new Promise((resolve, reject) => { const timer = setTimeout(() => { components.delete(id); reject(Error('SVG组件读取超时')); }, 10000); components.set(id, { resolve, reject, timer, epoch }); action('formula-component', { id, threadId: state.threadId, connectionId: state.connectionId }); }); }
    const onComponent = (e:MessageEvent) => { const m = e.data; if (m.type !== 'formula-component')
        return; const p = components.get(m.id); if (!p)
        return; clearTimeout(p.timer); components.delete(m.id); if (!sameOwner(m) || p.epoch !== viewEpoch || !m.ok || typeof m.code !== 'string' || m.code.length > 4 * 1024 * 1024)
        p.reject(Error('SVG组件读取失败或显示身份失效'));
    else
        p.resolve(m.code); };
    host.messages.addEventListener('message',onComponent);
    function exportFormula(value: FormulaExport & {
        turnId: string;
        itemId: string;
    }): Promise<FormulaExportResult> { const id = ++copyId, epoch = viewEpoch; return new Promise((resolve, reject) => { const saving = value.kind.startsWith('save-'), timer = saving ? undefined : setTimeout(() => { formulaExports.delete(id); reject(Error('公式导出超时')); }, formulaExportTimeout); formulaExports.set(id, { resolve, reject, timer, epoch }); action('formula-export', { ...value, id, threadId: state.threadId, connectionId: state.connectionId }); }); }
    function sameOwner(m: {
        threadId?: string;
        connectionId?: number;
    }) { return state && m.threadId === state.threadId && m.connectionId === state.connectionId; }
    function imageIsCurrent(turnId: string, itemId: string, index: number, original: PageLocalImage) { const row = state?.items.find(v => v.turnId === turnId && v.item.id === itemId); const input = row && isPageItem(row.item,'userMessage') ? row.item.content[index] : undefined; return input?.type === 'localImage' && input.path === original.path && input.displayImage?.id === original.displayImage?.id && input.displayImage?.src === original.displayImage?.src && JSON.stringify(input.displayImage?.originHint)===JSON.stringify(original.displayImage?.originHint); }
    async function bodyImageDigest(turnId:string,itemId:string,index:number,input:PageLocalImage,image:DisplayImage){
        const epoch=viewEpoch,src=display.safeImageSource(image.src),current=()=>epoch===viewEpoch&&imageIsCurrent(turnId,itemId,index,input);
        if(!src||!current())throw Error('图片显示身份已改变');
        const bytes=Uint8Array.from(atob(src.slice(src.indexOf(',')+1)),v=>v.charCodeAt(0)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
        if(!current())throw Error('图片显示身份已改变');return digest;
    }
    async function exportBodyImage(turnId:string,itemId:string,index:number,input:PageLocalImage,image:DisplayImage,kind:'name'|'original'|'png'|'save'){return imageExports.run(turnId,itemId,image.id,kind,undefined,await bodyImageDigest(turnId,itemId,index,input,image));}
    function bindBodyOrigin(card:HTMLElement,image:DisplayImage,turnId:string,itemId:string,index:number,input:PageLocalImage){if(image.originHint?.animated){const origin=image.originHint;bindOriginalAnimation(card,{origin,load:async()=>imageExports.readOrigin(turnId,itemId,image.id,origin.sha256,undefined,await bodyImageDigest(turnId,itemId,index,input,image))});}}
    function copyText(value: string): Promise<void> { const id = ++copyId, epoch = viewEpoch; return new Promise((resolve, reject) => { const timer = setTimeout(() => { copies.delete(id); reject(Error('复制超时')); }, 3000); copies.set(id, { resolve, reject, timer, epoch }); action('copy-display', { id, text: value, threadId: state.threadId, connectionId: state.connectionId }); }); }
    by('new').onclick = () => { scrollView.flush(); void drafts.flush(); action('new'); };
    by('restore').onclick = () => { scrollView.flush(); focusDraft = true; void drafts.flush(); action('restore', { threadId: by('threads').value }); };
    by('restart').onclick = () => { scrollView.flush(); void drafts.flush(); action('restart'); };
    by('experience-open').onclick = () => action(state?.offlinePreview?'offline-experience-return':'offline-experience-open');
    async function submitRequest(mode:'send'|'queue'|'steer'='send'){
        updateSend();const allowed=()=>mode==='send'?!by('send').disabled:canSubmitMode(mode);if(!allowed())return;
        const identity=owner,epoch=viewEpoch,preparation=++preparationSequence,clientUserMessageId=crypto.randomUUID();let prepared=false,imageProofs:ImageProof[]=[];preparingSend=true;drafts.prepareSubmission();
        const echo=()=>pendingEcho.begin(clientUserMessageId,by('prompt').value,drafts.images.map(image=>({name:drafts.originFor(image.token)?.name||image.path.split(/[\\/]/).at(-1)||'图片',...(drafts.previewFor(image.token)?{src:drafts.previewFor(image.token)}:{})})),drafts.files.map(file=>({...file})));
        if(mode==='send'){echo();scrollView.startFollowing();}updateSend();
        try{if(!await drafts.flush()||owner!==identity||epoch!==viewEpoch)return;imageProofs=await drafts.captureImageProofs();prepared=true;}
        catch(error){if(preparation===preparationSequence&&owner===identity&&epoch===viewEpoch)by('draft-status').textContent=error instanceof Error?error.message:'图片摘要未确认，未提交';return;}
        finally{if(!prepared&&mode==='send')pendingEcho.clear(clientUserMessageId);if(preparation===preparationSequence){preparingSend=false;updateSend();}}
        if(preparation!==preparationSequence||owner!==identity||epoch!==viewEpoch||!allowed()){if(mode==='send')pendingEcho.clear(clientUserMessageId);return;}
        if(mode==='send'){echo();pendingEcho.setStatus('正在发送…');}
        pendingSend={...(mode==='send'?{clientUserMessageId}:{}),viewId:sendViewId,requestId:++sendSequence,threadId:state.threadId,connectionId:state.connectionId,text:by('prompt').value,image:attachment,imageToken:drafts.imageToken,...(drafts.editId?{draftEditId:drafts.editId}:{}),extraImages:drafts.extraImages.map(v=>({...v})),imageProofs,...(drafts.files.length?{files:drafts.files.map(f=>({...f}))}:{}),...(drafts.skill?{skill:{...drafts.skill}}:{}),...(mode==='queue'?{mode,queueId:crypto.randomUUID()}:mode==='steer'?{mode,expectedTurnId:state.localQueue!.steerTurnId}:{}),attachmentVersion};
        drafts.markPending();const submitted=pendingSend;
        by('draft-status').textContent=state.dispatchMode==='daily'?'':mode==='queue'?'等待排队保存确认…':mode==='steer'?'等待插话受理确认…':'等待发送确认…';
        sendTimer=setTimeout(()=>{if(pendingSend===submitted){drafts.revealPending();drafts.refreshRecovery();if(mode==='send')pendingEcho.settle(false,true);by('draft-status').textContent=mode==='queue'?'排队保存未确认，草稿保留；先核对本地队列，勿重复添加。':'发送确认未返回，草稿已保留；请先恢复连接后再操作。';}},sendAckTimeout);
        updateSend();const{attachmentVersion:localVersion,...request}=pendingSend;if(mode!=='queue')scrollView.startFollowing();action('send',request);
    }
    by('send').onclick=()=>submitRequest();
    by('stop').onclick = () => {if(!state)return;if(preparingSend){preparationSequence++;preparingSend=false;pendingEcho.clear();by('draft-status').textContent='已取消发送准备，草稿保留。';}attachmentInput.cancel();editorAttachment?.cancelPreparation();editorCapture?.cancelPreparation();updateSend();action('stop',{threadId:state.threadId,connectionId:state.connectionId});};
    function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string) { const e = document.createElement(tag); e.textContent = value; return e; }
    function renderExperience(s:PageState){
        by('experience').hidden=!s.offlinePreview&&(!s.offlineExperienceAvailable||!!s.history);
        by('experience-note').textContent=s.offlinePreview?'离线交互体验 · 全部为固定合成资料，与真实历史、草稿隔离；不连接、不发送。':s.ready?'已连接后端，尚未打开聊天会话。发送额度关闭；可改用合成资料体验界面。':'可编辑本地草稿，或使用合成资料离线体验排序、搜索和轨道。';
        by('experience-open').textContent=s.offlinePreview?'返回 Codex 侧栏':'离线交互体验';
        by('attach').hidden=s.offlinePreview===true;
        by('prompt').placeholder=s.offlinePreview?'离线体验草稿；仅保存，不会发送':s.dispatchMode==='daily'?(s.ready?(s.threadId==='codex-local-draft'?'点击顶部“新建会话”开始聊天；已有本地草稿保留':'输入消息，Enter 发送；可附加图片或文档'):s.connecting?'正在连接；可先编辑草稿':'输入消息；未连接时仅保存本地草稿'):s.ready?'输入消息；发送额度关闭时仅保存本地草稿':'输入消息；未连接时仅保存本地草稿';
    }
    function reconcileBody(history:HTMLElement,rows:HTMLElement[],nextRows:typeof bodyRows,reset:boolean){
        if(reset)history.replaceChildren(...rows);
        else{
            const wanted=new Set(rows);
            for(const child of Array.from(history.children))if(!wanted.has(child as HTMLElement)&&!child.classList.contains('work-fold-bar'))child.remove();
            let cursor=history.firstElementChild;
            for(const row of rows){while(cursor?.classList.contains('work-fold-bar'))cursor=cursor.nextElementSibling;if(row===cursor)cursor=row.nextElementSibling;else history.insertBefore(row,cursor);}
        }
        bodyRows=nextRows;
        userFolds.prune();userActions.prune();
        // The process-fold reconciler releases rows that left a segment and
        // retains unchanged controls without toggling all hidden attributes.
    }
    function render(s: PageState, preserveScroll = false) {
        if (componentFrame !== undefined) { cancelAnimationFrame(componentFrame); componentFrame = undefined; }
        scrollView.before(s, preserveScroll);
        state = s;
        window.__prototypeState = s;
        blockFolds.configure(s.copySettings?.foldMemory !== false);
        userFoldMemory.configure(s.copySettings?.foldMemory !== false);
        userFolds.configure(s.copySettings || {});
        pendingEcho.configure(s.copySettings || {});
        userActions.configure(s.copySettings || {});
        const history = by('history');
        column.apply(s.copySettings?.contentMaxWidth);
        railPanel?.configure(s.copySettings?.railScrollbar,s.copySettings?.railNodeBadge!==false,s.copySettings);
        promptComposer.resize();
        display.applyMotion(s.copySettings?.animationStyle);
        display.configureDisplayHints(s.copySettings || {});
        const nextOwner = JSON.stringify([s.connectionId, s.threadId]);
        if (owner !== nextOwner) {
            owner = nextOwner;
            viewEpoch++;
            column.reset();
            resetPendingSend();
            pendingEcho.clear();
            fileActions.clear();
            fileReferences.clear();
            attachmentInput.reset();
            display.clearDisplayToast();
            userCopy.clear();
            replyActions.clear();
            revertBridge.clear();
            imageExports.clear();
            animations?.reset();
            preview.close();
            clearFormulaExports();
            drafts.select(s.threadId || '', s.connectionId);
            by('copy-status').textContent = '';
            for (const p of copies.values()) {
                clearTimeout(p.timer);
                p.reject(Error('显示身份已失效'));
            }
            copies.clear();
        }
        editorAttachment?.update(s);
        editorCapture?.update(s);
        dictation?.update(s);
        nativeTurnControl.update(s);
        compactionControl.update(s);
        nativeSkills?.update(s);
        usageDetails.update(display.latestUsageMeta(s.items), nextOwner, {threadId:s.threadId,connectionId:s.connectionId,available:s.dispatchMode==='daily',enabled:s.ready&&!s.connecting,accountLimits:s.accountLimits});
        toolMemory.configure(s.copySettings?.expandMemory !== false);
        toolCards.configure(nextOwner, s.copySettings?.expandMemory !== false, s.copySettings?.lazyFoldedBodies !== false, s.items.filter(v=>isToolDisplayItem(v.item)).map(v=>JSON.stringify([s.threadId,v.turnId,v.item.id])));
        workMemory.configure(s.copySettings?.foldMemory !== false);
        display.renderRuntimeNotices(by('status'), by('error'), s);
        modelPicker.update(s);
        permissionPicker.update(s);
        userInputPanel.update(s);
        renderExperience(s);
        by('usage').textContent = s.offlinePreview?'离线体验草稿 · 发送禁用 · 不占用模型额度':s.dispatchMode==='daily'?'':s.used===null||s.limit===null?'本地草稿 · 未配置发送额度 · 不会发送':s.independentBatch ? '验收批 ' + s.batchId + ' · 已预留 ' + s.used + '/' + s.limit + ' · 历史账本独立保留' : '本批已预留 ' + s.used + '/' + s.limit + ' · 旧批 ' + (s.oldUsed??'未知') + '/12 保留';by('usage').hidden=!by('usage').textContent;
        for (const id of ['send', 'new', 'restore'] as const)
            by(id).disabled = s.busy || !s.ready;
        by('restart').disabled = !!s.connecting || (s.busy && !s.approvals.length&&!s.userInputs?.length);
        by('restart').textContent=s.connecting?'连接中…':s.ready?'重新连接':'连接 Codex';
        by('send').disabled = by('send').disabled || !s.toolCheck?.verified || s.toolCheck.threadId !== s.threadId || !hasDispatchCapacity(s);
        by('tools').textContent = display.recoverySendReason(s) || (s.toolCheck?.reason || '');
        updateSend();
        by('threads').replaceChildren(...s.threads.map(id => { const e = text('option', id); e.value = id; e.selected = id === s.threadId; return e; }));
        const deferredTools=display.foldedWorkItems(s,workMemory);
        const bodySettings=Object.fromEntries(Object.entries(s.copySettings??{}).filter(([key])=>!NON_BODY_SETTINGS.has(key)));
        const context=JSON.stringify([nextOwner,bodySettings,blockFolds.revision,s.fileReferencesEnabled,s.formulaExportUnavailableReason,s.replyActionsEnabled,s.speechAvailable,s.replyForkMode,s.offlinePreview,window.__prototypePlain]);
        const resetBody=context!==bodyContext;
        if(resetBody){
            bodyContext=context;bodyRows.clear();userFolds.clear();userActions.clear();clearSearchHighlights();
            // before() has captured the reading anchor. Release the previous
            // body and observer roots before allocating the replacement tree.
            history.replaceChildren();scrollView.releaseBodyRows();railPanel?.releaseBodyRows();bodyWindow.releaseBodyRows();
        }
        const nextRows:typeof bodyRows=new Map();
        const createArticle=(v:PageState['items'][number],scope?:{folds:typeof userFolds;actions:typeof userActions;tools:typeof toolCards;valid:()=>boolean})=>{
            const item = v.item;
            const userFolds=scope?.folds??activeFolds,userActions=scope?.actions??activeActions,toolCards=scope?.tools??activeTools;
            const a = document.createElement('article');
            a.dataset.threadId = s.threadId;
            a.dataset.turnId = v.turnId;
            a.dataset.itemId = item.id;
            a.dataset.type = item.type;
            const epoch = viewEpoch, current = () => epoch === viewEpoch&&(!scope||scope.valid());
            const title = text('div', item.type + (isPageItem(item,'agentMessage') ? ' · ' + display.assistantPhaseLabel(item.phase, v.complete) : ''));
            a.append(title);
            if (isPageItem(item,'agentMessage')) {
                if (window.__prototypePlain === true)
                    a.append(text('pre', agentPublicText(item.text,item.questionRecord,true)));
                else {
                    a.className = 'message assistant';
                    title.remove();
                    a.append(display.messageHead('assistant', display.assistantPhaseLabel(item.phase, v.complete)));
                    const body = display.renderMarkdown(item.text, copyText, () => current() && a.isConnected, { ...(s.copySettings || {}), openFile:referenceOpener(v.turnId,item.id), blockOwner: [s.threadId, v.turnId, item.id], foldedBlock: blockFolds.has, saveBlockFold: blockFolds.save, streaming: !v.complete, loadMathJax, exportUnavailableReason:s.formulaExportUnavailableReason, exportFormula: value => exportFormula({ ...value, turnId: v.turnId, itemId: item.id }) });
                    body.classList.add('message-body');
                    if(item.questionRecord)body.append(renderQuestionRecord(item.questionRecord));
                    a.append(body);
                    if (v.complete)
                        userActions.bind(a, agentPublicText(item.text,item.questionRecord,true).length > 0, () => userCopy.copy(v.turnId, item.id), () => current() && a.isConnected, true, v.displayMeta, s.replyActionsEnabled ? { speak: () => replyActions.toggle(v.turnId, item.id), speaking: () => replyActions.isSpeaking(v.turnId, item.id), speechEnabled: s.speechAvailable === true && item.text.length > 0, fork: () => forkReply(v.turnId, item.id), forkReason: v.forkReason ?? '此场景未接入分支', revert:()=>revertReply(v.turnId,item.id),revertReason:v.revertReason??'此场景未接入回退',synthetic: s.replyForkMode === 'synthetic' } : undefined);
                }
            }
            else if (isPageItem(item,'userMessage')) {
                const parts: string[] = [], media: HTMLElement[] = [];
                for (const [index, input] of item.content.entries()) {
                    if (input.type === 'text') {
                        if (window.__prototypePlain === true)
                            a.append(text('pre', input.text));
                        else
                            parts.push(input.text);
                    }
                    else if (input.type === 'localImage') {
                        const image = input.displayImage || { id: JSON.stringify([s.threadId, v.turnId, item.id,index]), name: '图片不可用' };
                        // Normal user cards have fixed CSS geometry, including
                        // folded/missing cards. Hidden measurement needs only
                        // that box; visible and plain images still load normally.
                        if (scope && window.__prototypePlain !== true) {
                            const card = document.createElement('button');
                            card.type = 'button';card.className = 'image-card';media.push(card);
                        }
                        else if (window.__prototypePlain === true && display.safeImageSource(image.src)) {
                            const im = document.createElement('img');
                            im.src = image.src!;
                            im.alt = image.name;
                            a.append(im);
                        }
                        else {
                            const card = display.imageCard(image, preview, () => current() && imageIsCurrent(v.turnId, item.id, index, input), { format: s.copySettings?.imageCopyFormat || 'original', run: kind => exportBodyImage(v.turnId, item.id, index, input, image, kind) });
                            bindBodyOrigin(card,image,v.turnId,item.id,index,input);
                            if (window.__prototypePlain === true)
                                a.append(card);
                            else
                                media.push(card);
                        }
                    }
                    else if (input.type === 'image') {
                        const note = text('p', '远程图片未加载（资源限制）');
                        if (window.__prototypePlain === true)
                            a.append(note);
                        else {
                            note.className = 'image-card-status';
                            media.push(note);
                        }
                    }
                    else {const note=text('p',inputUnavailableText(input.type));note.className='image-card-status';if(window.__prototypePlain===true)a.append(note);else media.push(note);}
                }
                if(item.files?.length){const files=item.files,epoch=viewEpoch,valid=()=>{const row=state?.items.find(row=>row.turnId===v.turnId&&row.item.id===item.id);return epoch===viewEpoch&&current()&&a.isConnected&&!!row&&isPageItem(row.item,'userMessage')&&JSON.stringify(row.item.files)===JSON.stringify(files);},cards=display.messageFileCards(files,valid,(file,kind)=>fileActions.run(file,kind,{source:'body',turnId:v.turnId,itemId:item.id}));if(window.__prototypePlain===true)a.append(cards);else media.push(cards);}
                if (window.__prototypePlain !== true) {
                    title.remove();
                    a.append(display.messageHead('user'));
                    userFolds.bind(a, parts.join('\n'), media, [s.threadId, v.turnId, item.id], () => current() && a.isConnected);
                    userActions.bind(a, parts.join('\n').length > 0, () => userCopy.copy(v.turnId, item.id), () => current() && a.isConnected, false, v.displayMeta);
                }
            }
            else if (isToolDisplayItem(item)) {
                a.className = 'tool-message';
                title.remove();
                a.append(toolCards.render(item, v.complete, [s.threadId, v.turnId, item.id], () => current() && a.isConnected, toolMemory, () => userCopy.copy(v.turnId, item.id), s.copySettings?.feedbackMs, referenceOpener(v.turnId,item.id),deferredTools.has(rowIdentity(v.turnId,item.id))));
            }
            else if (isPageItem(item,'plan')) {
                title.textContent = '公开计划';
                a.append(display.renderMarkdown(item.text, copyText, () => current() && a.isConnected, { ...(s.copySettings || {}), openFile:referenceOpener(v.turnId,item.id), streaming: !v.complete, loadMathJax, exportUnavailableReason:s.formulaExportUnavailableReason, exportFormula: value => exportFormula({ ...value, turnId: v.turnId, itemId: item.id }) }));
            }
            else {
                title.textContent = '未适配记录';
                a.append(text('p', '当前候选尚未适配该记录类型，原始载荷未显示'));
            }
            return a;
        };
        const activeFolds=userFolds,activeActions=userActions,activeTools=toolCards;
        bodyWindow.configureCalibration({layout:context,workFold:key=>workMemory.get(key),expandWork:key=>{void workMemory.save(key,'expanded').catch(()=>{});},foldKey:v=>{const key=JSON.stringify([s.threadId,v.turnId,v.item.id]);return JSON.stringify([userFoldMemory.get(key),toolMemory.has(key),deferredTools.has(rowIdentity(v.turnId,v.item.id))]);},create:(root,valid)=>{
            const folds=new display.UserMessageFolds(()=>root,{get:key=>userFoldMemory.get(key),save:async()=>{}}),actions=new display.MessageActions(root),tools=new display.ToolCards();
            folds.configure(s.copySettings||{});actions.configure(s.copySettings||{});tools.configure(nextOwner,s.copySettings?.expandMemory!==false,s.copySettings?.lazyFoldedBodies!==false);
            return{render:async items=>{
                folds.clear();actions.clear();root.replaceChildren();let sliceStarted=performance.now();
                for(const row of items){
                    if(!valid())return;
                    root.append(createArticle(row,{folds,actions,tools,valid}));
                    // Only the hidden measurement renderer is sliced. Its real
                    // Markdown, code highlighting and fold controls remain intact.
                    if(performance.now()-sliceStarted>=8){await new Promise<void>(resolve=>setTimeout(resolve,0));sliceStarted=performance.now();}
                }
                if(!valid())return;
                display.applyWorkSegments(root,s,valid,{get:key=>workMemory.get(key),save:async()=>{}},(_bar,change)=>change());const ending=bodyWindow.endingTurns(items);display.renderTurnErrors(root,{...s,turns:(s.turns??[]).filter(turn=>ending.has(turn.id))});
            },dispose:()=>{folds.dispose();actions.dispose();root.replaceChildren();}};
        }});
        const windowRows=bodyWindow.update(s),rows=windowRows.map(v=>{
            const item=v.item,key=JSON.stringify([s.threadId,v.turnId,item.id]);
            const signature=JSON.stringify([isPageItem(item,'userMessage')?userFoldMemory.get(key):undefined,isToolDisplayItem(item)?toolMemory.has(key):undefined,deferredTools.has(rowIdentity(v.turnId,item.id))]);
            const cached=bodyRows.get(key);
            const sameRow=!!cached&&cached.row.complete===v.complete&&samePublicValue(cached.row.item,item)&&(!(isPageItem(item,'userMessage')||isPageItem(item,'agentMessage'))||samePublicValue(cached.row.displayMeta,v.displayMeta));
            if(cached?.signature===signature&&sameRow&&cached.article.isConnected){if(isPageItem(item,'agentMessage')){userActions.updateForkReason(cached.article,v.forkReason??'此场景未接入分支');userActions.updateRevertReason(cached.article,v.revertReason??'此场景未接入回退');}cached.row=v;nextRows.set(key,cached);return cached.article;}
            const a=createArticle(v);nextRows.set(key,{signature,row:v,article:a});return a;
        });
        reconcileBody(history,rows,nextRows,resetBody);
        const workEpoch = viewEpoch;
        display.applyWorkSegments(history, s, () => workEpoch === viewEpoch, workMemory, (bar, change) => scrollView.keepControl(bar, change),refreshComponents);
        const endingTurns=bodyWindow.endingTurns(windowRows);display.renderTurnErrors(history,{...s,turns:(s.turns??[]).filter(turn=>endingTurns.has(turn.id))});
        activity.update(history, s);
        welcome?.update(s,preparingSend||!!pendingSend);
        const changedTail=changedFilesTail.render(s,()=>workEpoch===viewEpoch,referenceOpener,(bar,change)=>scrollView.keepControl(bar,change));if(changedTail)history.append(changedTail);
        preview.closeIfStale();
        preview.applyLimits();
        draftChip.refresh();
        display.closeStaleMathMenu();
        by('approvals').replaceChildren(...s.approvals.map(r => { const a = document.createElement('article'); a.dataset.approvalId = String(r.id); a.append(text('strong', '需要你审批（仅本次）'), text('pre', JSON.stringify(r.params, null, 2))); const item = s.items.find(v => v.item.id === r.params.itemId); if (item && isPageItem(item.item,'fileChange'))
            a.append(text('pre', JSON.stringify(item.item.changes, null, 2)));
        const unavailable=r.acceptance?.allowed===true?'':r.acceptance?.reason||'审批允许范围尚未核对；可以拒绝此请求';
        if(unavailable){const notice=text('p',unavailable);notice.setAttribute('role','status');a.append(notice);}
        for (const accept of [false, true]) {
            const b = text('button', accept ? '允许本次' : '拒绝');
            b.dataset.decision = accept ? 'accept' : 'decline';
            if(accept&&unavailable){b.disabled=true;b.title=unavailable;}
            b.onclick = () => action('decision', { id: r.id, accept, callbackToken: r.callbackToken });
            a.append(b);
        } return a; }));
        bodyWindow.commit();pendingEcho.observe(s.items);pendingEcho.attach();scrollView.after();
    }
    const onDraft = (e:MessageEvent) => { const m = e.data; drafts.receive(m); if (m.type !== 'sent' || !pendingSend || !sameOwner(m) || m.viewId !== pendingSend.viewId || m.requestId !== pendingSend.requestId || pendingSend.mode&&m.mode!==pendingSend.mode || typeof m.ok !== 'boolean')
        return; const submitted = pendingSend,accepted=m.ok&&!m.unknown;if(!submitted.mode)pendingEcho.settle(accepted,!!m.unknown,drafts.pendingEdited); resetPendingSend(); drafts.settle(submitted.text, submitted.image, accepted, !!m.unknown, submitted.imageToken, submitted.files, submitted.extraImages, submitted.skill); drafts.refreshRecovery(); if (!accepted)
        by('draft-status').textContent = m.unknown ? submitted.mode==='queue'?'排队保存结果未确认，草稿已保留；先核对本地队列，勿重复添加。':'发送结果未确认，草稿已保留；请核对历史。' : (m.error||'发送失败，草稿已保留。'); else if(submitted.mode)by('draft-status').textContent=state.dispatchMode==='daily'?'':submitted.mode==='queue'?'已保存到本插件本地队列':'插话已受理，仍在原回合'; promptComposer.resize(); updateSend(); };
    host.messages.addEventListener('message',onDraft);
    const onState = (e:MessageEvent) => { const m = e.data;
    if(m.type==='exec-edit'&&(m.command==='undo'||m.command==='redo')){
        const focused=document.activeElement;
        if((focused instanceof HTMLTextAreaElement||focused instanceof HTMLInputElement)&&!focused.disabled&&!focused.readOnly||focused instanceof HTMLElement&&focused.isContentEditable){try{document.execCommand(m.command);}catch{/* Native editing may be unavailable without a current edit stack. */}}
        return;
    }
    if (m.type === 'state')
        render(m.state); if (m.type === 'attached' && sameOwner(m) && drafts.ready && display.safeImageSource(m.preview)) {
        try {
            drafts.addImage(m.path, m.preview);
        }
        catch (error) {
            attachmentInput?.showNotice((error as Error).message);
        }
    } if (m.type === 'display-copied') {
        const p = copies.get(m.id);
        if (!p)
            return;
        clearTimeout(p.timer);
        copies.delete(m.id);
        if (!sameOwner(m) || p.epoch !== viewEpoch || !m.ok) {
            p.reject(Error('复制失败或显示身份已失效'));
            return;
        }
        const copyNotice = state?.dispatchMode==='daily'?'':'已复制到剪贴板';
        by('copy-status').textContent = copyNotice;
        if (copyNotice) setTimeout(() => { if (by('copy-status').textContent === copyNotice) by('copy-status').textContent = ''; }, 4000);
        p.resolve();
    } if (m.type === 'formula-exported') {
        const p = formulaExports.get(m.id);
        if (!p)
            return;
        clearTimeout(p.timer);
        formulaExports.delete(m.id);
        if (!sameOwner(m) || p.epoch !== viewEpoch || !m.ok)
            p.reject(Error(m.error || '公式导出失败或显示身份已失效'));
        else
            p.resolve(m.result);
    } };
    host.messages.addEventListener('message',onState);
    new SessionBar(host,{
        select:async id=>{if(id===state?.threadId&&!state.needsRecovery)return;const identity=owner;if(preparingSend||state?.threadId&&!await drafts.flush()||identity!==owner)return;scrollView.flush();focusDraft=true;action('restore',{threadId:id});},
        create:async()=>{const identity=owner;if(preparingSend||state?.threadId&&!await drafts.flush()||identity!==owner)return;scrollView.flush();action('new');},
        restart:()=>{scrollView.flush();void drafts.flush();action('restart');}
    });
    const rail=railPanel=new TurnRail(host,by('history'),target=>scrollView.jumpTo(target),top=>scrollView.seek(top),()=>scrollView.rememberRail(),()=>scrollView.beginNavigation());
    rail.connectBodyWindow(bodyWindow);
    welcome=new CodexWelcome(by('history'));
    scrollView.connectHistoryNavigation(rail);
    scrollView.connectRailViewport({capture:owner=>rail.viewport(owner),restore:(memo,owner,manual)=>rail.restoreViewport(memo,owner,manual),readiness:(ready,owner)=>rail.readingReady(ready,owner),manual:owner=>rail.manual(owner),input:owner=>rail.bodyInput(owner)});
    const searchSelection=new SessionSelection(host);
    new SearchPanel(host,by('history'),{seek:top=>rail.preserveLocatedTarget(()=>scrollView.seek(top)),cancelNavigation:()=>rail.cancelPending(),navigate:(hit,options)=>rail.locate({turnId:hit.turnId,itemId:hit.itemId,label:hit.title,loaded:false,status:''},options),select:async(id,current=()=>true)=>{if(!current())return false;const identity=owner;if(!pageContentReady(state)||state?.busy||preparingSend||state.threadId&&!await drafts.flush()||identity!==owner||!current())return false;scrollView.flush();return searchSelection.select(id,current);}});
    window.addEventListener('pagehide', () => { if(componentFrame!==undefined)cancelAnimationFrame(componentFrame);componentFrame=undefined;bodyRows.clear();pendingEcho.clear();void drafts.flush(); viewEpoch++; resetPendingSend(); drafts.dispose(); preview.close(); clearFormulaExports(); for(const receive of [onComponent,onDraft,onState])host.messages.removeEventListener('message',receive); },{once:true});
    mounted=true;action('ready');
    for(const message of startup)host.postMessage(message);
}
