import type {DisplaySettings} from './display-settings';
import type {DisplayImage} from './display/image-preview';
import type {SearchHit} from './search-query';
import type {AttachmentStorageStatus} from './attachment-policy';
import type {DisplayFile} from './message-file-types';
import type {ModelSelectionView} from './model-selection';
import type {EditorContextView} from './editor-context-types';
import type {EditorCaptureView} from './editor-capture-types';
import type {NativeTurnView} from './native-turn-progress';
import type {CompactionView} from './manual-compaction';
import type {SkillsView} from './skills';
import type {PublicToolDisplayItem} from './public-tool-types';
import type {PublicRecordDisplayItem} from './public-record-types';
import type {PublicQuestionRecord} from './public-questions';
import type {PermissionSelectionView} from './permission-selection';
import type {ModeSelectionView} from './collaboration-mode';
import type {NativeUserInput} from './native-user-input';
import type {AccountLimitsView} from './account-limits';

/** Display values only. These types do not import a harness protocol or VS Code. */
export type MessagePhase = 'commentary' | 'partial_answer' | 'final_answer';
export type PageLocalImage = {type:'localImage';path:string;displayImage?:DisplayImage};
export type PageInput = {type:'text';text:string} | PageLocalImage | {type:'image'}
  | {type:'audio'|'localAudio'|'skill'|'mention'};
/** A missing renderer must remain visible without inventing playback or execution results. */
export function inputUnavailableText(type:PageInput['type']):string{
 switch(type){
  case 'audio':case 'localAudio':return '音频输入记录：本候选尚未接入播放，未据此推断识别结果';
  case 'skill':return '技能引用记录：本候选尚未接入详情，执行结果请核对公开回复';
  case 'mention':return '提及引用记录：本候选尚未接入详情，未读取或展开引用资源';
  default:return '';
 }
}
export type CommandDisplayItem = {type:'commandExecution';id:string;command:string;cwd:string;status:string;aggregatedOutput:string|null;exitCode:number|null;durationMs:number|null};
export type FileDisplayItem = {type:'fileChange';id:string;status:string;changes:{path:string;diff:string;kind:{type:'add'}|{type:'delete'}|{type:'update';move_path:string|null}}[]};
export type KnownPageItem = {type:'agentMessage';id:string;text:string;phase?:MessagePhase|null;questionRecord?:PublicQuestionRecord}
  | {type:'userMessage';id:string;clientId?:string;content:PageInput[];files?:DisplayFile[]}
  | {type:'plan';id:string;text:string} | CommandDisplayItem | FileDisplayItem | PublicToolDisplayItem | PublicRecordDisplayItem;
