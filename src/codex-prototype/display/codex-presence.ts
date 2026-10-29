import type {PageState} from '../page-model';
import {publicActivity} from './activity';
import {codexMark} from './codex-mark';

export function tabActivity(state:PageState,id:string){return id===state.threadId?publicActivity(state):{mode:'idle' as const,label:''};}
const CODEX_ANIMATIONS=['turn','rock','spring','orbit'] as const;
/** Choose another local motion without a timer or an immediate repeat. */
export function nextCodexAnimation(previous='',random=Math.random){const choices=CODEX_ANIMATIONS.filter(value=>value!==previous);return choices[Math.min(choices.length-1,Math.max(0,Math.floor(random()*choices.length)))]!;}
export function showCodexWelcome(state:PageState,pending=false){
 const history=state.history;
 return state.dispatchMode==='daily'&&state.ready&&!state.connecting&&!state.busy&&!state.operating&&!state.needsRecovery&&!state.error&&!state.offlinePreview&&!pending&&!state.items.length&&!state.turns?.length&&!state.approvals.length&&!state.userInputs?.length&&(state.threadId==='codex-local-draft'||!!history?.complete&&!history.loading&&!history.error&&!history.hasMore&&history.loadedTurns===0);
}
/** Empty-state decoration stays outside the measured message history and owns no host channel. */
export class CodexWelcome{
 readonly element=document.createElement('section');private button=document.createElement('button');private state:PageState|undefined;private pending=false;private owner='';
 private reduced=matchMedia('(prefers-reduced-motion: reduce)');
 private historyObserver=new MutationObserver(()=>this.refresh());
 private motionObserver=new MutationObserver(()=>this.stopIfReduced());
 constructor(private history:HTMLElement){
  this.element.className='codex-welcome';this.element.hidden=true;
  this.button.type='button';this.button.className='codex-welcome-mark';this.button.setAttribute('aria-label','播放 Codex 图标动画');this.button.title='点击播放动画';this.button.append(codexMark());
  const title=document.createElement('h1');title.textContent='我们要构建什么？';this.element.append(this.button,title);history.parentElement!.append(this.element);
  this.button.onclick=()=>{if(this.element.hidden||this.motionOff())return;this.button.classList.remove('playing');this.button.dataset.animation=nextCodexAnimation(this.button.dataset.animation);void this.button.offsetWidth;this.button.classList.add('playing');};
  this.button.onanimationend=event=>{if(event.target===this.button.querySelector('svg>path:last-child'))this.button.classList.remove('playing');};
  this.historyObserver.observe(history,{childList:true});this.motionObserver.observe(document.body,{attributes:true,attributeFilter:['class','data-motion']});this.reduced.addEventListener('change',this.stopIfReduced);
  window.addEventListener('pagehide',()=>this.dispose(),{once:true});
 }
 private motionOff(){return document.body.dataset.motion==='off'||document.body.classList.contains('vscode-reduce-motion')||this.reduced.matches;}
 private stopIfReduced=()=>{if(this.motionOff())this.button.classList.remove('playing');};
 private refresh(){this.element.hidden=!this.state||!showCodexWelcome(this.state,this.pending)||!!this.history.querySelector('.pending-send');if(this.element.hidden)this.button.classList.remove('playing');}
 update(state:PageState,pending=false){const owner=JSON.stringify([state.connectionId,state.threadId]);if(owner!==this.owner)this.button.classList.remove('playing');this.owner=owner;this.state=state;this.pending=pending;this.refresh();this.stopIfReduced();}
 dispose(){this.button.classList.remove('playing');this.historyObserver.disconnect();this.motionObserver.disconnect();this.reduced.removeEventListener('change',this.stopIfReduced);this.element.remove();}
}
export const CODEX_PRESENCE_STYLE=String.raw`
.session-tab.has-activity[aria-disabled=true]{opacity:1}.session-tab.has-activity[aria-disabled=true] .tab-title{opacity:.7}
.session-tab .tab-run{display:block;flex:0 0 14px;width:14px;height:14px;margin-right:2px;color:color-mix(in srgb,var(--vscode-foreground,#ddd) 55%,white 45%)}.vscode-light .session-tab .tab-run,.vscode-high-contrast-light .session-tab .tab-run{color:var(--vscode-foreground)}.session-tab .tab-run[hidden]{display:none}.tab-run>svg{display:block;width:100%;height:100%}
.tab-run svg>path:last-child,.codex-welcome-mark svg>path:last-child{transform-box:view-box;transform-origin:50% 50%}
.tab-run[data-activity=working] svg>path:last-child{animation:codex-tab-turn 2s ease-in-out infinite}.tab-run[data-activity=working][data-animation=rock] svg>path:last-child{animation-name:codex-tab-rock}.tab-run[data-activity=working][data-animation=spring] svg>path:last-child{animation-name:codex-tab-spring}.tab-run[data-activity=working][data-animation=orbit] svg>path:last-child{animation-name:codex-tab-orbit}.tab-run[data-activity=working] svg>path:first-child{animation:codex-tab-cursor 1.2s steps(2,end) infinite}
.tab-run[data-activity=waiting]{color:var(--vscode-charts-yellow,#d7ba7d)}.tab-run[data-activity=stopping]{color:var(--vscode-descriptionForeground)}
.codex-welcome{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px 16px;pointer-events:none;text-align:center}.codex-welcome[hidden]{display:none}
.codex-welcome .codex-welcome-mark{pointer-events:auto;display:grid;place-items:center;flex:0 0 auto;width:76px;height:76px;padding:6px;border:0;border-radius:18px;background:transparent;color:var(--vscode-descriptionForeground);opacity:.75}.codex-welcome-mark:hover{opacity:1}.codex-welcome-mark:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}.codex-welcome-mark>svg{display:block;width:100%;height:100%}.codex-welcome h1{margin:0;font-size:clamp(20px,5vw,28px);font-weight:500;line-height:1.35;color:var(--vscode-foreground)}
.codex-welcome-mark.playing svg>path:last-child{animation:codex-welcome-turn .8s cubic-bezier(.22,.7,.25,1)}.codex-welcome-mark.playing[data-animation=rock] svg>path:last-child{animation-name:codex-welcome-rock}.codex-welcome-mark.playing[data-animation=spring] svg>path:last-child{animation-name:codex-welcome-spring}.codex-welcome-mark.playing[data-animation=orbit] svg>path:last-child{animation-name:codex-welcome-orbit}.codex-welcome-mark.playing svg>path:first-child{animation:codex-welcome-cursor .8s steps(2,end)}
@keyframes codex-tab-turn{0%,100%{transform:rotate(0deg)}50%{transform:rotate(90deg)}}@keyframes codex-tab-rock{0%,100%{transform:rotate(0deg)}30%{transform:rotate(-16deg)}70%{transform:rotate(16deg)}}@keyframes codex-tab-spring{0%,100%{transform:scale(1)}40%{transform:scale(.9)}65%{transform:scale(1.06)}}@keyframes codex-tab-orbit{0%,100%{transform:rotate(0deg) scale(1)}50%{transform:rotate(-90deg) scale(.94)}}@keyframes codex-tab-cursor{50%{opacity:.65}}
@keyframes codex-welcome-turn{0%{transform:rotate(0deg)}20%{transform:rotate(-18deg)}100%{transform:rotate(360deg)}}@keyframes codex-welcome-cursor{0%,100%{opacity:1}35%,65%{opacity:0}}
@keyframes codex-welcome-rock{0%,100%{transform:rotate(0deg)}20%{transform:rotate(-22deg)}45%{transform:rotate(18deg)}70%{transform:rotate(-10deg)}}@keyframes codex-welcome-spring{0%,100%{transform:scale(1) translateY(0)}30%{transform:scale(.88,1.08) translateY(-4px)}55%{transform:scale(1.1,.9) translateY(2px)}80%{transform:scale(.97,1.03) translateY(-1px)}}@keyframes codex-welcome-orbit{0%,100%{transform:rotate(0deg) scale(1)}45%{transform:rotate(-180deg) scale(.82)}75%{transform:rotate(-320deg) scale(1.04)}100%{transform:rotate(-360deg) scale(1)}}
body[data-motion=off] .tab-run *,body[data-motion=off] .codex-welcome-mark *,body.vscode-reduce-motion .tab-run *,body.vscode-reduce-motion .codex-welcome-mark *{animation:none!important}
@media(prefers-reduced-motion:reduce){.tab-run *,.codex-welcome-mark *{animation:none!important}}
`;
