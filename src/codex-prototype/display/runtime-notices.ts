import {QUIET_PROGRESS_DELAY_MS} from './progress-delay';
/** Public display state only; no retries, approval decisions or transport ownership. */
export type RuntimeNoticeState = {
  status?: string; error?: string; errorTurnId?: string; model?: string; auth?: string; ready?: boolean;offlinePreview?:boolean;
  busy?: boolean; connecting?: boolean; operating?:boolean;needsRecovery?: boolean; approvals?: unknown[];
  turns?: {id:string;status:string;errorMessage?:string}[];
  fileSourceNotice?:string;
  dispatchMode?:string;
};
const labels:Record<string,string>={completed:'本轮已完成',interrupted:'本轮已停止',failed:'本轮失败',inProgress:'正在处理'};
const compactionStatus=new Set(['正在核对压缩条件','正在提交压缩请求','压缩请求已受理，等待公开压缩过程','正在压缩上下文','正在停止压缩','上下文压缩已完成','压缩已中断','已取消压缩准备，草稿保留']);
function routineProgress(s:RuntimeNoticeState){return s.connecting?'connecting':s.status?.startsWith('正在读取文档 ')?'document':['准备发送','正在创建此回合的分支','正在重读原阅读窗口（仅当前连接）','回答已提交，等待后端确认'].includes(s.status??'')?s.status!:'';}
const pendingProgress=new WeakMap<HTMLElement,{key:string;state:RuntimeNoticeState;timer:ReturnType<typeof setTimeout>|undefined;shown:boolean}>();
const pendingHide=new WeakMap<HTMLElement,ReturnType<typeof setTimeout>>();
const TRANSIENT_NOTICE_MS=5000;
export function runtimeStatusText(s:RuntimeNoticeState):string {
  const status=s.status||'未连接';
  return s.connecting?'正在连接 Codex…':s.busy&&s.approvals?.length&&status!=='正在停止'?'等待审批':labels[status]??status;
}
export function runtimeStatusVisible(s:RuntimeNoticeState):boolean {
  if(s.dispatchMode!=='daily'||s.needsRecovery||s.fileSourceNotice||s.approvals?.length)return true;
   if(s.connecting||s.operating)return false;
  const status=(s.status||'未连接').replace(/；已重读原阅读窗口$/,'');
  if(compactionStatus.has(status))return false;
  return !routineProgress(s)&&!['未连接','就绪','新会话','新线程已建立','历史已恢复','已恢复运行状态；可停止','会话已重命名','空会话已在本地重命名','会话已移入回收站（Codex归档）','会话历史已永久删除','会话已恢复；尚未发送','已从此回合创建分支；原线程与草稿保留，未自动发送','无已存历史的空会话已移入本地回收站；草稿保留','无已存历史的空会话本地记录已移除','插话已受理，仍在当前回合','completed','interrupted','inProgress','生成中','已停止','已取消准备','已取消准备，草稿和附件保留'].includes(status);
}
export function recoverySendReason(s:RuntimeNoticeState):string {
  return s.needsRecovery?'发送已禁用：恢复后重试':'';
}
function node(tag:string,cls:string,value:string){const e=document.createElement(tag);e.className=cls;e.textContent=value;return e;}
function errorCard(box:HTMLElement,title:string,detail:string){
  box.className='runtime-status status error status-card';
  box.replaceChildren(node('div','status-card-title','⚠ '+title),node('div','status-card-detail',detail));
}
export function renderRuntimeNotices(status:HTMLElement,error:HTMLElement,s:RuntimeNoticeState):void {
  status.className='runtime-status status notice';
  status.hidden=!runtimeStatusVisible(s);
  const connecting=s.dispatchMode==='daily'&&s.connecting;if(connecting)status.className+=' connection-notice';status.replaceChildren(connecting?node('span','connection-spinner',''):node('span','notice-icon','ℹ'),node('span','runtime-status-text',runtimeStatusText(s)));
  const meta=s.dispatchMode==='daily'?'':[s.model,s.auth].filter(Boolean).join(' · ');if(meta)status.append(node('span','runtime-status-meta',meta));
  if(s.fileSourceNotice)status.append(node('span','runtime-status-meta',s.fileSourceNotice));
   const routine=routineProgress(s),submission=routine==='准备发送'||routine==='document';
   const key=s.dispatchMode==='daily'&&!s.connecting&&!s.operating&&!s.needsRecovery&&!s.fileSourceNotice&&!s.approvals?.length&&!submission?routine:'',prior=pendingProgress.get(status);
  if(prior?.key!==key){clearTimeout(prior?.timer);pendingProgress.delete(status);}
  if(key){let progress=pendingProgress.get(status);if(!progress){progress={key,state:s,timer:undefined,shown:false};pendingProgress.set(status,progress);const current=progress;current.timer=setTimeout(()=>{current.timer=undefined;if(pendingProgress.get(status)!==current||!status.isConnected)return;current.shown=true;status.hidden=false;status.querySelector('.runtime-status-text')!.textContent=runtimeStatusText(current.state);},QUIET_PROGRESS_DELAY_MS);}progress.state=s;status.hidden=!progress.shown;}
  const pinned=s.needsRecovery||!!s.approvals?.length||s.connecting||s.operating||!!s.fileSourceNotice||!!s.error||s.ready===false;
  const priorHide=pendingHide.get(status);if(priorHide!==undefined){clearTimeout(priorHide);pendingHide.delete(status);}
  if(!pinned){const timer=setTimeout(()=>{pendingHide.delete(status);if(status.isConnected)status.hidden=true;},TRANSIENT_NOTICE_MS);pendingHide.set(status,timer);}
  error.hidden=!s.error;error.replaceChildren();
  if(s.error)errorCard(error,s.needsRecovery?'需要核对恢复状态':!s.ready&&!s.offlinePreview?'运行时连接不可用':'操作未完成',s.error);
}
/** Keep public terminal errors visible after recovery, outside folded process rows. */
export function renderTurnErrors(history:HTMLElement,s:RuntimeNoticeState):void {
  const turns=s.turns??[];
  for(const [index,turn]of turns.entries()){
    if(!['failed','interrupted'].includes(turn.status)||!turn.errorMessage)continue;
    // The current error already has a persistent card above the history.
    if(s.errorTurnId===turn.id&&s.error===turn.errorMessage)continue;
    const card=document.createElement('div');card.dataset.turnError=turn.id;card.setAttribute('role','note');
    errorCard(card,turn.status==='interrupted'?'此回合已停止':'此回合失败',turn.errorMessage);
    const rows=Array.from(history.children).filter(e=>(e as HTMLElement).dataset.turnId===turn.id);
    if(rows.length)rows.at(-1)!.after(card);
    else{const following=new Set(turns.slice(index+1).map(t=>t.id));history.insertBefore(card,Array.from(history.children).find(e=>following.has((e as HTMLElement).dataset.turnId??''))??null);}
  }
}
// DSH 0.1.165 webview.ts:657–666,671, scoped to avoid settings/tool-card collisions.
export const RUNTIME_NOTICE_STYLE=`
    .runtime-status.status { margin: 10px 0; padding: 11px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; overflow-wrap: anywhere; background: var(--vscode-editor-background); }
    .runtime-status.status { color: var(--vscode-descriptionForeground); border: 0; background: var(--vscode-textBlockQuote-background); }
    .runtime-status.status.notice { display: flex; align-items: baseline; gap: 6px; }
    .runtime-status.status .notice-icon { color: var(--vscode-charts-blue, #4d6bfe); opacity: .9; }
    .runtime-status.status.error .notice-icon { color: var(--vscode-errorForeground); }
    .runtime-status.status.status-card { border: 1px solid color-mix(in srgb, var(--vscode-errorForeground) 55%, transparent); background: color-mix(in srgb, var(--vscode-errorForeground) 8%, transparent); color: var(--vscode-foreground); }
    .runtime-status .status-card-title { margin-bottom: 4px; font-weight: 600; color: var(--vscode-errorForeground); }
    .runtime-status .status-card-detail { margin-bottom: 8px; color: var(--vscode-descriptionForeground); font-size: 12px; white-space: pre-wrap; }
    .runtime-status.status.error { color: var(--vscode-errorForeground); }
    .runtime-status[hidden] { display: none; }
    #status.runtime-status { margin: 0; padding: 0; background: transparent; flex-wrap: wrap; }
    #status.runtime-status.connection-notice { align-self:flex-start; align-items:center; gap:7px; margin:2px 12px; padding:4px 9px; border-radius:999px; font-size:12px; background:var(--vscode-textBlockQuote-background); }
    .connection-spinner { display:inline-block; width:11px; height:11px; box-sizing:border-box; border:1.5px solid color-mix(in srgb,var(--vscode-charts-blue,#4d6bfe) 24%,transparent); border-top-color:var(--vscode-charts-blue,#4d6bfe); border-radius:50%; animation:codex-connection-spin .9s linear infinite; }
    @keyframes codex-connection-spin { to { transform:rotate(360deg); } }
    @media(prefers-reduced-motion:reduce){.connection-spinner{animation:none}}
    .runtime-status-meta { font-size: 12px; opacity: .75; }
    #tools.runtime-status, #error.runtime-status { margin: 0; flex: none; box-sizing: border-box; }
    #tools.runtime-status::before { content: 'ℹ'; color: var(--vscode-charts-blue, #4d6bfe); margin-right: 6px; }
    #error.runtime-status .status-card-detail, #history > .runtime-status .status-card-detail { margin-bottom: 0; }
    #error.runtime-status { max-height: 25vh; overflow: auto; }
    #history > .runtime-status { box-sizing: border-box; max-width: var(--content-max,760px); margin-inline: auto; }
`;
