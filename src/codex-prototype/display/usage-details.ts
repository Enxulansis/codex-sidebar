import type {TailMeta} from '../page-model';
import {normalizeTailMeta,formatUsageTokens,closeTailDetails} from './message-tail';
import type {PageHost} from '../page-host';
import {AccountLimitsControl,type AccountLimitsContext} from './account-limits';

type Details={label:string;rows:[string,string][];notes:string[]};
/** Public snapshots are not a context composition or a per-message bill. */
export function usageDetails(meta:TailMeta|undefined):Details{
 const rows:[string,string][]=[],notes:string[]=[],label=meta?.source==='synthetic'?'合成示例':meta?.tokenUsage?meta.usageOrderUnknown?'顺序未核对':meta.incomplete?'连接中断':meta.usageFromEarlierRow?'较早快照':'':'暂无用量';
 if(meta?.tokenUsage){const {total,last,modelContextWindow}=meta.tokenUsage;
  rows.push(['线程累计 · 输入',formatUsageTokens(total.inputTokens)],['线程累计 · 输出',formatUsageTokens(total.outputTokens)],['最近快照 · 输入',formatUsageTokens(last.inputTokens)],['最近快照 · 输出',formatUsageTokens(last.outputTokens)],['推理 token',formatUsageTokens(last.reasoningOutputTokens)],['缓存读取',formatUsageTokens(last.cachedInputTokens)],['缓存写入',formatUsageTokens(last.cacheWriteInputTokens)]);
  if(modelContextWindow!==null)rows.push(['模型上下文容量',formatUsageTokens(modelContextWindow)]);
  else notes.push('未提供上下文容量。');
 }
 if(meta?.incomplete&&label!=='连接中断')notes.push('连接中断。');if(meta?.usageOrderUnknown&&label!=='顺序未核对')notes.push('用量顺序未核对。');
 if(meta?.usageFromEarlierRow&&label!=='较早快照')notes.push('显示较早快照。');
 return{label,rows,notes};
}

export function latestUsageMeta(items:readonly {item:{type:string};displayMeta?:unknown}[]):TailMeta|undefined{
 let latest:TailMeta|undefined,newest=true;for(let i=items.length-1;i>=0;i--){const item=items[i]!;if(item.item.type==='agentMessage'){const meta=normalizeTailMeta(item.displayMeta);if(meta){latest??=meta;if(meta.tokenUsage)return newest?meta:{...meta,usageFromEarlierRow:true};}newest=false;}}return latest;
}

/** Original 165 click-to-open ring; only readonly display data crosses this boundary. */
export class UsageDetailsControl{
 private meta:TailMeta|undefined;private owner:string|undefined;private panel:HTMLElement|undefined;private content='';private observer:ResizeObserver;
 private core:HTMLElement|undefined;private account:AccountLimitsControl|undefined;private extra:HTMLElement|undefined;
 readonly element=document.createElement('div');readonly trigger=document.createElement('button');
 constructor(private anchor:HTMLElement,host?:PageHost){
  if(host)this.account=new AccountLimitsControl(host,()=>{if(this.panel)this.position();});
  this.element.className='usage-control';this.trigger.type='button';this.trigger.className='icon-button usage-trigger';this.trigger.setAttribute('aria-haspopup','dialog');this.trigger.setAttribute('aria-expanded','false');this.trigger.innerHTML='<svg viewBox="0 0 14 14"><circle class="usage-track" cx="7" cy="7" r="5.5"/><circle class="usage-fill" cx="7" cy="7" r="5.5" transform="rotate(-90 7 7)"/></svg>';this.element.append(this.trigger);this.update(undefined,'');
  this.trigger.addEventListener('click',this.toggle);document.addEventListener('click',this.outside);document.addEventListener('keydown',this.key);window.addEventListener('resize',this.close);document.addEventListener('scroll',this.scroll,true);window.addEventListener('pagehide',this.dispose,{once:true});
  this.observer=new ResizeObserver(()=>{if(this.panel)this.paint();});this.observer.observe(this.anchor);
 }
 update(metadata:unknown,owner:string,account?:AccountLimitsContext){if(this.owner!==owner)this.close();this.owner=owner;this.meta=normalizeTailMeta(metadata);this.account?.update(account);const title='用量详情'+(this.meta?.source==='synthetic'?'（合成示例）':'');this.trigger.title=title;this.trigger.setAttribute('aria-label',title);if(this.panel)this.paint();}
 private toggle=(e:MouseEvent)=>{e.stopPropagation();if(this.panel)this.close();else{closeTailDetails();this.panel=document.createElement('div');this.panel.className='usage-panel floating';this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-label','用量详情');this.core=document.createElement('div');this.core.className='usage-thread';this.panel.append(...(this.account?[this.account.element]:[]),this.core,...(this.extra?[this.extra]:[]));document.body.append(this.panel);this.trigger.setAttribute('aria-expanded','true');this.paint();}};
 private paint(){
  const p=this.panel;if(!p)return;const detail=usageDetails(this.meta),content=JSON.stringify(detail);
  if(content!==this.content){
   this.content=content;const head=document.createElement('div');head.className='usage-header';const title=document.createElement('span');title.className='usage-percent';title.textContent='线程用量';const badge=document.createElement('span');badge.className='usage-figures';badge.textContent=detail.label;badge.hidden=!detail.label;head.append(title,badge);
   const rows=document.createElement('dl');rows.className='usage-rows';for(const[label,value]of detail.rows){const row=document.createElement('div');row.className='usage-row';const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);rows.append(row);}
   const notes=document.createElement('div');notes.className='usage-notes';notes.textContent=detail.notes.join('\n');notes.hidden=!detail.notes.length;this.core?.replaceChildren(head,rows,notes);
  }
  this.position();
 }
 private position(){
  const p=this.panel;if(!p)return;
  const r=this.anchor.getBoundingClientRect();p.style.maxHeight=Math.max(48,Math.min(innerHeight-12,r.top-16))+'px';const box=p.getBoundingClientRect();p.style.left=Math.max(6,Math.min(r.right-box.width,innerWidth-box.width-6))+'px';p.style.top=Math.max(6,r.top-box.height-10)+'px';
 }
 attach(element:HTMLElement){this.extra=element;this.panel?.append(element);}
 close=()=>{this.panel?.remove();this.panel=undefined;this.core=undefined;this.content='';this.trigger.setAttribute('aria-expanded','false');};
 private outside=(e:MouseEvent)=>{if(this.panel&&!this.panel.contains(e.target as Node)&&!this.trigger.contains(e.target as Node))this.close();};
 private key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&this.panel){this.close();this.trigger.focus();}};
 private scroll=(e:Event)=>{if(this.panel&&!this.panel.contains(e.target as Node))this.close();};
 dispose=()=>{this.close();this.account?.dispose();this.observer.disconnect();this.trigger.removeEventListener('click',this.toggle);document.removeEventListener('click',this.outside);document.removeEventListener('keydown',this.key);window.removeEventListener('resize',this.close);document.removeEventListener('scroll',this.scroll,true);window.removeEventListener('pagehide',this.dispose);};
}