/** Unadapted page inputs can identify a record, but their payload must never be rendered. */
export type RawPageItem = {type:string;id:string;[field:string]:unknown};
export type PageItem = KnownPageItem | RawPageItem;
export function isPageItem<T extends KnownPageItem['type']>(item:PageItem,type:T):item is Extract<KnownPageItem,{type:T}> {return item.type===type;}
export type UsageCounters = {totalTokens:number;inputTokens:number;cachedInputTokens:number;cacheWriteInputTokens:number;outputTokens:number;reasoningOutputTokens:number};
export type PageTokenUsage = {total:UsageCounters;last:UsageCounters;modelContextWindow:number|null};
export type TailMeta = {source:'public'|'synthetic';timeMs?:number;timeSource?:'server-turn'|'client-received'|'synthetic';durationMs?:number;durationSource?:'server-turn'|'client-received'|'synthetic';firstVisibleMs?:number;averageOutputTokS?:number;tokenUsage?:PageTokenUsage;incomplete?:boolean;usageOrderUnknown?:boolean;usageFromEarlierRow?:boolean};
export type WorkTurn = {id:string;status:'completed'|'interrupted'|'failed'|'inProgress';itemsView:'notLoaded'|'summary'|'full';durationMs:number|null};
export type PageRow = {turnId:string;item:PageItem;complete:boolean;displayMeta?:TailMeta|undefined;forkReason?:string|undefined;revertReason?:string|undefined};
export type PageApproval = {id:string|number;callbackToken:string;params:{itemId?:string;[key:string]:unknown};acceptance?:{allowed:boolean;reason:string}};
export type PageSession={id:string;title:string;updatedAt:number;archived:boolean;deleted?:boolean;localOnly?:boolean;unread?:boolean;unreadSource?:'task';observed:boolean;pending?:{kind:string;name?:string}};
export type PageState = {
  accountLimits?:AccountLimitsView|undefined;
  threadId:string;connectionId:number;status:string;error?:string;errorTurnId?:string;
  ready:boolean;contentReady?:boolean;busy:boolean;operating?:boolean;connecting?:boolean;needsRecovery?:boolean;model:string;auth?:string;
  threads:string[];used:number|null;limit:number|null;oldUsed:number|null;
  dispatchMode?:'daily'|'experiment'|'connection-only';
  localImagesAvailable?:boolean;attachmentImportAvailable?:boolean;
  threadManagementAvailable?:boolean;
  serviceStatusAvailable?:boolean;
  serviceStatusRevision?:number;
  appCatalogRevision?:number;
  dictationAvailable?:boolean;
  offlineExperienceAvailable?:boolean;offlinePreview?:boolean;searchToolsAvailable?:boolean;formulaExportUnavailableReason?:string;
  batchId?:string;independentBatch?:boolean;dispatchBlockReason?:string;
  localQueue?:{items:{id:string;text:string;preview:string;attachments:number;skillName?:string;status:'queued'|'sending'|'unknown'}[];paused:boolean;blocked:boolean;reason:string;steerTurnId:string};
  sessionCatalog?:{sessions:PageSession[];recycle:PageSession[];sort:'persisted'|'activity';loading:boolean;error:string;hasMore:boolean;recycleHasMore:boolean;scope:string};
  history?:{generation:number;mode:'legacy'|'paginated'|'unknown';loading:boolean;loadingTurn:string;error:string;hasMore:boolean|null;loadedTurns:number;initialLimit?:number;incompleteTurns:string[];complete:boolean;scope:string};
  outline?:{nodes:{turnId:string;itemId?:string|undefined;label:string;loaded:boolean;status:string;cached?:true}[];loading:boolean;error:string;complete:boolean;hasMore:boolean|null;scope:string};
  search?:{requestId:number;query:string;scope:'thread'|'workspace';includeTools:boolean;hits:SearchHit[];loading:boolean;done:boolean;hasMore:boolean;complete:boolean;limited:boolean;stale:boolean;error:string;cacheNotice?:string;failures:{threadId:string;reason:string}[];scannedThreads:number;totalThreads:number;scannedTurns:number;source:string};
  toolCheck?:{verified:boolean;threadId?:string;reason?:string};
  attachmentStorage?:AttachmentStorageStatus;
  modelSelection?:ModelSelectionView;
  modeSelection?:ModeSelectionView;
  userInputs?:NativeUserInput[];
  permissionSelection?:PermissionSelectionView;
  editorContext?:EditorContextView;
  editorCapture?:EditorCaptureView;
  turnProgress?:NativeTurnView;
  compaction?:CompactionView;
  skills?:SkillsView;
  fileSourceNotice?:string;
  fileReferencesEnabled?:boolean;
  copySettings?:Partial<DisplaySettings>;speechAvailable?:boolean;replyActionsEnabled?:boolean;replyForkMode?:string;
  items:PageRow[];turns?:(WorkTurn&{errorMessage?:string})[];approvals:PageApproval[];
};
/** Browsing locally supplied content confers no connection, send, tool or approval authority. */
export function pageContentReady(state?:Pick<PageState,'ready'|'contentReady'>){return state?.contentReady??state?.ready??false;}
