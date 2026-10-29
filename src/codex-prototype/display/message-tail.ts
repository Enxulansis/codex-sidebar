import {validUsage} from '../page-usage';
import type {TailMeta} from '../page-model';
// Directly reuse the original 165 pure formatting functions, not its runtime or event protocol.
const chrome=require('../../webview-chrome.js') as {formatMessageClock:(time:number,now?:number)=>string;formatRunDuration:(ms:number)=>string;formatLatencySeconds:(ms:number)=>string;formatTokensPerSecond:(tps:number)=>string};
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function normalizeTailMeta(input:unknown):TailMeta|undefined{
 const v=input as TailMeta|undefined;if(!v||!['public','synthetic'].includes(v.source))return;
 const out:TailMeta={source:v.source};
 if(finite(v.timeMs)&&v.timeMs!<=8.64e15){out.timeMs=v.timeMs!;if(['server-turn','client-received','synthetic'].includes(v.timeSource!))out.timeSource=v.timeSource!;}
 if(finite(v.durationMs)){out.durationMs=v.durationMs!;if(['server-turn','client-received','synthetic'].includes(v.durationSource!))out.durationSource=v.durationSource!;}
 if(finite(v.firstVisibleMs))out.firstVisibleMs=v.firstVisibleMs!;if(finite(v.averageOutputTokS))out.averageOutputTokS=v.averageOutputTokS!;
 const usage=validUsage(v.tokenUsage);if(usage)out.tokenUsage=usage;
 if(v.incomplete===true)out.incomplete=true;if(v.usageOrderUnknown===true)out.usageOrderUnknown=true;if(v.usageFromEarlierRow===true)out.usageFromEarlierRow=true;
 return out;
}
export function tailClockText(meta:TailMeta,now?:number){return meta.timeMs===undefined?'':chrome.formatMessageClock(meta.timeMs,now);}
export const formatUsageTokens=(n:number)=>n>=1e6?(n/1e6).toPrecision(3)+'M':n>=1e3?(n/1e3).toPrecision(3)+'K':String(n);
export function tailDetails(meta:TailMeta):{primary:string;lines:string[]}|undefined{
 const hasDuration=meta.durationMs!==undefined,hasWait=meta.firstVisibleMs!==undefined,hasRate=meta.averageOutputTokS!==undefined&&!meta.incomplete&&!meta.usageOrderUnknown;
 if(!hasDuration&&!hasWait&&!hasRate)return;
 const duration=hasDuration?chrome.formatRunDuration(meta.durationMs!):'—',wait=hasWait?chrome.formatLatencySeconds(meta.firstVisibleMs!)+'秒':'—',rate=hasRate?'≈'+chrome.formatTokensPerSecond(meta.averageOutputTokS!)+' tok/s':'—';
 return{primary:hasDuration?duration:hasRate?rate:'首段 '+wait,lines:[(meta.source==='synthetic'?'示例 · ':'')+'用时 '+duration+' · 首段 '+wait+' · 均速 '+rate]};
}
export const CLOCK_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
let floating:HTMLElement|undefined,owning:HTMLElement|undefined;
export function closeTailDetails(){floating?.remove();floating=owning=undefined;}
/** Original pill and detail panel; portal only prevents the scroll host from clipping it. */
export function renderClockPill(meta:TailMeta,valid:()=>boolean){
 const detail=tailDetails(meta);if(!detail)return;
 const pill=document.createElement('span');pill.className='msg-clock';pill.tabIndex=0;pill.innerHTML=CLOCK_SVG;
 const primary=document.createElement('span');primary.textContent=detail.primary;pill.append(primary);pill.setAttribute('aria-label',detail.lines.join(' · '));
 const show=()=>{if(!valid()||!pill.isConnected)return;if(owning===pill)return;closeTailDetails();const panel=document.createElement('span');panel.className='msg-clock-panel floating';panel.setAttribute('role','tooltip');panel.textContent=detail.lines.join('\n');document.body.append(panel);floating=panel;owning=pill;const r=pill.getBoundingClientRect(),row=pill.closest('.message-actions'),anchor=row??pill,left=anchor.getBoundingClientRect().left+(row?parseFloat(getComputedStyle(row).paddingLeft)||0:0),box=panel.getBoundingClientRect();panel.style.left=Math.max(6,Math.min(left,innerWidth-box.width-6))+'px';panel.style.top=Math.max(6,r.top-box.height-8>=6?r.top-box.height-8:Math.min(r.bottom+8,innerHeight-box.height-6))+'px';};
 const hide=()=>{if(owning===pill)closeTailDetails();};pill.addEventListener('mouseenter',show);pill.addEventListener('mouseleave',hide);pill.addEventListener('focus',show);pill.addEventListener('blur',hide);
 return pill;
}
export const CLOCK_STYLE=`
    .msg-clock { position: relative; padding: 1px 6px 1px 4px; display: inline-flex; align-items: center; gap: 3px; border: 1px solid var(--vscode-widget-border); border-radius: 6px; color: var(--vscode-descriptionForeground); cursor: default; }
    .msg-clock svg { width: 11px; height: 11px; }
    .msg-clock:hover, .msg-clock:focus-within { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .msg-clock-panel { position: absolute; z-index: 30; left: 0; bottom: calc(100% + 8px); width: max-content; max-width: 240px; padding: 7px 9px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; color: var(--vscode-foreground); background: var(--vscode-menu-background); box-shadow: 0 7px 22px var(--vscode-widget-shadow); font-size: 11px; line-height: 17px; white-space: nowrap; display: none; }
    .msg-clock:hover .msg-clock-panel, .msg-clock:focus-within .msg-clock-panel { display: block; }
    .msg-clock-panel.floating { position:fixed; z-index:90; display:block; bottom:auto; max-width:min(240px,calc(100vw - 12px)); max-height:calc(100vh - 12px); overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; box-sizing:border-box; pointer-events:none; }
    .message-time { white-space:nowrap; }
    .message-actions .msg-clock { box-sizing:border-box; height:20px; line-height:16px; }
`;