export const USAGE_STYLE=`
    .usage-control { flex: 0 0 auto; }
    .usage-trigger { color: var(--vscode-descriptionForeground); }
    .usage-action { box-sizing:border-box; width:100%; margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:6px; padding:5px 7px; border:1px solid var(--vscode-button-border,transparent); border-radius:4px; color:var(--vscode-button-secondaryForeground,var(--vscode-foreground)); background:var(--vscode-button-secondaryBackground,transparent); font:inherit; font-size:11px; text-align:left; }
    .usage-action:hover:not(:disabled) { background:var(--vscode-toolbar-hoverBackground); }
    .usage-action:disabled { opacity:.55; cursor:default; }
    .usage-trigger:hover { color: var(--vscode-foreground); background: var(--vscode-toolbar-hoverBackground); }
    .usage-track, .usage-fill { fill: none; stroke-width: 2; }
    .usage-track { stroke: var(--vscode-widget-border); }
    .usage-fill { stroke: var(--vscode-descriptionForeground); stroke-linecap: round; }
    .usage-panel { position: absolute; z-index: 30; right: 0; bottom: calc(100% + 10px); width: min(264px, calc(100vw - 34px)); padding: 12px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; color: var(--vscode-descriptionForeground); background: var(--vscode-menu-background); box-shadow: 0 7px 22px var(--vscode-widget-shadow); font-size: 11px; line-height: 18px; }
    .usage-header { display: flex; align-items: baseline; gap: 5px; }
    .usage-percent, .usage-figures { color: var(--vscode-foreground); font-weight: 600; }
    .usage-figures { margin-left: auto; font-variant-numeric: tabular-nums; }
    .usage-rows { margin: 0; }
    .usage-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 2px 0; }
    .usage-row dt, .usage-row dd { margin: 0; }
    .usage-row dd { color: var(--vscode-foreground); font-variant-numeric: tabular-nums; }
    .usage-trigger.icon-button { width:28px; height:28px; min-width:28px; padding:0; display:grid; place-items:center; border:0; border-radius:6px; background:transparent; }
    .usage-trigger.icon-button:hover { background:var(--vscode-toolbar-hoverBackground); }
    .usage-trigger svg { width:14px; height:14px; }
    /* Fixed quarter arc identifies a details button; it is not a computed progress percentage. */
    .usage-trigger .usage-fill { stroke-dasharray:8.64 34.56; }
    .usage-panel.floating { position:fixed; right:auto; bottom:auto; z-index:90; box-sizing:border-box; max-height:calc(100vh - 12px); overflow:auto; }
    .usage-notes { margin-top:10px; white-space:pre-line; overflow-wrap:anywhere; }
    .usage-panel .usage-header { margin-bottom:8px; }
    .usage-account { margin-bottom:10px; }
    .usage-account .usage-header { align-items:center; gap:8px; }
    .usage-account button { margin-left:auto; min-height:24px; padding:2px 6px; font:inherit; white-space:nowrap; }
    .usage-account-status { white-space:pre-line; overflow-wrap:anywhere; }
    .usage-account-rows > div { margin-top:7px; }
    .usage-account .usage-row { flex-wrap:wrap; }
    .usage-account-percent { color:hsl(var(--quota-hue) 70% var(--quota-color-lightness,68%)); font-variant-numeric:tabular-nums; }
    @media(forced-colors:active) { .usage-account-percent { color:CanvasText; } }
    .usage-account-reset { font-size:10px; overflow-wrap:anywhere; }
    .usage-panel:has(.usage-account:not([hidden])) .usage-thread { border-top:1px solid var(--vscode-widget-border); padding-top:10px; }
    .prototype-composer { display:flex; flex-direction:column; gap:10px; min-width:0; }
    .prototype-run-actions { margin-left:auto; display:flex; align-items:center; gap:4px; }
    .offline-usage-footer { display:flex; justify-content:flex-end; }
`;
