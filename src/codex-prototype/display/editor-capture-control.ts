import type {PageHost} from '../page-host';
import type {PageState} from '../page-model';
import type {EditorCaptureView,EditorCaptureMode} from '../editor-capture-types';
import {showCopyMenu,closeStaleMathMenu,showFormulaToast} from './dsh-math-export';
export class EditorCaptureControl{
 private state:PageState|undefined;private view:EditorCaptureView|undefined;private owner='';private sequence=0;private dead=false;
 private pending:{id:number;owner:string;key:string;timer:ReturnType<typeof setTimeout>}|undefined;
 private button=document.createElement('button');
 constructor(private host:PageHost,composer:HTMLElement,private ready:()=>boolean,private append:(text:string)=>void,private changed:()=>void){
  this.button.id='editor-excerpt';this.button.type='button';this.button.className='icon-button';this.button.hidden=true;this.button.setAttribute('aria-label','附加编辑器选区或诊断');this.button.setAttribute('aria-haspopup','menu');
  this.button.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 12h6"/></svg>';
  composer.querySelector('.left-actions')?.append(this.button);this.button.onclick=()=>this.menu();host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',this.dispose,{once:true});
 }
 get busy(){return !!this.pending;}
 cancelPreparation(){if(!this.pending)return;this.cancel();this.refresh();showFormulaToast('已取消编辑器读取，原草稿保留');}
 update(state:PageState){const owner=JSON.stringify([state.threadId,state.connectionId]);if(owner!==this.owner){this.cancel();this.owner=owner;this.view=undefined;}this.state=state;this.apply(state.editorCapture);}
 private apply(view:EditorCaptureView|undefined){if(view&&(!this.view||view.revision>=this.view.revision))this.view=view;if(this.pending&&this.pending.key!==this.view?.source?.key)this.cancel();this.refresh();}
 refresh(){const v=this.view;this.button.hidden=!v;this.button.disabled=this.dead||!!this.pending||!v?.source||!this.ready();this.button.setAttribute('aria-busy',String(!!this.pending));this.button.title=this.pending?'正在读取选定的编辑器上下文':v?.source?'附加选区或诊断 · '+v.source.path:v?.reason??'附加编辑器选区或诊断';closeStaleMathMenu();}
 private menu(){
  const s=this.view?.source;if(!s||this.button.disabled)return;const owner=this.owner,key=s.key,valid=()=>!this.dead&&this.owner===owner&&this.view?.source?.key===key&&!this.pending&&this.ready();
  showCopyMenu(new MouseEvent('click'),valid,[{label:'附加当前选区',...(!s.selectionCharacters?{disabledReason:'请先在编辑器中选择内容'}:{}),run:async()=>this.request('selection',key)},{label:s.diagnosticScope==='selection'?'附加选区内诊断':'附加当前文件诊断',...(!s.diagnosticCount?{disabledReason:'当前范围没有诊断'}:{}),run:async()=>this.request('diagnostics',key)}],valid,()=>{if(!this.button.disabled)this.button.focus({preventScroll:true});},this.button);
 }
 private request(mode:EditorCaptureMode,key:string){
  const s=this.state;if(!s||this.pending||!this.ready()||this.view?.source?.key!==key)return;
  const id=++this.sequence,timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.cancel();this.refresh();showFormulaToast('编辑器读取超时，原草稿保留；可重新选择后再附加',true);},10000);this.pending={id,owner:this.owner,key,timer};this.refresh();this.changed();
  try{this.host.postMessage({type:'editor-capture',id,threadId:s.threadId,connectionId:s.connectionId,mode,sourceKey:key});}catch{this.cancel();this.refresh();showFormulaToast('编辑器读取未提交，原草稿保留',true);}
 }
 private message=(event:MessageEvent)=>{
  const m=event.data,s=this.state;if(!s||m?.threadId!==s.threadId||m.connectionId!==s.connectionId)return;
  if(m.type==='editor-capture-view'){this.apply(m.editorCapture);return;}
  const p=this.pending;if(m.type!=='editor-capture-result'||!p||p.owner!==this.owner||m.id!==p.id||m.sourceKey!==p.key)return;
  this.cancel();this.apply(m.editorCapture);if(this.view?.source?.key!==p.key||!this.ready())return;
  if(!m.ok){showFormulaToast(m.error||'编辑器读取失败，原草稿保留',true);return;}
  try{if(typeof m.text!=='string')throw Error('编辑器摘录回执无效');this.append(m.text);}catch(error){showFormulaToast(error instanceof Error?error.message:'无法加入草稿，原内容保留',true);}
 };
 private cancel(){const changed=!!this.pending;clearTimeout(this.pending?.timer);this.pending=undefined;if(changed)this.changed();}
 private dispose=()=>{this.dead=true;this.cancel();this.host.messages.removeEventListener('message',this.message);this.button.remove();};
}
