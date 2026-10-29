import type {PageHost} from '../page-host';import type {PageState} from '../page-model';import {FAST_SERVICE_TIER,STANDARD_SERVICE_TIER,type ModelChoice} from '../model-selection';import type {ChatMode} from '../collaboration-mode';import {createSettingsControls} from './settings-controls.js';import {showCopyMenu,showFormulaToast} from './dsh-math-export';
const speedLabel=(tier:string|null|undefined)=>tier===FAST_SERVICE_TIER?'Fast':tier===STANDARD_SERVICE_TIER?'标准':tier??'沿用';
/** Original DSH model/effort controls in the composer; desired next-turn choices are explicit. */
export class ModelPicker{
 private state:PageState|undefined;private controls:ReturnType<typeof createSettingsControls>|undefined;private sequence=0;private signature='';private owner='';private blocked=false;private dead=false;
 private pending:{kind:'model'|'mode';id:number;threadId:string;connectionId:number;timer:ReturnType<typeof setTimeout>}|undefined;private status:HTMLElement;
 private focusSelector:string|undefined;private layoutObserver:ResizeObserver;
 private summary=document.createElement('button');private menu=document.createElement('div');private menuOpen=false;
 private summaryLabel=document.createElement('span');private summaryCaret=document.createElement('span');private fastMark=document.createElement('span');
 get newTurnBlockReason(){return this.pending?'正在核对模型或模式选择，请等待确认':this.blocked?'模型或模式选择结果未知，请窗口 Reload 后核对':this.state?.modelSelection?.selectionError||this.state?.modeSelection?.selectionError||'';}
 get blocksNewTurn(){return !!this.newTurnBlockReason;}
 constructor(private host:PageHost,private target:HTMLElement,private changed:()=>void=()=>{}){this.status=document.createElement('div');this.status.id='model-selection-status';this.status.className='muted';this.status.setAttribute('role','status');this.status.hidden=true;target.closest('#composer')?.querySelector('#usage')?.before(this.status);this.summary.type='button';this.summary.id='model-summary';this.summary.className='model-summary';this.summaryLabel.className='model-summary-label';this.summaryCaret.className='model-caret disclosure-caret';this.summaryCaret.setAttribute('aria-hidden','true');this.fastMark.className='model-fast';this.fastMark.innerHTML='<svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>';this.summary.append(this.fastMark,this.summaryLabel,this.summaryCaret);this.summary.setAttribute('aria-haspopup','dialog');this.summary.setAttribute('aria-expanded','false');this.summary.onclick=event=>{event.stopPropagation();this.setMenuOpen(!this.menuOpen);};this.summary.onkeydown=event=>{if(event.key==='ArrowDown'&&!this.summary.disabled){event.preventDefault();this.setMenuOpen(true);this.menu.querySelector<HTMLButtonElement>('.ds-trigger:not(:disabled)')?.focus();}};this.menu.className='model-menu';this.menu.hidden=true;this.menu.setAttribute('role','dialog');this.menu.setAttribute('aria-label','模型、强度与速度');this.menu.addEventListener('click',this.dropdownOpened);this.target.addEventListener('focusout',this.focusOut);host.messages.addEventListener('message',this.message);document.addEventListener('pointerdown',this.outsideMenu);document.addEventListener('keydown',this.keydown);window.addEventListener('resize',this.positionMenus);this.layoutObserver=new ResizeObserver(this.positionMenus);this.layoutObserver.observe(target);const composer=target.closest('#composer');if(composer)this.layoutObserver.observe(composer);window.addEventListener('pagehide',()=>this.dispose(),{once:true});}
 update(state:PageState){if(this.dead)return;const owner=JSON.stringify([state.threadId,state.connectionId]);if(owner!==this.owner){this.owner=owner;clearTimeout(this.pending?.timer);this.pending=undefined;this.blocked=false;this.signature='';this.focusSelector=undefined;this.setMenuOpen(false);}this.state=state;this.render();}
 private message=(event:MessageEvent)=>{const m=event.data,p=this.pending;if(!p||m?.type!==(p.kind==='model'?'model-selection-result':'chat-mode-result')||m.id!==p.id||m.threadId!==p.threadId||m.connectionId!==p.connectionId)return;clearTimeout(p.timer);this.pending=undefined;if(this.state)this.state={...this.state,...(m.modelSelection?{modelSelection:m.modelSelection}:{}),...(m.modeSelection?{modeSelection:m.modeSelection}:{})};if(!m.ok)showFormulaToast(m.error||'选择未确认',true);this.signature='';this.render();this.changed();};
 private begin(kind:'model'|'mode'){const s=this.state;if(!s?.modelSelection||this.pending||this.blocked)return;const id=++this.sequence,timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.pending=undefined;this.blocked=true;this.signature='';this.render();this.changed();showFormulaToast('选择结果未知；未自动重发，请窗口 Reload 后核对。',true);},15000);this.pending={kind,id,threadId:s.threadId,connectionId:s.connectionId,timer};this.signature='';this.render();this.changed();return{id,threadId:s.threadId,connectionId:s.connectionId};}
 private request(action:'refresh'|'select'|'default'|'inherit'|'default-clear',choice?:ModelChoice){const identity=this.begin('model');if(identity)this.host.postMessage({type:'model-selection',...identity,action,...(choice?{choice}:{})});}
 private requestMode(action:'refresh'|'select',mode?:ChatMode){const identity=this.begin('mode');if(identity)this.host.postMessage({type:'chat-mode',...identity,action,...(mode?{mode}:{})});}
 private render(){const s=this.state,v=s?.modelSelection;this.target.classList.toggle('muted',!v);if(!s||!v){this.focusSelector=undefined;this.controls?.dispose();this.controls=undefined;this.setMenuOpen(false);this.signature='';this.target.classList.remove('model-picks');this.summaryLabel.textContent=s?.model??'';this.fastMark.hidden=true;this.summaryCaret.hidden=true;this.summary.disabled=true;this.target.replaceChildren(this.summary);this.status.hidden=true;return;}this.status.hidden=false;
  const reason=this.blocked?'模型或模式选择结果未知，请窗口 Reload 后核对':this.pending?.kind==='model'?'正在核对模型选择…':v.selectionError||s.modeSelection?.selectionError||v.error||(v.loading?'正在读取模型目录，选项暂不可用':v.stale?'模型目录已过期，请手动刷新后核对':!v.complete?'模型目录尚未完整核对':s.userInputs?.length?'':!v.canSelect?s.approvals.length?'审批期间不能修改模型选择':v.saving?'正在保存模型选择':'当前线程状态不允许修改模型选择':s.busy&&v.nextChoice?`下轮：${v.nextChoice.model} / ${v.nextChoice.effort??'未指定'}；插话仍在本轮`:'');
  const routine=!!this.pending||v.loading||v.saving||!v.canSelect&&(!!s.operating||s.busy||!s.ready)||s.busy&&!!v.nextChoice;
  const note=s.dispatchMode==='daily'&&routine&&!this.blocked&&!v.selectionError&&!s.modeSelection?.selectionError&&!v.error&&!v.stale?'':reason;this.status.textContent=note;this.status.hidden=!note;
  this.target.title=reason||'用于下一回合';
  this.target.setAttribute('aria-busy',String(!!this.pending||v.loading||v.saving));
  const enabled=s.ready&&v.canSelect&&v.complete&&!v.loading&&!v.saving&&!v.stale&&!this.pending&&!this.blocked,signature=JSON.stringify([v.models,v.nextChoice,v.defaultChoice,v.observed,enabled,v.canDefault,!!this.pending,this.blocked,s.modeSelection,s.ready]);if(signature===this.signature)return;this.signature=signature;
  const active=document.activeElement,focused=['.model-select .ds-trigger','.effort-select .ds-trigger','.model-speed','.model-actions','#model-summary'].find(selector=>this.target.querySelector(selector)===active)??(this.menu.contains(active)?active?.closest('.model-select')?'.model-select .ds-trigger':active?.closest('.effort-select')?'.effort-select .ds-trigger':undefined:undefined);
  if(focused)this.focusSelector=focused;else if(active!==document.body)this.focusSelector=undefined;
  this.controls?.dispose();const c=this.controls=createSettingsControls();this.target.classList.add('model-picks');
  const selected=v.nextChoice?.model??'',model=v.models.find(m=>m.model===(selected||v.observed?.model)),effort=v.nextChoice?v.nextChoice.effort??model?.defaultEffort??'':v.observed?.effort??'',modelOptions:[string,string][]=[['',v.observed?`沿用 ${v.observed.model}`:'沿用线程设置（未知）'],...v.models.map(m=>[m.model,m.displayName] as [string,string])];if(selected&&!v.models.some(m=>m.model===selected))modelOptions.push([selected,selected+'（当前目录不可用）']);
  const tier=v.nextChoice?.serviceTier,effectiveTier=tier??v.observed?.serviceTier??model?.defaultServiceTier;
  const modelControl=c.settingsEnum(selected,modelOptions,(value:string)=>{if(!value){this.request('inherit');return;}const entry=v.models.find(m=>m.model===value);if(entry){const nextEffort=entry.efforts.length?entry.efforts.some(e=>e.value===effort)?effort:entry.defaultEffort:entry.defaultEffort,nextTier=effectiveTier===FAST_SERVICE_TIER&&!entry.serviceTiers?.some(t=>t.id===FAST_SERVICE_TIER)?STANDARD_SERVICE_TIER:tier;this.request('select',{model:value,effort:nextEffort,...(nextTier!==undefined?{serviceTier:nextTier}:{})});}});modelControl.classList.add('model-select');const modelSelect=modelControl.querySelector('select')!;modelSelect.disabled=!enabled;modelSelect.setAttribute('aria-label','下一轮模型');for(const option of modelSelect.options){const entry=v.models.find(m=>m.model===option.value);if(option.value&&!entry)option.disabled=true;if(entry)option.title=entry.model+'\n'+entry.description+(entry.availabilityMessage?'\n'+entry.availabilityMessage:'');}
  const effortOptions:[string,string][]=[...(!effort?[['','沿用（强度未知）']as[string,string]]:[]),...(model?.efforts.length?model.efforts.map(e=>[e.value,e.value]as[string,string]):model?[[model.defaultEffort,model.defaultEffort]as[string,string]]:[])];if(effort&&!effortOptions.some(e=>e[0]===effort))effortOptions.push([effort,effort+'（当前目录不可用）']);const effortControl=c.settingsEnum(effort,effortOptions,(value:string)=>{if(value&&model)this.request('select',{model:model.model,effort:value,...(tier!==undefined?{serviceTier:tier}:{})});});effortControl.classList.add('effort-select');const effortSelect=effortControl.querySelector('select')!;effortSelect.disabled=!enabled||!model;effortSelect.setAttribute('aria-label','下一轮思考强度');for(const option of effortSelect.options){const entry=model?.efforts.find(e=>e.value===option.value);if(option.value&&model&&!entry&&option.value!==model.defaultEffort)option.disabled=true;if(entry)option.title=entry.value+'\n'+entry.description;}
  const fast=model?.serviceTiers?.find(t=>t.id===FAST_SERVICE_TIER);
  const modelName=model?.displayName||selected||v.observed?.model||s.model||'模型',speed=effectiveTier?speedLabel(effectiveTier):'';
  this.fastMark.hidden=effectiveTier!==FAST_SERVICE_TIER;this.summaryCaret.hidden=false;
  this.summaryLabel.textContent=modelName+' · '+(effort||'强度?');
  this.summary.title=this.summaryLabel.textContent+(speed?' · '+speed:'');
  this.summary.setAttribute('aria-label',this.summary.title);
  this.summary.disabled=!s.ready||this.blocked;
  this.summary.setAttribute('aria-expanded',String(this.menuOpen));
  const section=(label:string,control:HTMLElement)=>{const box=document.createElement('div');box.className='model-section';const head=document.createElement('div');head.className='model-section-label';head.textContent=label;box.append(head,control);return box;};
  const speedButton=document.createElement('button');speedButton.type='button';speedButton.className='model-speed';speedButton.disabled=!enabled||!model||!effort||!fast&&effectiveTier!==FAST_SERVICE_TIER;speedButton.setAttribute('aria-pressed',String(effectiveTier===FAST_SERVICE_TIER));speedButton.innerHTML='<span class="model-speed-icon"><svg viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg></span><span>快速</span>';speedButton.title=effectiveTier===FAST_SERVICE_TIER?'关闭快速模式':fast?'开启快速模式':'当前模型不支持快速模式';speedButton.onclick=()=>{if(!model||!effort||speedButton.disabled)return;this.request('select',{model:model.model,effort,serviceTier:effectiveTier===FAST_SERVICE_TIER?STANDARD_SERVICE_TIER:FAST_SERVICE_TIER});};
  this.menu.replaceChildren(section('模型',modelControl),section('思考强度',effortControl),speedButton);
  this.setMenuOpen(this.menuOpen);
  const more=document.createElement('button');more.type='button';more.className='model-actions';
  more.textContent=s.modeSelection?.desired==='plan'?'规划 ⋯':'⋯';
  more.title=this.pending?.kind==='mode'?'正在核对聊天模式…':'模型与聊天模式';
  more.setAttribute('aria-label','模型与聊天模式');more.setAttribute('aria-busy',String(this.pending?.kind==='mode'));more.disabled=!!this.pending||this.blocked;
  more.onclick=event=>{
   if(this.pending||this.blocked)return;this.setMenuOpen(false);
   const identity=this.owner,valid=()=>!this.dead&&this.owner===identity&&!this.pending&&!this.blocked;
   const choice=v.nextChoice??(model&&effort?{model:model.model,effort,...(effectiveTier===FAST_SERVICE_TIER||effectiveTier===STANDARD_SERVICE_TIER?{serviceTier:effectiveTier}:{})}:undefined),rect=more.getBoundingClientRect(),modes=s.modeSelection;
   const entries:Parameters<typeof showCopyMenu>[2]=[];
   if(modes)entries.push(
    {label:'普通聊天'+(modes.desired==='default'?' ✓':''),disabledReason:modes.canSelect&&modes.complete&&modes.modes.some(m=>m.mode==='default')?'':'请在空闲时核对模式目录',run:async()=>{this.requestMode('select','default');}},
    {label:'规划模式'+(modes.desired==='plan'?' ✓':''),disabledReason:modes.canSelect&&modes.complete&&modes.modes.some(m=>m.mode==='plan')?'':'请在空闲时核对模式目录',run:async()=>{this.requestMode('select','plan');}},
    {label:'刷新模式目录',disabledReason:s.operating?'会话操作进行中':'',run:async()=>{this.requestMode('refresh');}},
   );
   entries.push({label:'刷新模型目录',run:async()=>{this.request('refresh');}});
   if(v.canDefault&&choice&&v.complete)entries.push({label:'设为本插件新会话默认',run:async()=>{this.request('default',choice);}});
   if(enabled&&model&&effort&&tier!==undefined)entries.push({label:'沿用线程速度',run:async()=>{this.request('select',{model:model.model,effort});}});
   if(v.canSelect)entries.push({label:'沿用线程设置',run:async()=>{this.request('inherit');}});
   if(v.canDefault&&v.defaultChoice)entries.push({label:'清除本插件新会话默认',run:async()=>{this.request('default-clear');}});
   showCopyMenu(new MouseEvent('click',{clientX:rect.right,clientY:rect.top}),valid,entries,()=>true,()=>{if(more.isConnected&&!more.disabled)more.focus({preventScroll:true});},more);event.stopPropagation();
  };
  this.target.replaceChildren(this.summary,more,this.menu);
  // Keep only the control identity while the pending state disables its old button.
  // A deliberate move into the prompt or another control always wins over a late receipt.
  queueMicrotask(()=>{if(this.dead)return;for(const control of [modelControl,effortControl])if(control.isConnected)this.decorateDropdown(control);this.positionMenus();});
  if(!this.pending){const selector=this.focusSelector;this.focusSelector=undefined;if(selector&&(focused||active===document.body)){const next=this.target.querySelector<HTMLButtonElement>(selector);if(next&&!next.disabled&&(selector==='.model-actions'||selector==='#model-summary'||enabled)&&(selector!=='.effort-select .ds-trigger'||model))next.focus({preventScroll:true});}}
 }
 private setMenuOpen(open:boolean,focus=false){this.menuOpen=open&&!this.summary.disabled;this.menu.hidden=!this.menuOpen;this.summary.setAttribute('aria-expanded',String(this.menuOpen));if(this.menuOpen)this.positionMenus();else this.controls?.close();if(focus&&!this.summary.disabled)this.summary.focus({preventScroll:true});}
 private decorateDropdown(control:HTMLElement){control.addEventListener('keydown',()=>queueMicrotask(this.positionMenus),true);}
 private dropdownOpened=(event:MouseEvent)=>{if((event.target as Element).closest('.ds-trigger'))this.positionMenus();};
 private positionMenus=()=>{if(!this.menuOpen||!this.menu.isConnected)return;this.menu.style.transform='';const margin=8,panel=this.menu.getBoundingClientRect(),dx=Math.max(margin-panel.left,Math.min(0,window.innerWidth-margin-panel.right)),dy=Math.max(margin-panel.top,Math.min(0,window.innerHeight-margin-panel.bottom));this.menu.style.transform=`translate(${dx}px,${dy}px)`;for(const menu of this.menu.querySelectorAll<HTMLElement>('.ds-menu:not([hidden])')){const drop=menu.parentElement!,trigger=drop.querySelector<HTMLElement>('.ds-trigger')!,rect=trigger.getBoundingClientRect(),gap=4,above=Math.max(0,rect.top-margin-gap),below=Math.max(0,window.innerHeight-margin-rect.bottom-gap),up=above>=Math.min(300,menu.scrollHeight)||above>=below;menu.classList.remove('align-right');menu.style.left='0';menu.style.right='auto';menu.style.top=up?'auto':`calc(100% + ${gap}px)`;menu.style.bottom=up?`calc(100% + ${gap}px)`:'auto';menu.style.maxHeight=Math.min(300,up?above:below)+'px';const bounds=menu.getBoundingClientRect(),shift=Math.max(margin-bounds.left,Math.min(0,window.innerWidth-margin-bounds.right));menu.style.left=shift+'px';}}
 private keydown=(event:KeyboardEvent)=>{if(event.defaultPrevented||!this.menuOpen||!(event.target instanceof Element)||!this.target.contains(event.target))return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.setMenuOpen(false,true);}else if(event.key==='Tab')this.controls?.close();};
 private focusOut=(event:FocusEvent)=>{if(event.relatedTarget instanceof Node&&this.target.contains(event.relatedTarget))return;queueMicrotask(()=>{if(this.menuOpen&&!this.pending&&!this.target.contains(document.activeElement))this.setMenuOpen(false);});};
 private outsideMenu=(event:PointerEvent)=>{if(!this.menuOpen)return;const target=event.target as Node;if(this.menu.contains(target)||this.summary.contains(target))return;this.setMenuOpen(false);};
 dispose(){this.dead=true;clearTimeout(this.pending?.timer);this.controls?.dispose();this.layoutObserver.disconnect();this.host.messages.removeEventListener('message',this.message);document.removeEventListener('pointerdown',this.outsideMenu);document.removeEventListener('keydown',this.keydown);window.removeEventListener('resize',this.positionMenus);this.target.removeEventListener('focusout',this.focusOut);}
}
export const MODEL_PICKER_STYLE=`
#composer #composer-model.model-picks{position:relative;display:flex;align-items:center;justify-content:flex-end;gap:2px;min-width:0;max-width:100%;margin-left:auto;overflow:visible}
#composer .model-summary{box-sizing:border-box;height:28px;max-width:240px;display:flex;align-items:center;gap:4px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--vscode-foreground);font:inherit;font-size:12px;white-space:nowrap;overflow:hidden}
#composer .model-summary:hover{background:var(--vscode-toolbar-hoverBackground)}
#composer .model-summary[aria-expanded="true"]{background:var(--vscode-toolbar-hoverBackground)}
#composer .model-summary:disabled{opacity:.55}
#composer .model-summary-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#composer .model-caret{flex:0 0 auto;display:flex;align-items:center;opacity:.65}
#composer .model-fast{flex:0 0 auto;display:flex;align-items:center}
#composer .model-fast[hidden]{display:none}
#composer .model-fast svg{width:12px;height:12px;fill:currentColor}
#composer .model-menu{box-sizing:border-box;position:absolute;right:0;bottom:calc(100% + 6px);z-index:45;width:260px;max-width:calc(100vw - 16px);max-height:none;overflow:visible;padding:8px;border:1px solid var(--vscode-widget-border);border-radius:8px;background:var(--vscode-editorWidget-background,var(--vscode-menu-background,#252526));box-shadow:0 6px 18px var(--vscode-widget-shadow);text-align:left}
#composer .model-menu[hidden]{display:none}
#composer .model-section{margin-bottom:7px}
#composer .model-section-label{margin:0 2px 3px;color:var(--vscode-descriptionForeground);font-size:10px;text-align:left}
#composer .model-menu .settings-enum{max-width:none;min-width:0}
#composer .model-menu .ds-drop{width:100%}
#composer .model-menu .ds-trigger{width:100%;max-width:none;justify-content:space-between;font:inherit;font-size:12px;height:28px;padding:3px 7px;border-radius:6px}
#composer .model-menu .ds-menu{box-sizing:border-box;position:absolute;z-index:46;bottom:calc(100% + 4px);left:0;width:max-content;min-width:100%;max-width:min(360px,calc(100vw - 16px));max-height:min(300px,60vh);padding:5px;overflow:auto;border:1px solid var(--vscode-widget-border);border-radius:8px;background:var(--vscode-editorWidget-background,var(--vscode-menu-background,#252526));box-shadow:0 5px 18px var(--vscode-widget-shadow)}
#composer .model-menu .ds-menu[hidden]{display:none}
#composer .model-menu .ds-option[aria-disabled="true"]{opacity:.5;cursor:default}
#composer .model-menu .ds-option:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px;border-radius:4px}
#composer .model-speed{box-sizing:border-box;width:100%;height:28px;display:flex;align-items:center;gap:6px;padding:0 7px;border:1px solid var(--vscode-widget-border);border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;text-align:left}
#composer .model-speed:hover:not(:disabled){background:var(--vscode-toolbar-hoverBackground)}
#composer .model-speed[aria-pressed="true"]{color:var(--vscode-textLink-foreground,var(--vscode-foreground));border-color:color-mix(in srgb,var(--vscode-textLink-foreground) 45%,var(--vscode-widget-border));background:color-mix(in srgb,var(--vscode-textLink-foreground) 12%,transparent)}
#composer .model-speed:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
#composer .model-speed:disabled{opacity:.55;cursor:default}
#composer .model-speed-icon{display:flex;align-items:center}
#composer .model-speed-icon svg{width:12px;height:12px;fill:currentColor}
#composer .model-actions{width:28px;height:28px;border:0;border-radius:6px;background:transparent;padding:0;flex:0 0 auto;color:inherit}#composer .model-actions:hover{background:var(--vscode-toolbar-hoverBackground)}
#model-selection-status{padding:0 12px 5px;font-size:10px;line-height:14px;overflow-wrap:anywhere}
@media(max-width:480px){
 #composer .composer-row:has(.model-picks){display:flex;flex-wrap:wrap}
 #composer #composer-model.model-picks{flex:0 0 100%;width:100%;order:-1;margin-left:0}
 #composer .composer-row:has(.model-picks) .left-actions{flex:0 1 auto;flex-wrap:wrap;max-width:100%}
 #composer .composer-row:has(.model-picks) .prototype-run-actions{flex:0 0 auto;max-width:100%;margin-left:auto}
}
`;
