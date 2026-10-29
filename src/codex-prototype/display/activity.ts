/** Decorative CSS motion follows public lifecycle only; never drives execution or layout frames. */
export type MotionStyle='standard'|'dots'|'off';
export function isMotionStyle(value:unknown):value is MotionStyle{return value==='standard'||value==='dots'||value==='off';}
export function applyMotion(value:unknown):void{const style=isMotionStyle(value)?value:'standard';if(document.body.dataset.motion!==style)document.body.dataset.motion=style;}
export type ActivityState={threadId?:string;connectionId?:unknown;ready?:boolean;busy?:boolean;needsRecovery?:boolean;status?:string;dispatchMode?:string;approvals?:unknown[];userInputs?:{status:string}[];items?:{complete:boolean;item:{type:string;text?:string}}[]};
export function publicActivity(s:ActivityState):{mode:'idle'|'working'|'waiting'|'stopping';label:string}{
 if(!s.busy||s.ready===false||s.needsRecovery)return{mode:'idle',label:''};
 if(s.status==='正在停止')return{mode:'stopping',label:'正在停止'};
 if(s.approvals?.length)return{mode:'waiting',label:'等待审批'};
 if(s.userInputs?.length)return{mode:'waiting',label:s.userInputs.some(value=>value.status==='pending')?'等待回答':'回答已提交'};
 return{mode:'working',label:s.status==='准备发送'?'准备发送':s.items?.some(v=>!v.complete&&v.item.type==='agentMessage'&&!!v.item.text)?'生成中':'正在处理'};
}
/** Retain one row throughout a busy turn: tool/text transitions change only its label. */
export class ActivityIndicator{
 readonly line=document.createElement('div');readonly row=document.createElement('div');private label=document.createElement('span');private identity='';private visible=false;
 constructor(){this.line.className='a7-progress';this.line.setAttribute('aria-hidden','true');this.row.className='a7-thinking';this.row.setAttribute('role','status');this.row.setAttribute('aria-atomic','true');this.label.className='a7-label';const dots=document.createElement('span');dots.className='a7-dots';dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)dots.append(document.createElement('i'));this.row.append(this.label,dots);}
 update(history:HTMLElement,state:ActivityState){const activity=publicActivity(state),identity=JSON.stringify([state.threadId,state.connectionId]);document.body.dataset.activity=activity.mode;const visible=activity.mode!=='idle';this.row.dataset.entering=String(visible&&(!this.visible||identity!==this.identity));this.identity=identity;this.visible=visible;this.line.hidden=activity.mode!=='working';this.row.hidden=!visible||state.dispatchMode==='daily'&&activity.mode==='working';this.row.dataset.paused=String(activity.mode!=='working');if(this.label.textContent!==activity.label)this.label.textContent=activity.label;history.prepend(this.line);history.append(this.row);}
}
// DSH 0.1.165 webview.ts:1087–1117. Codex uses the existing local avatar and public labels.
export const ACTIVITY_STYLE=`
    .message-body.streaming::after { content: ''; display: inline-block; width: 6px; height: 13px; margin-left: 2px; vertical-align: -2px; background: var(--vscode-foreground); animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    body[data-motion="off"] *, body[data-motion="off"] *::before, body[data-motion="off"] *::after { animation: none !important; transition: none !important; }
    body[data-motion="standard"][data-activity="working"] .message.assistant:has(.message-body.streaming) .avatar { animation: a7-pulse 1.4s ease-in-out infinite; }
    .tool-icon.live { font-size: 0; display: grid; place-items: center; }
    .tool-icon.live::before { content: ''; width: 12px; height: 12px; border: 2px solid color-mix(in srgb, currentColor 25%, transparent); border-top-color: currentColor; border-radius: 50%; animation: a7-spin .8s linear infinite; }
    .a7-thinking { display: flex; align-items: center; gap: 6px; margin: 8px 0 2px; padding: 6px 10px; border-radius: 6px; color: var(--vscode-descriptionForeground); font-size: 12px; animation: a7-fade-in .15s ease-out; }
    .a7-dots { display: none; gap: 3px; }
    .a7-dots i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
    body[data-motion="standard"] .a7-label { background-image: linear-gradient(90deg, var(--vscode-descriptionForeground) 40%, var(--vscode-foreground) 50%, var(--vscode-descriptionForeground) 60%); background-size: 200% 100%; background-clip: text; -webkit-background-clip: text; color: transparent; animation: a7-shimmer 2.25s linear infinite; }
    body[data-motion="dots"] .a7-label { color: var(--vscode-descriptionForeground); }
    body[data-motion="dots"] .a7-dots { display: inline-flex; }
    body[data-motion="dots"] .a7-dots i { animation: a7-dot-bounce 1.2s ease-in-out infinite; }
    body[data-motion="dots"] .a7-dots i:nth-child(2) { animation-delay: .15s; }
    body[data-motion="dots"] .a7-dots i:nth-child(3) { animation-delay: .3s; }
    body[data-motion="dots"] .a7-label, body[data-motion="off"] .a7-label, body.vscode-reduce-motion .a7-label { color: var(--vscode-descriptionForeground) !important; background-image: none !important; }
    .a7-progress { position: sticky; top: 0; z-index: 6; height: 2px; margin: 0 auto; max-width: min(var(--content-max, 760px), 100% - 28px); overflow: hidden; background: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 22%, transparent); border-radius: 0 0 2px 2px; }
    .a7-progress::after { content: ''; display: block; width: 35%; height: 100%; background: var(--vscode-charts-blue, #4d6bfe); animation: a7-line 1.2s ease-in-out infinite; }
    @keyframes a7-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
    @keyframes a7-spin { to { transform: rotate(360deg); } }
    @keyframes a7-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @keyframes a7-dot-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .5; } 40% { transform: translateY(-3px); opacity: 1; } }
    @keyframes a7-line { from { transform: translateX(-100%); } to { transform: translateX(285%); } }
    @keyframes a7-fade-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } body .a7-label { color: var(--vscode-descriptionForeground) !important; background-image: none !important; } }
    body.vscode-reduce-motion *, body.vscode-reduce-motion *::before, body.vscode-reduce-motion *::after { animation: none !important; transition: none !important; }
    .a7-thinking[hidden], .a7-progress[hidden] { display: none; }
    #history > .a7-thinking { box-sizing: border-box; width: 100%; max-width: var(--content-max,760px); margin-inline: auto; }
    .a7-thinking[data-paused="true"] .a7-label { background-image: none !important; color: var(--vscode-descriptionForeground) !important; animation: none !important; }
    .a7-thinking[data-paused="true"] .a7-dots { display: none; }
    .a7-thinking[data-paused="true"], .a7-thinking[data-entering="false"] { animation: none !important; }
    body:not([data-activity="working"]) .tool-icon.live::before, body:not([data-activity="working"]) .message-body.streaming::after { animation: none; }
`;
