import type {PageHost} from '../page-host';
import {pageContentReady,type PageState} from '../page-model';
export const HISTORY_PREFETCH_VIEWPORTS=1.5;
const UPWARD_INTENT_MS=300;

/** The original explicit “load older” interaction, with the adapter's coverage disclosure. */
export class HistoryControls {
 private root=document.createElement('div');
 private state?:PageState;
 private requested='';private lastTop=0;private lastExtent=0;private upwardUntil=0;private dragging=false;private disposed=false;
 constructor(private host:PageHost,private history:HTMLElement){
  this.root.id='history-controls';this.root.className='history-controls';this.root.hidden=true;this.root.setAttribute('aria-label','历史加载');history.before(this.root);
  host.messages.addEventListener('message',this.receive);history.addEventListener('wheel',this.wheel,{passive:true});history.addEventListener('scroll',this.scrolled,{passive:true});history.addEventListener('pointerdown',this.pointer);document.addEventListener('keydown',this.key);window.addEventListener('pointerup',this.release);window.addEventListener('pointercancel',this.release);window.addEventListener('blur',this.release);window.addEventListener('pagehide',this.dispose,{once:true});
 }
 private post(type:string,extra:object={}){if(this.state)this.host.postMessage({type,threadId:this.state.threadId,connectionId:this.state.connectionId,...extra});}
 /** One existing public page per confirmed window and upward gesture; a failed read stays manual. */
 private prefetch(){
  const s=this.state,h=s?.history;if(this.disposed||!s?.threadId||!pageContentReady(s)||s.operating||s.needsRecovery||!h||h.mode!=='paginated'||h.hasMore!==true||h.loading||h.loadingTurn||h.error||document.visibilityState==='hidden'||this.history.clientWidth<=0||this.history.clientHeight<=0||this.history.scrollTop>this.history.clientHeight*HISTORY_PREFETCH_VIEWPORTS)return;
  const request=JSON.stringify([s.threadId,s.connectionId,h.generation,h.loadedTurns]);if(this.requested===request)return;this.requested=request;this.post('history-older');
 }
 private wheel=(e:WheelEvent)=>{if(e.deltaY<0){this.upwardUntil=performance.now()+UPWARD_INTENT_MS;this.prefetch();}else this.upwardUntil=0;};
 private key=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(e.defaultPrevented||!['ArrowUp','PageUp','Home'].includes(e.key)||target!==document.body&&!this.history.contains(target)||target?.closest?.('input,textarea,select,[contenteditable=true]'))return;this.upwardUntil=performance.now()+UPWARD_INTENT_MS;this.prefetch();};
 private pointer=(e:PointerEvent)=>{if(e.button===0&&e.target===this.history)this.dragging=true;};
 private release=()=>{this.dragging=false;this.upwardUntil=0;};
 private scrolled=()=>{const top=this.history.scrollTop,extent=this.history.scrollHeight-this.history.clientHeight,up=top<this.lastTop,stable=extent===this.lastExtent;this.lastTop=top;this.lastExtent=extent;if(up&&stable&&(this.dragging||performance.now()<this.upwardUntil))this.prefetch();};
 private dispose=()=>{this.disposed=true;this.release();this.host.messages.removeEventListener('message',this.receive);this.history.removeEventListener('wheel',this.wheel);this.history.removeEventListener('scroll',this.scrolled);this.history.removeEventListener('pointerdown',this.pointer);document.removeEventListener('keydown',this.key);window.removeEventListener('pointerup',this.release);window.removeEventListener('pointercancel',this.release);window.removeEventListener('blur',this.release);window.removeEventListener('pagehide',this.dispose);};
 private receive=(event:MessageEvent)=>{
  if(event.data?.type!=='state')return;const state:PageState=event.data.state;if(state.threadId!==this.state?.threadId||state.connectionId!==this.state?.connectionId||state.history?.generation!==this.state?.history?.generation){this.requested='';this.release();}this.state=state;const h=state.history;this.lastTop=this.history.scrollTop;this.lastExtent=this.history.scrollHeight-this.history.clientHeight;
  this.root.hidden=!h||!state.threadId;if(!h)return;this.root.replaceChildren();
  const quiet=state.dispatchMode==='daily';
   if(quiet&&state.operating&&!h.error&&!state.outline?.error){this.root.hidden=true;return;}
  const status=document.createElement('span');status.className='muted';status.setAttribute('role','status');
   status.textContent=h.error||`已加载 ${h.loadedTurns} 个回合 · ${h.hasMore===null?'历史覆盖范围未确认':h.hasMore?'还有更早历史':h.complete?'公开历史已读到开头':state.turns?.some(t=>t.status==='inProgress')?'回合列表已读到开头，当前回合仍在运行':'回合列表已读到开头，部分正文尚未完整'}`;this.root.append(status);status.hidden=quiet&&!h.error&&!state.needsRecovery;
  if(state.offlinePreview&&h.complete)status.textContent=`已加载 ${h.loadedTurns} 个合成回合 · 固定资料已读到开头`;
  if(h.initialLimit&&!h.error)status.textContent+=` · 已到 ${h.initialLimit} 条补读阈值；完整分页可能超出，仍可手动继续加载`;
  if(state.needsRecovery&&!state.operating)status.textContent+=` · 会话恢复未完成，请${state.sessionCatalog?'点击当前会话标签重试恢复':'点击“恢复”重试'}；仅加载历史不会解除发送保护。`;
  const locked=!pageContentReady(state)||!!state.operating||h.loading||!!h.loadingTurn;
  if(h.hasMore!==false&&h.mode==='paginated'){
   const more=document.createElement('button');more.type='button';more.className='history-load-more';more.textContent=h.loading?'正在加载更早消息…':'加载更早消息';more.disabled=locked;more.onclick=()=>this.post('history-older');this.root.append(more);
  }
  for(const id of h.incompleteTurns){
   const turn=state.turns?.find(turn=>turn.id===id),button=document.createElement('button');button.type='button';button.className='history-load-items';button.dataset.turnId=id;
    if(quiet&&(turn?.status==='inProgress'||!h.error&&!state.needsRecovery))continue;
   button.textContent=h.loadingTurn===id?'正在加载回合正文…':quiet?`补全第 ${(state.turns?.findIndex(t=>t.id===id)??0)+1} 回合正文`:`加载回合完整内容 · ${id.slice(0,8)}`;button.disabled=locked||h.mode!=='paginated'||turn?.status==='inProgress';
   button.title=turn?.status==='inProgress'?'运行中的公开条目仍在变化':h.mode!=='paginated'?'此旧历史模式未提供可分页的完整正文':id;button.onclick=()=>this.post('history-items',{turnId:id});this.root.append(button);
  }
   if(state.outline){
    const outline=state.outline,note=document.createElement('span');note.className='muted';note.textContent=(outline.nodes.some(n=>n.cached)?'本地缓存节点尚未核实 · ':'')+(outline.error||`轨道 ${outline.nodes.length} 个已知回合 · ${outline.complete?'回合表已完整':'节点范围未完整'}`);note.title=outline.scope;note.hidden=quiet&&!outline.error;this.root.append(note);
   if(!quiet&&!outline.complete){const prepare=document.createElement('button');prepare.type='button';prepare.className='outline-prepare';prepare.textContent=outline.loading?'正在准备轨道…':outline.hasMore?'继续准备完整轨道':'准备完整轨道';prepare.disabled=locked||outline.loading||!!state.needsRecovery;prepare.onclick=()=>this.post('outline-scan');this.root.append(prepare);}
  }
  if(quiet){this.root.title=`已加载 ${h.loadedTurns} 回合；${h.complete?'正文完整':'部分正文尚未补全'}；${state.outline?.complete?'导航范围完整':'导航范围尚未完整'}`;this.root.hidden=!state.threadId||![...this.root.children].some(child=>!(child as HTMLElement).hidden);}
 };
}
