import type {PageHost} from '../page-host';
import {createSettingsControls} from './settings-controls.js';
import {normalizeDisplaySettings,normalizeContentMaxWidth,type DisplaySettings} from '../display-settings';
import {closeMathMenu} from './dsh-math-export';
import {normalizeHintSeconds} from './hint-duration';
import {normalizeAttachmentLimit,type AttachmentStorageStatus} from '../attachment-policy';
import {RuntimeEnvironmentRead} from './runtime-environment';
import {runtimeEnvironmentRows} from '../runtime-environment';
import {runtimeCapabilityRows} from '../capability-summary';
import {ServiceStatusControl} from './service-status-control';
/** Original controls and read-only runtime facts in the original settings overlay. */
export class DisplaySettingsPanel {
 private panel:HTMLElement;private body:HTMLElement;private status:HTMLElement;private controls:ReturnType<typeof createSettingsControls>|undefined;
 private config=normalizeDisplaySettings(undefined);private enabled=false;private openState=false;private sequence=0;private dead=false;
 private pending=new Map<number,{resolve:()=>void;timer:ReturnType<typeof setTimeout>;renderToken:number}>();private chain:Promise<void>=Promise.resolve();
 private blocked=true;private loadTimer:ReturnType<typeof setTimeout>|undefined;private readId:number|undefined;
 private queued=0;private refreshNeeded=false;
 private retry=document.createElement('button');
 private openButton:HTMLButtonElement;private lastFocus?:HTMLElement;
 private background=new Map<HTMLElement,boolean>();
 private renderToken=0;
 private environment:RuntimeEnvironmentRead;private environmentSection:HTMLElement|undefined;
 private capabilityRows:[string,string][]=[];private capabilitySection:HTMLElement|undefined;
 private services:ServiceStatusControl;
 private storage:AttachmentStorageStatus|undefined;private storageInfo:HTMLElement|undefined;private storageButton:HTMLButtonElement|undefined;private storageRequest:{id:number;timer:ReturnType<typeof setTimeout>}|undefined;
 constructor(private host:PageHost,private apply:(settings:DisplaySettings)=>void){
  this.environment=new RuntimeEnvironmentRead(host,()=>this.renderEnvironment());
  this.services=new ServiceStatusControl(host);
  this.panel=document.createElement('section');this.panel.id='settingsPanel';this.panel.className='settings-panel hidden';this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-label','显示设置');this.panel.setAttribute('aria-modal','true');
  this.panel.innerHTML='<div class="settings-head"><span class="settings-title">设置</span><button id="settingsClose" class="settings-close" title="关闭" aria-label="关闭">✕</button></div><div id="settingsBody" class="settings-body"></div>';
  this.body=this.panel.querySelector('#settingsBody')!;this.status=document.createElement('div');this.status.className='settings-row-hint';this.status.setAttribute('role','status');this.status.hidden=true;
  this.openButton=(document.getElementById('settingsOpen') as HTMLButtonElement)??document.createElement('button');this.openButton.id='settingsOpen';this.openButton.type='button';this.openButton.title='设置';this.openButton.setAttribute('aria-label','设置');if(!this.openButton.firstChild)this.openButton.textContent='⚙';this.openButton.disabled=false;
  this.retry.id='settingsRetry';this.retry.type='button';this.retry.className='ds-trigger';this.retry.textContent='重新读取显示设置';this.retry.onclick=()=>this.read();
  if(!this.openButton.isConnected)(document.querySelector('header')??document.body).append(this.openButton);document.body.append(this.panel);
  this.openButton.addEventListener('click',()=>this.open());this.panel.querySelector('#settingsClose')!.addEventListener('click',()=>this.close());
  this.body.addEventListener('focusout',this.queueRefresh);document.addEventListener('click',this.queueRefresh);
  this.host.messages.addEventListener('message',this.onMessage);document.addEventListener('keydown',this.onKey);window.addEventListener('pagehide',()=>this.dispose(),{once:true});
  this.read(true);
 }
 private feedback(text:string,error=false){this.status.textContent=text;this.status.hidden=!text;this.status.style.color=error?'var(--vscode-errorForeground)':'';}
 private read(initial=false){
  if(this.dead||this.readId!==undefined||this.pending.size||this.queued)return;this.refreshNeeded=false;const id=initial?0:++this.sequence;this.readId=id;this.blocked=true;this.feedback('正在读取显示设置…');this.openButton.title='设置（正在读取保存值）';
  this.loadTimer=setTimeout(()=>{if(this.readId!==id)return;this.readId=undefined;this.feedback('显示设置读取未确认；可重新读取，未改动已保存值。',true);this.openButton.title='设置（读取未确认，可重读）';if(this.openState)this.render();},5000);
  if(this.openState)this.render();this.host.postMessage({type:'settings-read',id});
 }
 private refreshIfIdle(){
  if(!this.refreshNeeded||this.dead||this.blocked||this.readId!==undefined||this.queued||this.pending.size)return;
  const active=document.activeElement;
  if(this.openState&&(active instanceof HTMLElement&&this.body.contains(active)&&active.matches('input,textarea,select')||this.body.querySelector('.ds-trigger[aria-expanded="true"]')))return;
  this.read();
 }
 private queueRefresh=()=>queueMicrotask(()=>this.refreshIfIdle());
 private onKey=(e:KeyboardEvent)=>{
  if(!this.openState||e.defaultPrevented||e.isComposing)return;
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close();return;}
  if(e.key!=='Tab')return;
  const fields=[...this.panel.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],summary,[tabindex]')].filter(field=>field.tabIndex>=0&&!field.matches(':disabled')&&field.getClientRects().length>0);
  const first=fields[0],last=fields.at(-1),active=document.activeElement;
  if(e.shiftKey&&(active===first||!this.panel.contains(active))||!e.shiftKey&&(active===last||!this.panel.contains(active))){e.preventDefault();(e.shiftKey?last:first)?.focus();}
 };
 private restoreBackground(){for(const [element,inert]of this.background)element.inert=inert;this.background.clear();}
 private onMessage=(e:MessageEvent)=>{
  const m=e.data;if(this.dead)return;
  if(m?.type==='state'&&m.state)this.services.update(m.state);
  if(m?.type==='settings-changed'){this.refreshNeeded=true;this.refreshIfIdle();return;}
  if(m?.type==='state'){const rows=runtimeCapabilityRows(m.state);if(JSON.stringify(rows)!==JSON.stringify(this.capabilityRows)){this.capabilityRows=rows;this.renderCapabilities();}const before=!!this.storage;this.setStorage(m.state?.attachmentStorage);if(this.openState&&before!==!!this.storage)this.render();return;}
  if(m?.type==='attachment-storage-result'){const pending=this.storageRequest;if(!pending||m.id!==pending.id)return;clearTimeout(pending.timer);this.storageRequest=undefined;this.setStorage(m.status);this.updateStorage();return;}
  if(m?.type!=='display-settings')return;
  if(this.readId!==undefined&&m.id===this.readId){clearTimeout(this.loadTimer);this.readId=undefined;const retryFocused=document.activeElement===this.retry;if(m.ok&&m.copySettings&&typeof m.copySettings==='object'&&!Array.isArray(m.copySettings)){this.enabled=true;this.blocked=false;this.config=normalizeDisplaySettings(m.copySettings);this.apply(this.config);this.feedback('');this.openButton.title='设置';}else{this.blocked=true;this.feedback('显示设置读取失败；可重新读取，未改动已保存值。',true);this.openButton.title='设置（读取失败，可重读）';}if(this.openState){this.render();if(retryFocused)(this.panel.querySelector('#settingsClose') as HTMLElement).focus();}this.refreshIfIdle();return;}
  const task=this.pending.get(m.id);if(!task)return;clearTimeout(task.timer);this.pending.delete(m.id);
  const oldLimit=this.config.attachmentMaxTotalMB;this.config=normalizeDisplaySettings(m.copySettings);this.apply(this.config);
  this.feedback(m.ok?'':'显示设置保存失败，已恢复保存值；请重试。',!m.ok);this.openButton.setAttribute('aria-busy',String(this.pending.size>0));this.openButton.title='设置';if(this.openState&&(!m.ok||task.renderToken!==this.renderToken||oldLimit!==this.config.attachmentMaxTotalMB))this.render();task.resolve();
 };
 private setStorage(value:AttachmentStorageStatus|undefined){if(value&&this.storage?.checkedAt&&value.checkedAt&&value.checkedAt<this.storage.checkedAt)return;this.storage=value;this.updateStorage();}
 private updateStorage(){
  if(this.storageButton)this.storageButton.disabled=this.blocked||!!this.storageRequest;
  if(!this.storageInfo||!this.storage)return;const s=this.storage,known=Number.isSafeInteger(s.bytes)&&s.bytes!>=0&&Number.isSafeInteger(s.files)&&s.files!>=0,when=typeof s.checkedAt==='number'&&s.checkedAt>0?new Date(s.checkedAt).toLocaleString():'尚未扫描',c=s.collection;
   const section=this.storageInfo.closest('.settings-section');
   const audit=(info:HTMLElement,text:string)=>{info.title=text;const detail=info.nextElementSibling;if(detail)detail.textContent=text;};
   const tempInfo=section?.querySelector<HTMLElement>('[data-temporary-export-storage-status]'),te=s.exports,t=te?.lastTemporary;if(tempInfo){tempInfo.textContent=te?.knownTemporaryRecords===undefined?'尚未统计':te.knownTemporaryRecords===null?'记录数未知':`${te.knownTemporaryRecords} 条暂存记录`;if(t&&(t.changed||t.unknown))tempInfo.textContent+=` · ${t.changed+t.unknown} 项待核对`;audit(tempInfo,t?`上次核对：${new Date(t.checkedAt).toLocaleString()}；清理 ${t.removed} 项 / ${t.bytes} 字节，变化保留 ${t.changed} 项，未核实 ${t.unknown} 项`:'暂无清理记录');}
   const exportInfo=section?.querySelector<HTMLElement>('[data-export-storage-status]'),e=s.exports,x=e?.last;if(exportInfo){exportInfo.textContent=e?`保留 ${e.retentionDays} 天 · `+(e.knownRecords===null?'记录数未知':`${e.knownRecords} 条记录`)+(e.error?' · 状态未确认：'+e.error:''):'尚未统计';if(x&&(x.changed||x.unknown))exportInfo.textContent+=` · ${x.changed+x.unknown} 项待核对`;audit(exportInfo,x?`上次清理：${new Date(x.checkedAt).toLocaleString()}；${x.removed} 项 / ${x.bytes} 字节，变化保留 ${x.changed} 项，未核实 ${x.unknown} 项`:'暂无清理记录');}
  this.storageInfo.textContent=(known?`${(s.bytes!/1024/1024).toLocaleString(undefined,{maximumFractionDigits:2})} MiB · ${s.files} 个文件`:`文件大小未知：${s.sizeError||'未取得完整统计'}`)+(s.maintenanceError?'；'+s.maintenanceError:'')+(e?.error?'；导出副本状态未确认：'+e.error:'')+(known&&s.limitMB!==-1&&s.bytes!>s.limitMB*1024*1024?'；已超过上限；已有受保护来源保留，新增导入需先调整或清理':'');this.storageInfo.title='统计时间：'+when;
   const collectionInfo=section?.querySelector<HTMLElement>('[data-attachment-collection-status]');if(collectionInfo){collectionInfo.textContent=c?`清理 ${c.removed} 组`+(c.remaining?` · 待检查 ${c.remaining} 组`:'')+(c.unobserved?` · 未确认 ${c.unobserved} 组`:'')+(c.changed?` · 变化保留 ${c.changed} 组`:''):'';audit(collectionInfo,`统计时间：${when}`+(c?`；受引用保护 ${c.referenced} 组，交付未确认 ${c.unobserved} 组，变化保留 ${c.changed} 组`:''));const row=collectionInfo.closest<HTMLElement>('.settings-row');if(row)row.hidden=!c;}
 }
 private checkStorage(){if(this.dead||this.blocked||this.storageRequest||!this.storage)return;const id=++this.sequence,timer=setTimeout(()=>{this.storageRequest=undefined;this.updateStorage();if(this.storageInfo)this.storageInfo.textContent='存储检查未确认；未自动重试，可核对后手动再检查。';},15000);this.storageRequest={id,timer};this.updateStorage();if(this.storageInfo)this.storageInfo.textContent='正在检查大小并安全清理无引用副本…';this.host.postMessage({type:'attachment-storage-check',id});}
 private commit=(key:string,value:unknown)=>{
  if(this.blocked||!this.enabled)return;const renderToken=this.renderToken;this.queued++;
  this.feedback('');this.openButton.setAttribute('aria-busy','true');this.openButton.title='设置（正在保存）';
  this.chain=this.chain.then(()=>{if(this.dead||this.blocked)return;return new Promise<void>(resolve=>{
   const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);this.blocked=true;this.feedback('未收到保存确认，当前保存状态未知；重新读取后再修改，不会自动重试保存。',true);this.openButton.setAttribute('aria-busy','false');this.openButton.title='设置（保存状态未知，可重读）';if(this.openState)this.render();resolve();},5000);
   // A failed earlier save or reopening the dialog can rebuild these controls
   // before this queued edit is confirmed. Its receipt must reconcile that view.
   this.pending.set(id,{resolve,timer,renderToken});this.host.postMessage({type:'settings-save',id,key,value});
  });}).finally(()=>{this.queued--;this.refreshIfIdle();});
 };
 open(){if(this.dead||this.openState)return;closeMathMenu();this.lastFocus=document.activeElement as HTMLElement;this.openState=true;this.panel.classList.remove('hidden');if(this.enabled&&!this.blocked&&this.readId===undefined&&!this.queued)this.read();else this.render();this.environment.refresh();(this.panel.querySelector('#settingsClose') as HTMLElement).focus();for(const element of document.body.children)if(element instanceof HTMLElement&&element!==this.panel){this.background.set(element,element.inert);element.inert=true;}}
 close(){this.controls?.close();this.environment.close();this.services.close();this.openState=false;this.panel.classList.add('hidden');this.restoreBackground();(this.lastFocus?.isConnected?this.lastFocus:this.openButton).focus();this.refreshIfIdle();}
 private renderEnvironment(){
  if(!this.openState||!this.controls)return;const c=this.controls,section=c.settingsSection('运行环境');section.dataset.runtimeEnvironment='';section.style.overflowWrap='anywhere';
  const state=this.environment.state;
   if(state.phase==='ready'&&state.value)section.append(...runtimeEnvironmentRows(state.value).map(([label,hint])=>c.settingsRow(label,hint,undefined)));
   else {const info=c.settingsRow('本地运行环境',state.phase==='loading'?'正在读取…':'读取失败，重新打开设置可重试',undefined);info.setAttribute('role','status');section.append(info);}
  if(this.environmentSection?.isConnected)this.environmentSection.replaceWith(section);this.environmentSection=section;
 }
 private renderCapabilities(){
  if(!this.openState||!this.controls)return;
  if(!this.capabilityRows.length){this.capabilitySection?.remove();this.capabilitySection=undefined;return;}
  const section=this.controls.settingsSection('能力范围');section.dataset.runtimeCapabilities='';section.style.overflowWrap='anywhere';
   section.append(...this.capabilityRows.map(([label,hint])=>this.controls!.settingsRow(label,hint,undefined)));
  const scroll=this.body.scrollTop;
  if(this.capabilitySection?.isConnected)this.capabilitySection.replaceWith(section);else if(this.environmentSection?.isConnected)this.environmentSection.before(section);
  this.capabilitySection=section;this.body.scrollTop=scroll;
 }
 private render(){
  const priorFocus=document.activeElement instanceof HTMLElement&&this.body.contains(document.activeElement)?document.activeElement:undefined;
  // Reattaching retry/service controls loses DOM focus; disabled controls need
  // a stable target while their asynchronous request is pending.
  const restoreActionFocus=()=>{if(!priorFocus||this.panel.contains(document.activeElement))return;const target=priorFocus.isConnected&&!priorFocus.matches(':disabled')&&!priorFocus.hidden?priorFocus:this.panel.querySelector<HTMLElement>('#settingsClose');target?.focus({preventScroll:true});};
  if(!this.enabled){this.controls?.dispose();this.controls=undefined;this.renderToken++;this.storageInfo=undefined;this.storageButton=undefined;this.environmentSection=undefined;this.capabilitySection=undefined;this.retry.hidden=false;this.retry.disabled=this.readId!==undefined;this.body.replaceChildren(this.status,this.retry);restoreActionFocus();return;}
  const active=document.activeElement,controlFocus=active instanceof HTMLElement&&active.matches('[role="option"]')?active.closest('.ds-drop')?.querySelector('.ds-trigger'):active,focusRow=controlFocus instanceof HTMLElement&&this.body.contains(controlFocus)?controlFocus.closest<HTMLElement>('[data-setting]'):null,focusSetting=focusRow?.dataset.setting,focusIndex=focusRow?Array.from(focusRow.querySelectorAll('button,input,select')).indexOf(controlFocus as HTMLElement):-1;
  const focusedSummary=active instanceof HTMLElement&&active.tagName==='SUMMARY'&&this.body.contains(active)?active:undefined,focusAudit=focusedSummary?.parentElement?.dataset.storageAudit;
  const scroll=this.body.scrollTop;this.controls?.dispose();const c=this.controls=createSettingsControls(),s=this.config,section=c.settingsSection('复制'),token=++this.renderToken;
  const commit=(key:string,value:unknown)=>{if(this.openState&&token===this.renderToken&&!this.dead)this.commit(key,value);};
  const row=(key:string,label:string,hint:string,control:HTMLElement)=>{const r=c.settingsRow(label,hint,control);r.dataset.setting=key;section.append(r);};
  row('copy.mathButtons','公式复制按钮','',c.settingsSwitch(s.mathButtons,v=>commit('copy.mathButtons',v)));
  row('copy.blockButtons','块级复制按钮','',c.settingsSwitch(s.blockButtons,v=>commit('copy.blockButtons',v)));
  row('copy.mathFormat','公式按钮输出格式','',c.settingsEnum(s.mathFormat,[['markdown','Markdown（$ / $$）'],['tex','TeX 源'],['tex-delimited','TeX + 定界符'],['mathml','MathML']],v=>commit('copy.mathFormat',v)));
  row('copy.plainMathFormat','纯文本复制中的公式','',c.settingsEnum(s.plainMathFormat,[['tex','TeX 源'],['tex-delimited','TeX + 定界符']],v=>commit('copy.plainMathFormat',v)));
  row('copy.codeCopyFormat','代码块复制输出','',c.settingsEnum(s.codeCopyFormat,[['text','纯文本'],['markdown','含围栏']],v=>commit('copy.codeCopyFormat',v)));
  row('copy.mathSvgColor','公式复制颜色','仅影响「复制为 SVG」',c.settingsColorPicker(s.mathSvgColor,v=>commit('copy.mathSvgColor',v)));
  row('copy.svgPngEdge','PNG 最长边','公式位图的最长边',c.settingsEnum(s.svgPngEdge,[['screen','跟随屏显（4×）'],['512','512'],['1024','1024（默认）'],['2048','2048']],v=>commit('copy.svgPngEdge',v)));
  row('copy.feedbackSeconds','复制反馈时长','秒（0.2–6，可小数）',c.settingsNumber(Math.round(s.feedbackMs/100)/10,.2,6,v=>commit('copy.feedbackSeconds',v),.1));
  const fold=c.settingsSection('消息折叠'),foldRow=(key:string,label:string,hint:string|undefined,control:HTMLElement)=>{const r=c.settingsRow(label,hint,control);r.dataset.setting=key;fold.append(r);};
  foldRow('fold.enabled','长用户消息自动折叠',undefined,c.settingsSwitch(s.userFoldEnabled,v=>commit('fold.enabled',v)));
  foldRow('fold.triggerRatio','触发阈值','视口高度的比例（0.1–3）',c.settingsNumber(s.userFoldTriggerRatio,.1,3,v=>commit('fold.triggerRatio',v),.1));
  foldRow('fold.previewLines','预览行数','折叠后显示的行数（1–20）',c.settingsNumber(s.userFoldPreviewLines,1,20,v=>commit('fold.previewLines',v)));
  foldRow('fold.minFoldExtraLines','保底折叠行数','至少超出的行数（0–50）',c.settingsNumber(s.userFoldMinExtraLines,0,50,v=>commit('fold.minFoldExtraLines',v)));
  foldRow('fold.minChars','正文豁免字符门槛','短于此长度不折叠（0–20000）',c.settingsNumber(s.userFoldMinChars,0,20000,v=>commit('fold.minChars',v),10));
  foldRow('fold.blockMinLines','超高块折叠行数','超过此行数显示折叠按钮',c.settingsNumber(s.blockMinLines,1,50,v=>commit('fold.blockMinLines',v)));
  foldRow('fold.workSegments','工作过程自动折叠','回合结束后收起过程；运行中不折叠',c.settingsSwitch(s.workSegments,v=>commit('fold.workSegments',v)));
  foldRow('fold.changedFiles','变更文件自动折叠','超过行数时折叠变更文件',c.settingsSwitch(s.changedFiles,v=>commit('fold.changedFiles',v)));
  foldRow('fold.changedFilesLines','变更文件预览行数','折叠时保留的行数（1–50）',c.settingsNumber(s.changedFilesLines,1,50,v=>commit('fold.changedFilesLines',v)));
   const image=c.settingsSection('图片'),imageRow=c.settingsRow('右键菜单默认档',undefined,c.settingsEnum(s.imageCopyFormat,[['original','复制原格式优先'],['png','复制 PNG 优先']],v=>commit('imageCopyFormat',v)));imageRow.dataset.setting='imageCopyFormat';image.append(imageRow);
   for(const [key,label,hint,value,min,max,step] of [['preview.minScale','预览最小缩放','倍（0.005–1）',s.previewMinScale,.005,1,.005],['preview.maxScale','预览最大缩放','倍（1–64）',s.previewMaxScale,1,64,1]] as const){const r=c.settingsRow(label,hint,c.settingsNumber(value,min,max,v=>commit(key,v),step));r.dataset.setting=key;image.append(r);}
    const autoplay=c.settingsRow('动图预览自动播放',undefined,c.settingsSwitch(s.gifAutoplay,v=>commit('preview.gifAutoplay',v)));autoplay.dataset.setting='preview.gifAutoplay';image.append(autoplay);
    for(const [key,label,hint,value,max] of [['preview.maxFrames','选帧器抽样数量','一次抽取的帧数（1–240）',s.maxFrames,240],['preview.maxFrameSelections','最多选择发送帧',`每张动图（1–60）`,s.maxFrameSelections,60]] as const){const r=c.settingsRow(label,hint,c.settingsNumber(value,1,max,v=>commit(key,v)));r.dataset.setting=key;image.append(r);}
   const perf=c.settingsSection('性能'),hover=c.settingsRow('动作行悬停显示',undefined,c.settingsSwitch(s.hoverActions,v=>commit('ui.hoverActions',v)));hover.dataset.setting='ui.hoverActions';perf.append(hover);
   const lazy=c.settingsRow('折叠工具卡按需构建',undefined,c.settingsSwitch(s.lazyFoldedBodies,v=>commit('ui.lazyFoldedBodies',v)));lazy.dataset.setting='ui.lazyFoldedBodies';perf.append(lazy);
    const appearance=c.settingsSection('外观'),motion=c.settingsRow('加载动效',undefined,c.settingsEnum(s.animationStyle,[['standard','标准'],['dots','跳点'],['off','关闭']],v=>commit('animationStyle',v)));motion.dataset.setting='animationStyle';appearance.append(motion);
    const hint=c.settingsRow('提示条显示时长','临时提示的显示时长（1–60 秒）',c.settingsNumber(s.hintSeconds,1,60,v=>commit('ui.hintSeconds',v),1,normalizeHintSeconds));hint.dataset.setting='ui.hintSeconds';appearance.append(hint);
    const width=c.settingsRow('内容列最大宽度','正文最大宽度（px，-1 = 不限）',c.settingsNumber(s.contentMaxWidth,-1,4000,v=>commit('ui.contentMaxWidth',v),20,normalizeContentMaxWidth));width.dataset.setting='ui.contentMaxWidth';appearance.append(width);
    const tabWidth=c.settingsRow('会话栏标签最小宽度','会话标签最小宽度（68–200）',c.settingsNumber(s.sessionTabMinWidth,68,200,v=>commit('ui.sessionTabMinWidth',v),4));tabWidth.dataset.setting='ui.sessionTabMinWidth';appearance.append(tabWidth);
    for(const [key,label,value]of [['ui.sessionTabRenameButton','标签悬停显示重命名按钮',s.sessionTabRenameButton],['ui.sessionTabArchiveButton','标签悬停显示归档按钮',s.sessionTabArchiveButton]]as const){const r=c.settingsRow(label,'关闭后仍可用右键菜单',c.settingsSwitch(value,v=>commit(key,v)));r.dataset.setting=key;appearance.append(r);}
    const session=c.settingsSection('会话'),remember=c.settingsRow('滚动位置记忆',undefined,c.settingsSwitch(s.scrollMemory,v=>commit('sessionViewMemory.scroll',v)));remember.dataset.setting='sessionViewMemory.scroll';session.append(remember);
    const rememberTool=c.settingsRow('工具卡展开记忆',undefined,c.settingsSwitch(s.expandMemory,v=>commit('sessionViewMemory.expand',v)));rememberTool.dataset.setting='sessionViewMemory.expand';session.append(rememberTool);
    const rememberFold=c.settingsRow('长消息折叠记忆',undefined,c.settingsSwitch(s.foldMemory,v=>commit('sessionViewMemory.fold',v)));rememberFold.dataset.setting='sessionViewMemory.fold';session.append(rememberFold);
    const allHistory=c.settingsRow('打开会话时加载全部历史',undefined,c.settingsSwitch(s.historyLoadAll,v=>commit('sessionHistory.loadAll',v)));allHistory.dataset.setting='sessionHistory.loadAll';session.append(allHistory);
    const historyLimit=c.settingsRow('全量加载上限','自动补读的消息上限（默认 3000）',c.settingsNumber(s.historyMaxMessages,500,20000,v=>commit('sessionHistory.maxMessages',v),500));historyLimit.dataset.setting='sessionHistory.maxMessages';session.append(historyLimit);
    const scrollbar=c.settingsRow('滚动条方式','自绘轨道或系统滚动条',c.settingsEnum(s.railScrollbar,[['custom','自绘（节点+滑块）'],['native','原生滚动条']],v=>commit('turnRail.scrollbar',v)));scrollbar.dataset.setting='turnRail.scrollbar';session.append(scrollbar);
    const badge=c.settingsRow('节点编号徽标','滚动时显示当前节点编号',c.settingsSwitch(s.railNodeBadge,v=>commit('turnRail.nodeBadge',v)));badge.dataset.setting='turnRail.nodeBadge';session.append(badge);
    const summary=c.settingsRow('节点摘要长度','悬停摘要保留的字数（24–80）',c.settingsNumber(s.railSummaryLength,24,80,v=>commit('turnRail.summaryLength',v),4));summary.dataset.setting='turnRail.summaryLength';session.append(summary);
    const number=c.settingsRow('节点编号格式',undefined,c.settingsEnum(s.railNumberStyle,[['compact','N/M'],['full','第 N/M 个节点'],['legacy','第 N 轮']],v=>commit('turnRail.numberStyle',v)));number.dataset.setting='turnRail.numberStyle';session.append(number);
    const twoLine=c.settingsRow('节点提示两行显示',undefined,c.settingsSwitch(s.railTipTwoLine,v=>commit('turnRail.tipTwoLine',v)));twoLine.dataset.setting='turnRail.tipTwoLine';session.append(twoLine);
    const noteStyle=c.settingsRow('标注提示样式','标注提示显示标注或摘要',c.settingsEnum(s.railMarkNoteOnly?'note':'full',[['note','只显示标注内容'],['full','标注 + 编号 · 摘要']],v=>commit('turnRail.markNoteOnly',v==='note')));noteStyle.dataset.setting='turnRail.markNoteOnly';session.append(noteStyle);
    const markColor=c.settingsRow('收藏节点颜色',undefined,c.settingsColorPicker(s.railMarkColor,v=>commit('turnRail.markColor',v)));markColor.dataset.setting='turnRail.markColor';session.append(markColor);
    for(const[key,label,hint,value,min,max,step]of [['turnRail.minGap','节点最小间距','节点最小间距（12–96）',s.railMinGap,12,96,1],['turnRail.dragEdgePx','拖拽滚列 · 触发带宽','拖拽到边缘的触发范围（px）',s.railDragEdgePx,8,200,4],['turnRail.dragSpeed','拖拽滚列 · 最大速度','拖拽滚列的最大速度（px/秒）',s.railDragSpeed,100,3000,50]] as const){const r=c.settingsRow(label,hint,c.settingsNumber(value,min,max,v=>commit(key,v),step));r.dataset.setting=key;session.append(r);}
    const conversation=c.settingsSection('对话交互'),busyEnter=c.settingsRow('运行中发送消息','运行中按 Enter 执行的操作',c.settingsEnum(s.busyEnter,[['queue','排队（等本轮结束再发送）'],['steer','插话（立刻引导当前回合）']],v=>commit('ui-conversation.busyEnter',v)));busyEnter.dataset.setting='ui-conversation.busyEnter';conversation.append(busyEnter);
    const notifications=c.settingsRow('任务通知','后台时提醒任务结果',c.settingsEnum(s.taskNotifications,[['all','全部任务结果'],['attention','仅需处理'],['off','关闭']],v=>commit('notifications.tasks',v)));notifications.dataset.setting='notifications.tasks';conversation.append(notifications);
    const attach=c.settingsSection('附件');for(const[key,label,hint,value,max]of [['attach.maxFiles','单次附件数',`一次加入的文件数（1–200）`,s.attachmentBatchMaxFiles,200],['attach.maxTotalMB','单次附件总大小','一次加入的总大小（MiB）',s.attachmentBatchMaxTotalMB,2048]] as const){const r=c.settingsRow(label,hint,c.settingsNumber(value,1,max,v=>commit(key,v)));r.dataset.setting=key;attach.append(r);}
    const search=c.settingsSection('搜索'),searchColor=c.settingsRow('命中高亮颜色',undefined,c.settingsColorPicker(s.searchHighlightColor,v=>commit('search.highlightColor',v)));searchColor.dataset.setting='search.highlightColor';search.append(searchColor);
    const snippetMode=c.settingsRow('长片段显示',undefined,c.settingsEnum(s.searchSnippetView,[['peek','悬停覆盖层'],['pane','底部详情区']],v=>commit('search.snippetView',v)));snippetMode.dataset.setting='search.snippetView';search.append(snippetMode);
    const resultOrder=c.settingsRow('结果排序','组内按最近或时间正序',c.settingsEnum(s.searchResultOrder,[['recent','最近优先'],['oldest','时间正序']],v=>commit('search.resultOrder',v)));resultOrder.dataset.setting='search.resultOrder';search.append(resultOrder);
    const returnPill=c.settingsRow('搜索返回提示','跨会话定位后显示返回入口',c.settingsSwitch(s.searchReturnPill,v=>commit('search.returnPill',v)));returnPill.dataset.setting='search.returnPill';search.append(returnPill);
    const returnSeconds=c.settingsRow('返回提示显示时长','返回提示的显示时长（秒）',c.settingsNumber(s.searchReturnPillSeconds,3,120,v=>commit('search.returnPillSeconds',v)));returnSeconds.dataset.setting='search.returnPillSeconds';search.append(returnSeconds);
    const sections:HTMLElement[]=[section,fold,image,attach,appearance,session,search,conversation,perf];this.storageInfo=undefined;this.storageButton=undefined;
     if(this.storage){
      const storage=c.settingsSection('附件存储'),limit=s.attachmentMaxTotalMB,limitRow=c.settingsRow('附件存储上限',limit===-1?'不限容量（-1）；仍清理无引用副本':'MiB（16–4096），-1 = 不限容量',c.settingsNumber(limit,-1,4096,v=>commit('attachmentStore.maxTotalMB',v),16,normalizeAttachmentLimit),limit===-1);limitRow.dataset.setting='attachmentStore.maxTotalMB';
      const info=this.storageInfo=document.createElement('div');info.className='settings-row-hint';info.dataset.attachmentStorageStatus='';info.setAttribute('role','status');
      const button=this.storageButton=document.createElement('button');button.type='button';button.className='ds-trigger settings-action';button.textContent='检查与清理';button.title='检查并清理无引用副本';button.onclick=()=>this.checkStorage();const usage=c.settingsRow('本地附件副本',undefined,button);usage.querySelector('.settings-row-text')!.append(info);storage.append(limitRow,usage);
      for(const [label,key]of [['附件副本','attachmentCollectionStatus'],['剪贴板导出副本','exportStorageStatus'],['导出暂存','temporaryExportStorageStatus']] as const){
       const row=c.settingsRow(label,undefined,undefined),details=document.createElement('details'),summary=document.createElement('summary'),audit=document.createElement('div');details.className='settings-storage-audit';details.dataset.storageAudit=key;details.open=this.body.querySelector<HTMLDetailsElement>(`[data-storage-audit="${key}"]`)?.open??false;summary.className=audit.className='settings-row-hint';summary.dataset[key]='';details.append(summary,audit);row.querySelector('.settings-row-text')!.append(details);storage.append(row);
      }
      sections.push(storage);this.updateStorage();
     }
    const services=c.settingsSection('工具与应用');services.dataset.serviceStatus='';services.append(this.services.element);sections.push(services);
    this.renderCapabilities();if(this.capabilitySection)sections.push(this.capabilitySection);this.renderEnvironment();if(this.environmentSection)sections.push(this.environmentSection);
    // Preference-save uncertainty cannot grant or disable independent read-only service queries.
    this.body.replaceChildren(...sections,this.status);if(this.blocked)this.body.querySelectorAll('button,input,select').forEach(e=>{if(!this.services.element.contains(e))(e as HTMLInputElement).disabled=true;});this.retry.hidden=!this.blocked;this.retry.disabled=this.readId!==undefined;this.body.append(this.retry);this.body.scrollTop=scroll;
    if(focusSetting&&focusIndex>=0){const row=Array.from(this.body.querySelectorAll<HTMLElement>('[data-setting]')).find(row=>row.dataset.setting===focusSetting),next=row?.querySelectorAll<HTMLElement>('button,input,select')[focusIndex];if(next&&!next.matches(':disabled')&&next.getClientRects().length)next.focus({preventScroll:true});else if(this.blocked&&!this.retry.disabled)this.retry.focus({preventScroll:true});}
    else if(focusedSummary){const next=focusAudit?Array.from(this.body.querySelectorAll<HTMLElement>('[data-storage-audit]')).find(e=>e.dataset.storageAudit===focusAudit)?.querySelector('summary'):focusedSummary;if(next?.isConnected&&next.getClientRects().length)next.focus({preventScroll:true});}
    restoreActionFocus();
 }
 dispose(){this.dead=true;this.restoreBackground();this.environment.dispose();this.services.dispose();clearTimeout(this.loadTimer);clearTimeout(this.storageRequest?.timer);this.controls?.dispose();for(const task of this.pending.values()){clearTimeout(task.timer);task.resolve();}this.pending.clear();this.host.messages.removeEventListener('message',this.onMessage);document.removeEventListener('keydown',this.onKey);this.body.removeEventListener('focusout',this.queueRefresh);document.removeEventListener('click',this.queueRefresh);}
}
