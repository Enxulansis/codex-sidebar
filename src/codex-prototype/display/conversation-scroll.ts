import type {PageHost} from '../page-host';
import {ScrollViewMemory} from './scroll-view-memory';
import type {ScrollMemo,RailViewport} from '../scroll-view-store';
import type {TurnRail} from './turn-rail';
import {pageContentReady} from '../page-model';
export const FOLLOW_NEAR_PX=80,FOLLOW_DETACH_PX=240,VIEW_RESTORE_MS=2500,VIEW_LAYOUT_WAIT_MAX_MS=60_000;
export function followAfterScroll(follow:boolean,gap:number,movement:number,extentChanged:boolean,upwardIntent:boolean){if(extentChanged)return follow;if(upwardIntent)return false;if(gap<FOLLOW_NEAR_PX&&movement>=0)return true;if(gap>=FOLLOW_DETACH_PX)return false;return follow;}
/** 165 reading anchors and additive rail geometry; public history loading stays with the navigator. */
export class ConversationScroll{
 private memory:ScrollViewMemory;private thread='';private connection=0;private enabled=true;private following=true;private ready=false;private live=false;
 private checkpoint:ScrollMemo|undefined;private renderMemo:ScrollMemo|undefined;private restore:{memo:ScrollMemo;deadline?:number|undefined;layoutWaitMs?:number;waitingForLayout?:boolean}|undefined;private unresolved:ScrollMemo|undefined;private waitingRead=false;
 private frame:number|undefined;private saveTimer?:ReturnType<typeof setTimeout>;private expiry?:ReturnType<typeof setTimeout>;private observer:ResizeObserver;
 private lastTop=0;private lastExtent=0;private programTop:number|undefined;private rendering=false;private direction=0;private intentUntil=0;
 private navigator?:Pick<TurnRail,'locate'|'cancelPending'>;private recovery:{memo:ScrollMemo;threadId:string;connectionId:number}|undefined;private navigationReady=false;
 private rail?:{capture:(owner:{threadId:string;connectionId:number})=>RailViewport|undefined;restore:(memo:RailViewport,owner:{threadId:string;connectionId:number},manual?:boolean)=>boolean;readiness?:(ready:boolean,owner:{threadId:string;connectionId:number})=>void;manual?:(owner:{threadId:string;connectionId:number})=>boolean|undefined;input?:(owner:{threadId:string;connectionId:number})=>void};private railRestore:RailViewport|undefined;private manualRail:RailViewport|undefined;private railRestoreMode:boolean|undefined;private manualRailMode:boolean|undefined;
 private pointerHeld=false;private viewportWidth=0;private viewportHeight=0;private sourcePending=false;
 private readTakeover=false;
 private observedRows=new Set<Element>();
 private bodyWindow?:{ensure:(turnId:string,itemId?:string,owner?:{threadId:string;connectionId:number})=>boolean;element:(turnId:string,itemId?:string)=>HTMLElement|undefined;releasePin:()=>void;settled:()=>boolean};
 private windowMemo:ScrollMemo|undefined;
 prepareBodyWindow(preserveAnchor=false){this.windowMemo=preserveAnchor&&this.visible()?this.capture(this.following):{scrollTop:this.history.scrollTop,atBottom:false};this.checkpoint=undefined;}
 connectBodyWindow(body:NonNullable<ConversationScroll['bodyWindow']>){this.bodyWindow=body;}
 bodyWindowLayout(change:()=>void){const memo=this.visible()?this.capture(this.following):undefined;change();if(memo)this.place(memo);}
 constructor(private history:HTMLElement,host:PageHost,private notice:(text:string)=>void){
  this.memory=new ScrollViewMemory(host,this.loaded);history.style.overflowAnchor='none';history.addEventListener('scroll',this.scrolled,{passive:true});history.addEventListener('wheel',this.wheel,{passive:true});history.addEventListener('pointerdown',this.pointer);history.addEventListener('load',this.layout,true);history.addEventListener('body-window-settled',this.layout);document.addEventListener('keydown',this.key);this.observer=new ResizeObserver(this.layout);this.observer.observe(history);window.addEventListener('pagehide',this.dispose,{once:true});for(const type of ['pointerup','pointercancel','blur'])window.addEventListener(type,this.pointerReleased);
 }
 before(state:{threadId?:string;connectionId:number;ready:boolean;contentReady?:boolean;busy?:boolean;operating?:boolean;needsRecovery?:boolean;approvals?:unknown[];history?:{loading?:boolean;loadingTurn?:string};copySettings?:{scrollMemory?:boolean}},preserve=false){
  this.rendering=true;const thread=state.threadId||'',changed=thread!==this.thread||state.connectionId!==this.connection;
  if(changed){this.pointerHeld=false;this.cancelRecovery();this.remember();this.memory.flush();this.cancelFrame();clearTimeout(this.expiry);this.restore=undefined;this.unresolved=undefined;this.railRestore=undefined;this.manualRail=undefined;this.railRestoreMode=undefined;this.manualRailMode=undefined;this.thread=thread;this.connection=state.connectionId;this.following=true;this.checkpoint=undefined;this.waitingRead=true;this.readTakeover=false;this.memory.select(thread,this.connection);}
  this.enabled=state.copySettings?.scrollMemory!==false;this.memory.configure(this.enabled);this.ready=pageContentReady(state);this.live=state.busy===true||!!state.approvals?.length;
  this.navigationReady=pageContentReady(state)&&!state.busy&&!state.operating&&!state.needsRecovery;
  this.sourcePending=!!state.operating||!!state.history?.loading||!!state.history?.loadingTurn;
  if(this.recovery&&this.live)this.startFollowing();
  this.renderMemo=!changed&&(!this.unresolved||this.recovery)&&this.visible()?this.capture(preserve?false:this.following):undefined;
  if(this.windowMemo!==undefined){this.renderMemo=this.windowMemo;this.windowMemo=undefined;}
  if(changed&&this.memory.ready){this.restore={memo:this.returnMemo()};this.railRestore=this.enabled?this.restore.memo.rail:undefined;this.railRestoreMode=this.restore.memo.railManual;this.following=this.restore.memo.atBottom;this.waitingRead=false;}
  this.history.style.visibility=this.waitingRead&&!this.memory.ready?'hidden':'';
  if(changed)this.rail?.readiness?.(false,{threadId:this.thread,connectionId:this.connection});
 }
 after(){this.rendering=false;const current=new Set(Array.from(this.history.children));for(const row of this.observedRows)if(!current.has(row)){this.observer.unobserve(row);this.observedRows.delete(row);}for(const row of current)if(!this.observedRows.has(row)){this.observer.observe(row,{box:'border-box'});this.observedRows.add(row);}this.apply();this.railReady();this.schedule();this.reportNotice();}
 /** Retain reading metadata, not the old body's ResizeObserver targets. */
 releaseBodyRows(){for(const row of this.observedRows)this.observer.unobserve(row);this.observedRows.clear();}
 private railReady(){this.rail?.readiness?.(!this.waitingRead,{threadId:this.thread,connectionId:this.connection});}
 private reportNotice(){this.notice(this.memory.notice||(this.restore?.waitingForLayout?'导航排版尚未完成，已暂停自动恢复；原阅读停点仍保留，滚动可接管。':this.recovery?'正在通过公开历史恢复阅读停点；滚动或点击“停在此处”可接管。':this.unresolved?'阅读停点尚未在当前正文中；可继续手动阅读，或核对历史定位提示。':''));}
 private visible(){return this.history.clientWidth>0&&this.history.clientHeight>0;}
 private capture(bottom=this.following):ScrollMemo{
  const h=this.history,owner={threadId:this.thread,connectionId:this.connection},memo:ScrollMemo={scrollTop:Math.max(0,h.scrollTop),atBottom:bottom&&h.scrollHeight-h.scrollTop-h.clientHeight<FOLLOW_NEAR_PX},railManual=this.rail?.manual?.(owner)??this.manualRailMode??this.memory.memo?.railManual,rail=this.rail?.capture(owner)??(railManual===false?undefined:this.manualRail??this.memory.memo?.rail);if(rail)memo.rail=structuredClone(rail);if(railManual!==undefined)memo.railManual=railManual;
  if(!memo.atBottom){const box=h.getBoundingClientRect();const row=Array.from(h.children).find(e=>((e as HTMLElement).dataset.itemId||(e as HTMLElement).dataset.workFirstItem)&&!(e as HTMLElement).hidden&&e.getClientRects().length&&e.getBoundingClientRect().height>0&&e.getBoundingClientRect().bottom>box.top) as HTMLElement|undefined;const id=row?.dataset.workFirstItem??row?.dataset.itemId;if(row&&id)memo.anchor={turnId:row.dataset.turnId||'',itemId:id,offset:box.top-row.getBoundingClientRect().top,...(row.dataset.workFirstItem?{kind:'work' as const}:{})};}return memo;
 }
 private write(top:number){this.history.scrollTop=top;this.programTop=this.history.scrollTop;this.lastTop=this.history.scrollTop;this.lastExtent=Math.max(0,this.history.scrollHeight-this.history.clientHeight);this.viewportWidth=this.history.clientWidth;this.viewportHeight=this.history.clientHeight;}
 private place(memo:ScrollMemo,allowFallback=true){
  if(!this.visible())return false;if(memo.atBottom){this.write(this.history.scrollHeight);return true;}
  if(memo.anchor){const a=memo.anchor;this.bodyWindow?.ensure(a.turnId,a.itemId,{threadId:this.thread,connectionId:this.connection});const rows=Array.from(this.history.children) as HTMLElement[],matches=(e:HTMLElement,id:string|undefined)=>id===a.itemId&&e.dataset.turnId===a.turnId;const bar=a.kind==='work'?rows.find(e=>matches(e,e.dataset.workFirstItem)):undefined,actual=bar??rows.find(e=>matches(e,e.dataset.itemId)),row=actual??this.bodyWindow?.element(a.turnId,a.itemId);if(row){const visible=row.hidden&&row.dataset.workFoldKey?rows.find(e=>e.dataset.workKey===row.dataset.workFoldKey):row;if(visible&&!visible.hidden&&visible.getClientRects().length&&visible.getBoundingClientRect().height>0&&visible.getBoundingClientRect().width>0){const offset=actual&&visible===row&&(a.kind!=='work'||bar)?a.offset:0;this.write(this.history.scrollTop+visible.getBoundingClientRect().top-this.history.getBoundingClientRect().top+offset);return true;}}if(!allowFallback)return false;}
  this.write(memo.scrollTop);return true;
 }
 private returnMemo():ScrollMemo{return this.enabled&&!this.live&&this.memory.memo?this.memory.memo:{scrollTop:0,atBottom:true};}
 private loaded=()=>{this.reportNotice();if(this.waitingRead&&this.memory.ready){this.waitingRead=false;this.history.style.visibility='';const memo=this.returnMemo();if(this.enabled&&this.manualRail){memo.rail=structuredClone(this.manualRail);if(this.manualRailMode!==undefined)memo.railManual=this.manualRailMode;this.memory.capture(memo);}this.restore={memo};this.railRestore=this.enabled?memo.rail:undefined;this.railRestoreMode=memo.railManual;this.following=memo.atBottom;this.apply();this.railReady();this.schedule();}else if(this.readTakeover&&this.memory.ready){this.readTakeover=false;this.remember();}};
 connectHistoryNavigation(navigator:Pick<TurnRail,'locate'|'cancelPending'>){this.navigator=navigator;}
 connectRailViewport(rail:NonNullable<ConversationScroll['rail']>){this.rail=rail;}
 /** A rail gesture may update its geometry while a protected body anchor is still resolving. */
 rememberRail(){const value=this.rail?.capture({threadId:this.thread,connectionId:this.connection});if(!value)return;const manual=this.rail?.manual?.({threadId:this.thread,connectionId:this.connection});this.manualRail=structuredClone(value);this.manualRailMode=manual;this.railRestore=undefined;if(!this.enabled||!this.memory.ready)return;const base=this.restore?.memo??this.recovery?.memo??this.unresolved??this.checkpoint??this.memory.memo??(this.ready&&this.visible()?this.capture():undefined);if(!base)return;for(const memo of [this.restore?.memo,this.recovery?.memo,this.unresolved,this.checkpoint,this.renderMemo])if(memo){memo.rail=structuredClone(value);if(manual!==undefined)memo.railManual=manual;}this.memory.capture({...base,rail:structuredClone(value),...(manual===undefined?{}:{railManual:manual})});clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.memory.flush(),80);}
 private railInput(){this.rail?.input?.({threadId:this.thread,connectionId:this.connection});}
 private cancelRecovery(){if(!this.recovery)return;this.recovery=undefined;this.navigator?.cancelPending();}
 private recoverMissing(memo:ScrollMemo){
  if(!this.navigator||!this.navigationReady||!memo.anchor||memo.atBottom||this.place(memo,false))return false;
  const record=this.recovery={memo:structuredClone(memo),threadId:this.thread,connectionId:this.connection};clearTimeout(this.expiry);this.restore=undefined;this.unresolved=record.memo;this.following=false;this.renderMemo=undefined;this.reportNotice();
  queueMicrotask(()=>{if(this.recovery!==record)return;const started=this.navigator!.locate({turnId:record.memo.anchor!.turnId,itemId:record.memo.anchor!.itemId,label:'阅读停点',loaded:false,status:''},{owner:record,purpose:'reading',place:()=>this.recovery===record&&this.place(record.memo,false),onLocated:()=>{if(this.recovery!==record)return;this.recovery=undefined;this.unresolved=undefined;this.restore={memo:record.memo};this.reportNotice();this.apply();this.schedule();},onCancelled:()=>{if(this.recovery!==record)return;this.recovery=undefined;this.takeover();}});if(!started&&this.recovery===record){this.recovery=undefined;this.reportNotice();}});return true;
 }
 private apply(){
  if(this.restore&&(!this.ready||!this.visible()||!this.history.childElementCount||this.sourcePending)){clearTimeout(this.expiry);this.restore.deadline=undefined;}
  if(this.rendering||!this.visible()||!this.ready||!this.history.childElementCount||this.waitingRead)return;
  if(this.railRestore&&this.rail?.restore(this.railRestore,{threadId:this.thread,connectionId:this.connection},this.railRestoreMode))this.railRestore=undefined;
  if(this.recovery){if(this.renderMemo){this.place(this.renderMemo);this.renderMemo=undefined;}return;}
  if(this.unresolved){if(this.recoverMissing(this.unresolved))return;if(!this.place(this.unresolved,false))return;this.restore={memo:this.unresolved};this.unresolved=undefined;this.reportNotice();}
  if(this.restore){
   const r=this.restore;if(r.waitingForLayout){if(this.bodyWindow?.settled()===false)return;r.waitingForLayout=false;this.reportNotice();}if(this.recoverMissing(r.memo))return;
   if(r.deadline===undefined&&!this.sourcePending){r.deadline=performance.now()+VIEW_RESTORE_MS;this.expiry=setTimeout(()=>{
    if(this.restore!==r)return;
    if(!this.ready||!this.visible()||!this.history.childElementCount){r.deadline=undefined;return;}
    // DSH165: a loading source cannot close the restoration window. Otherwise
    // every appended page captures a new, rounded anchor and accumulates error.
    if(this.sourcePending){r.deadline=undefined;return;}
    if(this.bodyWindow?.settled()===false){r.deadline=undefined;r.layoutWaitMs=(r.layoutWaitMs??0)+VIEW_RESTORE_MS;
     // Bound active layout retries without saving estimated geometry over the
     // original reading point. Hidden/loading time does not consume this budget.
     if(r.layoutWaitMs>=VIEW_LAYOUT_WAIT_MAX_MS){r.waitingForLayout=true;this.reportNotice();return;}
     this.apply();this.schedule();return;}
    const found=this.place(r.memo,false);if(!found){this.place(r.memo,true);this.unresolved=r.memo;this.reportNotice();}
    this.restore=undefined;this.renderMemo=undefined;this.remember();
   },VIEW_RESTORE_MS);}
   if(!this.place(r.memo,false))return;this.checkpoint=r.memo;this.renderMemo=undefined;
  }
  else if(this.renderMemo){this.place(this.renderMemo);this.checkpoint=this.capture(this.following);this.renderMemo=undefined;}
  else if(this.following){this.write(this.history.scrollHeight);this.checkpoint=this.capture(true);}
  else if(this.checkpoint)this.place(this.checkpoint);
  this.lastTop=this.history.scrollTop;this.lastExtent=Math.max(0,this.history.scrollHeight-this.history.clientHeight);
 }
 private schedule(){if(this.frame===undefined)this.frame=requestAnimationFrame(()=>{this.frame=undefined;this.apply();});}
 private cancelFrame(){if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined;}
 private remember(){if(!this.thread||!this.ready||!this.visible()||!this.history.childElementCount||this.waitingRead||this.restore||this.unresolved)return;this.checkpoint=this.capture(this.following);this.memory.capture(this.checkpoint);clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.memory.flush(),80);}
 private takeover(direction=0){this.bodyWindow?.releasePin();this.cancelRecovery();this.cancelFrame();clearTimeout(this.expiry);this.restore=undefined;this.unresolved=undefined;this.reportNotice();if(this.waitingRead){this.readTakeover=true;this.following=followAfterScroll(this.following,this.history.scrollHeight-this.history.scrollTop-this.history.clientHeight,0,false,direction<0);}this.waitingRead=false;this.history.style.visibility='';this.railReady();this.direction=direction;this.intentUntil=performance.now()+300;if(direction<0)this.following=false;this.programTop=undefined;this.renderMemo=undefined;this.checkpoint=undefined;this.frame=requestAnimationFrame(()=>{this.frame=undefined;this.remember();});}
 private wheel=(e:WheelEvent)=>{this.railInput();this.takeover(e.deltaY<0?-1:e.deltaY>0?1:0);};
 private pointer=(e:PointerEvent)=>{if(e.button!==0)return;this.pointerHeld=true;if(e.target===this.history||e.pointerType==='touch'||e.pointerType==='pen'){this.railInput();this.takeover();}};
 private pointerReleased=()=>{this.pointerHeld=false;};
 private key=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(e.defaultPrevented||!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)||target!==document.body&&!this.history.contains(target)||target?.closest?.('input,textarea,select,[contenteditable=true]')||e.key===' '&&target?.closest?.('button,summary,[role=button]'))return;this.railInput();this.takeover(['ArrowUp','PageUp','Home'].includes(e.key)?-1:1);};
 private scrolled=()=>{if(this.rendering||!this.visible())return;const top=this.history.scrollTop,extent=Math.max(0,this.history.scrollHeight-this.history.clientHeight),echo=this.programTop!==undefined&&Math.abs(top-this.programTop)<1;if(echo){this.programTop=undefined;return;}const moved=top-this.lastTop,changed=extent!==this.lastExtent;if(moved===0&&!changed)return;if(this.pointerHeld&&moved!==0){this.railInput();this.takeover(moved<0?-1:1);}if(changed&&(this.history.clientWidth!==this.viewportWidth||this.history.clientHeight!==this.viewportHeight)&&!this.pointerHeld&&performance.now()>=this.intentUntil){this.apply();this.schedule();return;}this.following=followAfterScroll(this.following,extent-top,moved,changed,performance.now()<this.intentUntil&&this.direction<0);if(!changed&&moved!==0&&this.restore){clearTimeout(this.expiry);this.restore=undefined;}this.lastTop=top;this.lastExtent=extent;if(!this.restore)this.remember();};
 private layout=()=>{if(!this.rendering){this.apply();if(this.visible())this.schedule();}};
 flush(){this.remember();clearTimeout(this.saveTimer);this.memory.flush();}
 /** An explicit target owns the position before its missing body is loaded. */
 beginNavigation(){this.takeover();this.following=false;}
 seek(top:number){if(!this.visible())return;this.takeover();this.cancelFrame();this.following=false;this.write(top);this.checkpoint=this.capture(false);this.remember();}
 position(){return this.visible()&&this.ready?this.capture(this.following):undefined;}
 restorePoint(memo:ScrollMemo){this.takeover();this.cancelFrame();this.following=memo.atBottom;this.restore={memo:structuredClone(memo)};this.railRestore=this.enabled?memo.rail:undefined;this.railRestoreMode=memo.railManual;this.apply();this.schedule();}
 jumpTo(target:HTMLElement){
  if(!this.visible()||!target.isConnected)return false;
  let node=target;if(node.hidden&&node.dataset.workFoldKey){const bar=Array.from(this.history.children).find(e=>(e as HTMLElement).dataset.workKey===node.dataset.workFoldKey);if(bar)node=bar as HTMLElement;}
  if(node.hidden||!node.getClientRects().length)return false;
  this.takeover();this.cancelFrame();this.following=false;this.write(this.history.scrollTop+node.getBoundingClientRect().top-this.history.getBoundingClientRect().top);this.checkpoint=this.capture(false);this.remember();return true;
 }
 keepControl(control:HTMLElement,change:()=>void){const offset=control.getBoundingClientRect().top-this.history.getBoundingClientRect().top;this.takeover();this.cancelFrame();this.following=false;change();this.write(this.history.scrollTop+control.getBoundingClientRect().top-this.history.getBoundingClientRect().top-offset);this.remember();}
 startFollowing(){this.cancelRecovery();this.cancelFrame();clearTimeout(this.expiry);this.restore=undefined;this.unresolved=undefined;this.renderMemo=undefined;this.checkpoint=undefined;this.waitingRead=false;this.history.style.visibility='';this.following=true;this.reportNotice();this.apply();this.remember();this.schedule();}
 settleWidth(){if(this.recovery){this.schedule();return;}this.cancelFrame();clearTimeout(this.expiry);this.restore=undefined;this.unresolved=undefined;this.reportNotice();this.renderMemo=undefined;this.checkpoint=undefined;this.frame=requestAnimationFrame(()=>{this.frame=undefined;this.lastTop=this.history.scrollTop;this.lastExtent=Math.max(0,this.history.scrollHeight-this.history.clientHeight);this.remember();});}
 dispose=()=>{this.cancelRecovery();this.flush();this.cancelFrame();clearTimeout(this.expiry);clearTimeout(this.saveTimer);this.observer.disconnect();this.memory.dispose();this.history.removeEventListener('scroll',this.scrolled);this.history.removeEventListener('wheel',this.wheel);this.history.removeEventListener('pointerdown',this.pointer);this.history.removeEventListener('load',this.layout,true);this.history.removeEventListener('body-window-settled',this.layout);document.removeEventListener('keydown',this.key);window.removeEventListener('pagehide',this.dispose);for(const type of ['pointerup','pointercancel','blur'])window.removeEventListener(type,this.pointerReleased);};
}
