/** Display copy preferences. No VS Code configuration, RPC, file or tool access. */
import {normalizeHintSeconds} from './display/hint-duration';
import {isMotionStyle,type MotionStyle} from './display/activity';
import {HISTORY_LOAD_DEFAULTS,validHistoryMaximum} from './history-preferences';
import {ATTACHMENT_STORE_DEFAULT_MB,validAttachmentLimit,ATTACHMENT_BATCH_DEFAULTS,validAttachmentBatchFiles,validAttachmentBatchMB} from './attachment-policy';
export interface DisplaySettings {taskNotifications:'all'|'attention'|'off';searchReturnPill:boolean;searchReturnPillSeconds:number;searchResultOrder:'recent'|'oldest';searchSnippetView:'peek'|'pane';searchHighlightColor:string;railMarkNoteOnly:boolean;railMarkColor:string;railSummaryLength:number;railNumberStyle:'compact'|'full'|'legacy';railTipTwoLine:boolean;railMinGap:number;railDragEdgePx:number;railDragSpeed:number;historyLoadAll:boolean;historyMaxMessages:number;railNodeBadge:boolean;railScrollbar:'custom'|'native';changedFiles:boolean;changedFilesLines:number;attachmentMaxTotalMB:number;attachmentBatchMaxFiles:number;attachmentBatchMaxTotalMB:number;gifAutoplay:boolean;maxFrames:number;maxFrameSelections:number;sessionTabMinWidth:number;sessionTabRenameButton:boolean;sessionTabArchiveButton:boolean;busyEnter:'queue'|'steer';animationStyle:MotionStyle;hintSeconds:number;lazyFoldedBodies:boolean;workSegments:boolean;expandMemory:boolean;foldMemory:boolean;scrollMemory:boolean;previewMinScale:number;previewMaxScale:number;contentMaxWidth:number;imageCopyFormat:'original'|'png';hoverActions:boolean;userFoldEnabled:boolean;userFoldPreviewLines:number;userFoldTriggerRatio:number;userFoldMinExtraLines:number;userFoldMinChars:number;blockMinLines:number;mathButtons:boolean;blockButtons:boolean;mathFormat:'markdown'|'tex'|'tex-delimited'|'mathml';plainMathFormat:'tex'|'tex-delimited';codeCopyFormat:'text'|'markdown';mathSvgColor:string;svgPngEdge:'screen'|'512'|'1024'|'2048';feedbackMs:number}
export const DISPLAY_SETTINGS_KEY='codexPrototype.displaySettings.v1';
export const DISPLAY_DEFAULTS:Readonly<DisplaySettings>=Object.freeze({taskNotifications:'all',searchReturnPill:true,searchReturnPillSeconds:12,searchResultOrder:'recent',searchSnippetView:'peek',searchHighlightColor:'theme',railMarkNoteOnly:true,railMarkColor:'theme',railSummaryLength:40,railNumberStyle:'compact',railTipTwoLine:false,railMinGap:20,railDragEdgePx:64,railDragSpeed:800,historyLoadAll:HISTORY_LOAD_DEFAULTS.loadAll,historyMaxMessages:HISTORY_LOAD_DEFAULTS.maxMessages,railNodeBadge:true,railScrollbar:'custom',changedFiles:true,changedFilesLines:6,attachmentMaxTotalMB:ATTACHMENT_STORE_DEFAULT_MB,attachmentBatchMaxFiles:ATTACHMENT_BATCH_DEFAULTS.maxFiles,attachmentBatchMaxTotalMB:ATTACHMENT_BATCH_DEFAULTS.maxTotalMB,gifAutoplay:true,maxFrames:60,maxFrameSelections:12,sessionTabMinWidth:112,sessionTabRenameButton:true,sessionTabArchiveButton:true,busyEnter:'queue',animationStyle:'standard',hintSeconds:4,lazyFoldedBodies:true,workSegments:true,expandMemory:true,foldMemory:true,scrollMemory:true,previewMinScale:.01,previewMaxScale:32,contentMaxWidth:760,imageCopyFormat:'original',hoverActions:true,userFoldEnabled:true,userFoldPreviewLines:4,userFoldTriggerRatio:.5,userFoldMinExtraLines:3,userFoldMinChars:100,blockMinLines:3,mathButtons:true,blockButtons:true,mathFormat:'markdown',plainMathFormat:'tex',codeCopyFormat:'text',mathSvgColor:'theme',svgPngEdge:'1024',feedbackMs:1000});
export function normalizeContentMaxWidth(raw:number){return raw===-1?-1:Math.min(4000,Math.max(320,Math.round(raw)));}
export interface DisplayStateStorage {get<T>(key:string,fallback:T):T;update(key:string,value:unknown):Thenable<void>|Promise<void>}
function valid(key:string,value:unknown):boolean {
 switch(key){
   case 'taskNotifications':return value==='all'||value==='attention'||value==='off';
   case 'searchReturnPill':return typeof value==='boolean';
   case 'searchReturnPillSeconds':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=3&&value<=120;
   case 'railMarkNoteOnly':return typeof value==='boolean';
   case 'searchResultOrder':return value==='recent'||value==='oldest';
   case 'searchSnippetView':return value==='peek'||value==='pane';
   case 'searchHighlightColor':case 'railMarkColor':return typeof value==='string'&&(value==='theme'||/^#[0-9a-f]{6}$/i.test(value));
   case 'railSummaryLength':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=24&&value<=80;
   case 'railNumberStyle':return value==='compact'||value==='full'||value==='legacy';
   case 'railTipTwoLine':return typeof value==='boolean';
   case 'railMinGap':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=12&&value<=96;
   case 'railDragEdgePx':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=8&&value<=200;
   case 'railDragSpeed':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=100&&value<=3000;
   case 'historyLoadAll':return typeof value==='boolean';
   case 'historyMaxMessages':return validHistoryMaximum(value);
   case 'railNodeBadge':return typeof value==='boolean';
   case 'railScrollbar':return value==='custom'||value==='native';
   case 'changedFiles':return typeof value==='boolean';
   case 'changedFilesLines':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=50;
   case 'attachmentMaxTotalMB':return validAttachmentLimit(value);
   case 'attachmentBatchMaxFiles':return validAttachmentBatchFiles(value);
   case 'attachmentBatchMaxTotalMB':return validAttachmentBatchMB(value);
   case 'gifAutoplay':return typeof value==='boolean';
   case 'maxFrames':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=240;
   case 'maxFrameSelections':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=60;
   case 'busyEnter':return value==='queue'||value==='steer';
   case 'sessionTabMinWidth':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=68&&value<=200;
   case 'animationStyle':return isMotionStyle(value);
   case 'previewMinScale':return typeof value==='number'&&Number.isFinite(value)&&value>=.005&&value<=1&&Math.round(value*1000)/1000===value;
   case 'previewMaxScale':return typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=64;
   case 'contentMaxWidth':return typeof value==='number'&&Number.isSafeInteger(value)&&(value===-1||value>=320&&value<=4000);
  case 'hintSeconds':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=60;
  case 'imageCopyFormat':return value==='original'||value==='png';
  case 'userFoldEnabled':return typeof value==='boolean';
  case 'userFoldPreviewLines':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=20;
  case 'userFoldTriggerRatio':return typeof value==='number'&&Number.isFinite(value)&&value>=.1&&value<=3;
  case 'userFoldMinExtraLines':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=50;
  case 'userFoldMinChars':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=20000;
  case 'blockMinLines':return typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=50;
  case 'sessionTabRenameButton':case 'sessionTabArchiveButton':case 'lazyFoldedBodies':case 'workSegments':case 'expandMemory':case 'foldMemory':case 'scrollMemory':case 'hoverActions':case 'mathButtons':case 'blockButtons':return typeof value==='boolean';
  case 'plainMathFormat':return value==='tex'||value==='tex-delimited';
  case 'codeCopyFormat':return value==='text'||value==='markdown';
  case 'mathFormat':return typeof value==='string'&&['markdown','tex','tex-delimited','mathml'].includes(value);
  case 'mathSvgColor':return typeof value==='string'&&(value==='theme'||/^#[0-9a-f]{6}$/i.test(value));
  case 'svgPngEdge':return typeof value==='string'&&['screen','512','1024','2048'].includes(value);
  case 'feedbackMs':return typeof value==='number'&&Number.isFinite(value)&&value>=200&&value<=6000;
  default:return false;
 }
}
export function normalizeDisplaySettings(input:unknown):DisplaySettings {
 const out={...DISPLAY_DEFAULTS};if(!input||typeof input!=='object'||Array.isArray(input))return out;
 for(const key of Object.keys(out) as (keyof DisplaySettings)[]){const v=(input as Record<string,unknown>)[key];if(valid(key,v))(out as any)[key]=(key==='mathSvgColor'||key==='railMarkColor'||key==='searchHighlightColor')&&typeof v==='string'?v.toLowerCase():v;}
 return out;
}
export class DisplaySettingsStore {
 private value:DisplaySettings;private tail:Promise<unknown>=Promise.resolve();
 private observers=new Set<(source?:string)=>void>();
 constructor(private storage:DisplayStateStorage){this.value=normalizeDisplaySettings(storage.get(DISPLAY_SETTINGS_KEY,undefined));}
 read(){return {...this.value};}
 onDidChange(listener:(source?:string)=>void){let callback:typeof listener|undefined=listener;this.observers.add(listener);return{dispose:()=>{if(callback)this.observers.delete(callback);callback=undefined;}};}
 private async write(next:DisplaySettings,source?:string){await this.storage.update(DISPLAY_SETTINGS_KEY,next);this.value=next;for(const listener of this.observers)try{listener(source);}catch{/* A display observer cannot turn a confirmed write into a storage failure. */}return this.read();}
 /** Recovery reads must observe a timed-out write's final result before editing resumes. */
 async confirmed(){await this.tail;return this.read();}
 set(key:unknown,value:unknown,active:()=>boolean=()=>true,source?:string):Promise<DisplaySettings>{
  const run=async()=>{
   if(!active())throw Error('设置面板已关闭，请重新打开');
   if(typeof key!=='string')throw Error('不支持的显示设置');
   if(key==='notifications.tasks'){if(!valid('taskNotifications',value))throw Error('任务通知设置无效');const next=normalizeDisplaySettings({...this.value,taskNotifications:value});return this.write(next,source);}
   if(key==='attachmentStore.maxTotalMB'){if(!valid('attachmentMaxTotalMB',value))throw Error('附件存储上限须为16–4096 MiB整数或-1');const next=normalizeDisplaySettings({...this.value,attachmentMaxTotalMB:value});return this.write(next,source);}
   if(key==='attach.maxFiles'||key==='attach.maxTotalMB'){const field=key==='attach.maxFiles'?'attachmentBatchMaxFiles':'attachmentBatchMaxTotalMB';if(!valid(field,value))throw Error('单次附件设置值无效');const next=normalizeDisplaySettings({...this.value,[field]:value});return this.write(next,source);}
    if(['preview.gifAutoplay','preview.maxFrames','preview.maxFrameSelections'].includes(key)){const field=key.slice(8);if(!valid(field,value))throw Error('动图预览设置值无效');const next=normalizeDisplaySettings({...this.value,[field]:value});return this.write(next,source);}
   if(key==='ui-conversation.busyEnter'){if(!valid('busyEnter',value))throw Error('运行中发送消息设置无效');const next=normalizeDisplaySettings({...this.value,busyEnter:value});return this.write(next,source);}
   if(key==='ui.sessionTabMinWidth'){if(!valid('sessionTabMinWidth',value))throw Error('会话标签最小宽度须为68–200像素整数');const next=normalizeDisplaySettings({...this.value,sessionTabMinWidth:value});return this.write(next,source);}
   if(key==='ui.sessionTabRenameButton'||key==='ui.sessionTabArchiveButton'){const field=key.slice(3);if(!valid(field,value))throw Error('会话标签按钮设置值无效');const next=normalizeDisplaySettings({...this.value,[field]:value});return this.write(next,source);}
   if(key==='search.returnPill'||key==='search.returnPillSeconds'){const field=key==='search.returnPill'?'searchReturnPill':'searchReturnPillSeconds';if(!valid(field,value))throw Error('搜索返回提示设置无效');const next=normalizeDisplaySettings({...this.value,[field]:value});return this.write(next,source);}
   if(key==='search.resultOrder'){if(!valid('searchResultOrder',value))throw Error('搜索排序方式无效');const next=normalizeDisplaySettings({...this.value,searchResultOrder:value});return this.write(next,source);}
   if(key==='search.snippetView'){if(!valid('searchSnippetView',value))throw Error('搜索长片段显示方式无效');const next=normalizeDisplaySettings({...this.value,searchSnippetView:value});return this.write(next,source);}
   if(key==='search.highlightColor'){if(!valid('searchHighlightColor',value))throw Error('搜索高亮颜色无效');const next=normalizeDisplaySettings({...this.value,searchHighlightColor:value});return this.write(next,source);}
   const foldFields:Record<string,string>={'fold.changedFiles':'changedFiles','fold.changedFilesLines':'changedFilesLines','fold.workSegments':'workSegments','fold.enabled':'userFoldEnabled','fold.previewLines':'userFoldPreviewLines','fold.triggerRatio':'userFoldTriggerRatio','fold.minFoldExtraLines':'userFoldMinExtraLines','fold.minChars':'userFoldMinChars','fold.blockMinLines':'blockMinLines'};
   const copyFields=['mathButtons','blockButtons','mathFormat','plainMathFormat','codeCopyFormat','mathSvgColor','svgPngEdge','feedbackMs'];
     const field=key==='turnRail.markNoteOnly'?'railMarkNoteOnly':key==='turnRail.markColor'?'railMarkColor':key==='turnRail.summaryLength'?'railSummaryLength':key==='turnRail.numberStyle'?'railNumberStyle':key==='turnRail.tipTwoLine'?'railTipTwoLine':key==='turnRail.minGap'?'railMinGap':key==='turnRail.dragEdgePx'?'railDragEdgePx':key==='turnRail.dragSpeed'?'railDragSpeed':key==='sessionHistory.loadAll'?'historyLoadAll':key==='sessionHistory.maxMessages'?'historyMaxMessages':key==='turnRail.nodeBadge'?'railNodeBadge':key==='turnRail.scrollbar'?'railScrollbar':key==='animationStyle'?'animationStyle':key==='sessionViewMemory.expand'?'expandMemory':key==='sessionViewMemory.fold'?'foldMemory':key==='sessionViewMemory.scroll'?'scrollMemory':key==='preview.minScale'?'previewMinScale':key==='preview.maxScale'?'previewMaxScale':key==='ui.hintSeconds'?'hintSeconds':key==='ui.contentMaxWidth'?'contentMaxWidth':key==='imageCopyFormat'?'imageCopyFormat':key==='ui.lazyFoldedBodies'?'lazyFoldedBodies':key==='ui.hoverActions'?'hoverActions':Object.hasOwn(foldFields,key)?foldFields[key]!:key==='copy.feedbackSeconds'?'feedbackMs':key.startsWith('copy.')&&copyFields.includes(key.slice(5))?key.slice(5):'';
   if(key==='copy.feedbackSeconds'&&(typeof value!=='number'||!Number.isFinite(value)||value<.2||value>6))throw Error('复制反馈时长超出范围');
   const normalized=key==='ui.hintSeconds'&&typeof value==='number'&&Number.isFinite(value)?normalizeHintSeconds(value):key==='copy.feedbackSeconds'&&typeof value==='number'?Math.round(value*1000):value;
   if(!valid(field,normalized)||key==='copy.feedbackMs')throw Error('显示设置值无效或不在本批范围内');
   const next=normalizeDisplaySettings({...this.value,[field]:normalized});
   return this.write(next,source);
  };
  const task=this.tail.then(run);this.tail=task.catch(()=>{});return task;
 }
}
export async function handleDisplaySettings(store:DisplaySettingsStore,m:any,post:(message:any)=>unknown,active:()=>boolean):Promise<boolean>{
 if(m?.type!=='settings-read'&&m?.type!=='settings-save')return false;
 if(!active()||!Number.isSafeInteger(m.id)||m.id<0)return true;
 try{const copySettings=m.type==='settings-read'?await store.confirmed():await store.set(m.key,m.value,active,typeof m.pageId==='string'?m.pageId:undefined);if(active())await post({type:'display-settings',id:m.id,ok:true,copySettings});}
 catch{if(active())await post({type:'display-settings',id:m.id,ok:false,copySettings:store.read(),error:'显示设置保存失败，已恢复保存值；请重试。'});}
 return true;
}
