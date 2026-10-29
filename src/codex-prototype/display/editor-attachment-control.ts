import type {PageHost} from '../page-host';
import type {PageState} from '../page-model';
import type {DraftFile} from '../draft-store-types';
import type {AttachmentInput} from './attachment-input';
import type {EditorContextView} from '../editor-context-types';

/** Original DSH automatic single slot; no filesystem paths leave this control as read requests. */
export class EditorAttachmentControl{
 private state:PageState|undefined;private owner='';private attempted='';private suppressedPath='';private sequence=0;private stopped=false;private blocked=false;private reconciling=false;
 private button=document.createElement('button');
 private pending:{id:number;owner:string;action:'set'|'import';timer:ReturnType<typeof setTimeout>;resolve:(m:any)=>void;reject:(error:Error)=>void}|undefined;
 constructor(private host:PageHost,private attachments:AttachmentInput,private ready:()=>boolean,private files:()=>DraftFile[],private setFiles:(files:DraftFile[])=>void,private importReady:()=>boolean=()=>true){
  this.button.id='includeContext';this.button.type='button';this.button.className='icon-button include-context';this.button.hidden=true;
  this.button.innerHTML='<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="m9.5 14.5 2.2 2.2 4.3-4.3"/></svg>';
  document.querySelector('#composer .left-actions')!.append(this.button);
  this.button.onclick=()=>void this.toggle();host.messages.addEventListener('message',this.receive);window.addEventListener('pagehide',()=>this.dispose(),{once:true});
 }
 private newer(view:EditorContextView|undefined){const prior=this.state?.editorContext;if(!view||!Number.isSafeInteger(view.revision)||view.revision<1)return prior;return prior&&view.revision<prior.revision?prior:view;}
 private applyView(state:PageState,view:EditorContextView|undefined){const editorContext=this.newer(view);return editorContext?{...state,editorContext}:state;}
 update(state:PageState){const owner=JSON.stringify([state.threadId,state.connectionId]);if(owner!==this.owner){this.owner=owner;this.attempted='';this.blocked=false;this.cancel('活动文件所属线程已改变');}this.state=this.applyView(state,state.editorContext);this.refresh();}
 removed(file:DraftFile){if(file.editorSource)this.suppressedPath=file.editorSource;}
 cancelPreparation(){if(this.pending?.action==='import'){const view=this.state?.editorContext;if(view?.source)this.attempted=JSON.stringify([view.source.key,view.revision]);this.cancel('已取消活动文件准备，原草稿保留');this.refresh();}}
 refresh(){
  const view=this.state?.editorContext;this.button.hidden=!view;if(!view||this.stopped)return;
  this.button.classList.toggle('active',view.enabled===true);this.button.setAttribute('aria-pressed',view.enabled===null?'mixed':String(view.enabled));
  this.button.disabled=!!this.pending||this.blocked||view.saving||view.enabled===null||!this.ready();
  this.button.title=this.blocked?'附带结果未确认；请窗口Reload后核对，未自动重试':view.source?.path===this.suppressedPath?'该活动文件已主动移除；切换其他文件后才恢复自动附带':view.reason+(view.source?' · '+view.source.path:'');
  this.button.setAttribute('aria-label','自动附带当前文件：'+this.button.title);
  if(this.reconciling||!this.ready()||!this.importReady()||this.pending||this.blocked||view.saving||view.enabled===null)return;
  if(!view.enabled){if(this.files().some(f=>f.editorSource))this.setFiles(this.files().filter(f=>!f.editorSource));return;}
  const source=view.source;if(!source||source.path===this.suppressedPath)return;
  // VS Code can publish the new document version before its dirty flag changes.
  // The later saved view may reuse that version, but is a new eligibility state.
  const eligible=JSON.stringify([source.key,view.revision]);if(this.attempted===eligible)return;
  this.suppressedPath='';this.attempted=eligible;const owner=this.owner,revision=view.revision,current=()=>!this.stopped&&this.owner===owner&&this.suppressedPath!==source.path&&this.state?.editorContext?.revision===revision&&this.state?.editorContext?.source?.key===source.key&&this.state?.editorContext?.enabled===true;
  this.reconciling=true;
  void this.attachments.importEditor(async()=>{const reply=await this.request('import',{sourceKey:source.key});return reply.file;},current).catch(error=>{if(current())this.attachments.showNotice(error instanceof Error?error.message:'自动附带失败；原草稿保留');}).finally(()=>{this.reconciling=false;this.refresh();});
 }
 private async toggle(){if(this.button.disabled||!this.state?.editorContext)return;this.attempted='';try{const result=await this.request('set',{enabled:!this.state.editorContext.enabled});if(this.state)this.state={...this.state,editorContext:result.editorContext};this.refresh();}catch(error){this.attachments.showNotice(error instanceof Error?error.message:'附带开关未确认');this.refresh();}}
 private request(action:'set'|'import',extra:object){
  if(this.pending||!this.state)throw Error('附带操作尚未完成');const id=++this.sequence,owner=this.owner,s=this.state;
  return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.pending=undefined;this.blocked=true;reject(Error('自动附带结果未确认；原草稿保留，请窗口Reload后核对'));this.refresh();},10000);this.pending={id,owner,action,timer,resolve,reject};this.refresh();this.host.postMessage({type:'editor-context',id,threadId:s.threadId,connectionId:s.connectionId,action,...extra});});
 }
 private receive=(event:MessageEvent)=>{const m=event.data,p=this.pending,s=this.state;if(m?.type==='editor-context-view'&&s&&m.threadId===s.threadId&&m.connectionId===s.connectionId){this.state=this.applyView(s,m.editorContext);this.refresh();return;}if(m?.type!=='editor-context-result'||!p||!s||p.owner!==this.owner||m.id!==p.id||m.threadId!==s.threadId||m.connectionId!==s.connectionId)return;clearTimeout(p.timer);this.pending=undefined;if(m.editorContext)this.state=this.applyView(s,m.editorContext);if(m.ok)p.resolve(m);else p.reject(Error(m.error||'活动文件附带失败，原草稿保留'));this.refresh();};
 private cancel(reason:string){if(!this.pending)return;const p=this.pending;this.pending=undefined;clearTimeout(p.timer);p.reject(Error(reason));}
 private dispose(){this.stopped=true;this.cancel('活动文件页面已关闭');this.host.messages.removeEventListener('message',this.receive);}
}
// DSH165 src/webview.ts:243, scoped to the existing composer controls.
export const EDITOR_CONTEXT_STYLE='\n#composer .include-context.active { color: var(--vscode-charts-blue, #4d6bfe); }\n#composer .draft-file-chip.attached { border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 65%, var(--vscode-widget-border)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 18%, transparent); }\n';
