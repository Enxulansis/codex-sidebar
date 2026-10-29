/** Bounded body rendering and height calibration shared by the sidebar and experiments. */
import type {PageState} from '../page-model';
import {bodyWindowUnits,rowIdentity,MAX_CALIBRATION_ROWS,MAX_BODY_ROWS,MAX_BODY_UNITS,type BodyUnit} from './body-window-units';
import type {WorkSegment} from '../work-segments';
import {RAIL_RESIZE_SETTLE_MS} from './rail-resize';
import {QUIET_PROGRESS_DELAY_MS} from './progress-delay';
type Row=PageState['items'][number];
type Group=BodyUnit;
type Renderer={render:(rows:Row[])=>Promise<void>;dispose:()=>void};
type Calibration={layout:string;foldKey:(row:Row)=>string;workFold:(key:string)=>string|undefined;expandWork:(key:string)=>void;create:(root:HTMLElement,valid:()=>boolean)=>Renderer};
const EDGE_UNITS=12,INITIAL_HEIGHT=800,BATCH_UNITS=12;
function equal(a:unknown,b:unknown):boolean{if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&equal(x[k],y[k]));}
/** Action availability changes in place; it does not change a body's height. */
function sameLayoutRows(a:Row[],b:Row[]){return a.length===b.length&&a.every((row,i)=>{const next=b[i]!;return row.turnId===next.turnId&&row.complete===next.complete&&equal(row.item,next.item)&&equal(row.displayMeta,next.displayMeta);});}
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
export class BodyWindowPrototype{
 private state:PageState|undefined;private owner='';private groups:Group[]=[];private index=new Map<string,number>();private itemIndex=new Map<string,number>();private lastIndex=new Map<string,number>();private segments=new Map<string,WorkSegment>();private config:Calibration|undefined;
 private start=0;private end=0;private prefix:number[]=[0];private headInset=0;private estimate=INITIAL_HEIGHT;private width=0;private viewport=0;private dimensions='';private layout='';
 private measured=new Map<string,number>();private extents=new Map<string,number>();private valid=new Set<string>();
 private fontIds=new WeakMap<FontFace,number>();private nextFontId=0;
 private first='';private pinned='';private committing=false;private dead=false;private version=0;private changes=0;
 private top=document.createElement('div');private bottom=document.createElement('div');private observer:ResizeObserver;private observed=new Set<Element>();private sizeObserver:ResizeObserver;private styleObserver:MutationObserver;
 private generation=0;private settledGeneration=-1;private timer:ReturnType<typeof setTimeout>|undefined;private liveTimer:ReturnType<typeof setTimeout>|undefined;private worker:{host:HTMLElement;root:HTMLElement;renderer:Renderer;released?:boolean}|undefined;
 private paused=false;private running=false;private phase='idle';private error='';private batches=0;private maxRows=0;private activeRows=0;private released=0;private cancelled=0;private staleRejected=0;private priority=-1;
 private started=0;private completed=0;private firstReadable=0;private created=performance.now();private invalidations:{reason:string;at:number;generation:number}[]=[];private status=document.createElement('div');private label=document.createElement('span');private cancel=document.createElement('button');private resume=document.createElement('button');
 private layoutDiagnostic:unknown;
 private resizeUntil=0;private runs=0;private batchCosts:{rows:number;renderMs:number;measureMs:number}[]=[];
 private progressStarted:number|undefined;private progressTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(private history:HTMLElement,private refresh:(preserveAnchor:boolean)=>void,private preserve:(change:()=>void)=>void){
  for(const gap of [this.top,this.bottom]){gap.dataset.bodyWindowGap='true';gap.setAttribute('aria-hidden','true');gap.style.cssText='height:0;margin:0;padding:0;border:0;pointer-events:none;';}
  this.status.id='body-window-preparation';this.status.hidden=true;this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');this.status.style.cssText='position:absolute;bottom:4px;left:4px;right:24px;z-index:5;display:none;align-items:center;gap:6px;padding:3px 6px;background:var(--vscode-editor-background);font-size:11px;opacity:.94;';
  this.label.style.cssText='flex:1;min-width:0;overflow-wrap:anywhere;';for(const button of [this.cancel,this.resume])button.style.cssText='flex:0 0 auto;white-space:nowrap;padding:4px 8px;';
  this.cancel.type=this.resume.type='button';this.cancel.textContent='暂停准备';this.resume.textContent='继续准备';this.cancel.onclick=()=>{this.paused=true;this.stop('paused');this.showProgress();};this.resume.onclick=()=>{this.paused=false;this.error='';this.scheduleCalibration();};this.status.append(this.label,this.cancel,this.resume);history.parentElement?.append(this.status);
  this.observer=new ResizeObserver(()=>this.scheduleMeasure());this.sizeObserver=new ResizeObserver(()=>this.checkSize());this.sizeObserver.observe(history);this.styleObserver=new MutationObserver(()=>this.checkSize());for(const root of [document.documentElement,document.body])this.styleObserver.observe(root,{attributes:true,attributeFilter:['style','class']});this.styleObserver.observe(document.head,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class']});document.fonts.addEventListener('loadingdone',this.fontsChanged);document.fonts.addEventListener('loadingerror',this.fontsChanged);history.addEventListener('scroll',this.scrolled,{passive:true});history.addEventListener('load',this.scheduleMeasure,true);window.addEventListener('pagehide',this.dispose,{once:true});
  (window as any).__bodyWindowPrototype={read:(details=false)=>({...this.read(),...(details?{heightTable:this.heightTable(),owner:this.owner,width:this.width,viewport:this.viewport,invalidations:[...this.invalidations]}:{})})};
 }
 configureCalibration(config:Calibration){this.config=config;}
 update(state:PageState){
  const owner=JSON.stringify([state.connectionId,state.threadId]),previous=new Map(this.groups.map(g=>[g.id,g])),oldOrder=this.groups.map(g=>g.id),oldNext=new Map(this.groups.map((g,i)=>[g.id,this.groups[i+1]?.id]));let changed=false;
  if(owner!==this.owner){this.stop('thread');this.owner=owner;this.measured.clear();this.extents.clear();this.valid.clear();previous.clear();this.headInset=0;this.estimate=INITIAL_HEIGHT;this.first='';this.pinned='';this.paused=false;changed=true;}
  this.state=state;this.index.clear();this.itemIndex.clear();const turns=new Map(state.turns?.map(turn=>[turn.id,turn])),plan=bodyWindowUnits(state,key=>this.config?.workFold(key)!=='expanded');this.segments=plan.segments;
  this.groups=plan.units.map(unit=>({...unit,revision:0,fold:'',turn:[...new Set(unit.logical.map(r=>r.turnId))].map(id=>[turns.get(id),state.errorTurnId===id?state.error:undefined])}));
  this.lastIndex.clear();for(const[i,group]of this.groups.entries())for(const row of group.logical){this.itemIndex.set(rowIdentity(row.turnId,row.item.id),i);this.lastIndex.set(row.turnId,i);if(!this.index.has(row.turnId))this.index.set(row.turnId,i);}
  for(const group of this.groups){const old=previous.get(group.id);group.fold=this.foldSignature(group);const same=!!old&&old.fold===group.fold&&sameLayoutRows(old.logical,group.logical)&&sameLayoutRows(old.rows,group.rows)&&equal(old.turn,group.turn);group.revision=same?old.revision:(old?.revision??0)+1;if(!same){this.valid.delete(group.id);changed=true;}}
  if(oldOrder.length!==this.groups.length||this.groups.some((g,i)=>g.id!==oldOrder[i])){changed=true;for(const[gIndex,g]of this.groups.entries())if(oldNext.get(g.id)!==this.groups[gIndex+1]?.id)this.valid.delete(g.id);}
  const groupIds=new Set(this.groups.map(g=>g.id));for(const id of this.measured.keys())if(!groupIds.has(id)){this.measured.delete(id);this.extents.delete(id);this.valid.delete(id);}
  if(this.layout!==this.config?.layout){this.layout=this.config?.layout??'';this.valid.clear();changed=true;}
  this.syncViewport();const dimensions=this.sizeKey(),sameSize=dimensions===this.dimensions;if(!sameSize){if(this.dimensions)this.resizeUntil=performance.now()+RAIL_RESIZE_SETTLE_MS;this.dimensions=dimensions;this.width=this.history.clientWidth;this.valid.clear();changed=true;}
  if(changed){this.stop('source/layout');this.note('source/layout');this.error='';}
  this.buildPrefix();
  const prior=this.groups.findIndex(g=>g.id===this.first),pinned=this.itemIndex.get(this.pinned);if(this.rangeEnd(0)===this.groups.length)this.choose(0);else if(prior<0)this.choose(Math.max(0,this.groups.length-1));else{this.start=prior;this.end=this.rangeEnd(prior);if(pinned!==undefined&&(pinned<this.start||pinned>=this.end))this.choose(pinned);}
  this.first=this.groups[this.start]?.id??'';this.committing=true;this.version++;return this.groups.slice(this.start,this.end).flatMap(group=>group.rows);
 }
 private sizeKey(){const css=getComputedStyle(this.history),faces=[...document.fonts].map(face=>{if(!this.fontIds.has(face))this.fontIds.set(face,++this.nextFontId);return[this.fontIds.get(face),face.family,face.style,face.weight,face.stretch,face.unicodeRange,face.status,face.featureSettings];});return JSON.stringify([this.history.clientWidth,css.getPropertyValue('--content-max'),css.fontFamily,css.fontSize,css.lineHeight,css.letterSpacing,css.getPropertyValue('--vscode-editor-font-family'),faces,css.paddingLeft,css.paddingRight]);}
 /** Composer/viewport height changes clip rows without changing intrinsic heights. */
 private syncViewport(){this.viewport=this.history.clientHeight;if(this.worker)this.worker.host.style.height=this.history.getBoundingClientRect().height+'px';}
 private fontsChanged=()=>{this.checkSize();};
 private checkSize(){if(this.dead||!this.state)return;this.syncViewport();const key=this.sizeKey();if(key===this.dimensions)return;this.dimensions=key;this.width=this.history.clientWidth;this.resizeUntil=performance.now()+RAIL_RESIZE_SETTLE_MS;this.valid.clear();this.stop('resize');this.note('resize');this.scheduleCalibration();}
 private note(reason:string){this.invalidations.push({reason,at:performance.now(),generation:this.generation});if(this.invalidations.length>64)this.invalidations.shift();}
 private buildPrefix(){this.prefix=[this.headInset];for(const group of this.groups)this.prefix.push(this.prefix.at(-1)!+(this.measured.get(group.id)??this.estimate));}
 private foldSignature(group:Group){return JSON.stringify(group.logical.map(row=>[this.config?.foldKey(row),this.config?.workFold(this.segments.get(rowIdentity(row.turnId,row.item.id))?.key??'')]));}
 private rangeEnd(start:number){let rows=0,end=start;while(end<this.groups.length&&end-start<MAX_BODY_UNITS&&rows+this.groups[end]!.rows.length<=MAX_BODY_ROWS){rows+=this.groups[end]!.rows.length;end++;}return end;}
 private choose(index:number){let from=index,to=Math.min(this.groups.length,index+1),rows=this.groups[index]?.rows.length??0;while(from>0&&index-from<MAX_BODY_UNITS/2&&rows+this.groups[from-1]!.rows.length<=MAX_BODY_ROWS/2){from--;rows+=this.groups[from]!.rows.length;}while(to<this.groups.length&&to-from<MAX_BODY_UNITS&&rows+this.groups[to]!.rows.length<=MAX_BODY_ROWS){rows+=this.groups[to]!.rows.length;to++;}while(from>0&&to-from<MAX_BODY_UNITS&&rows+this.groups[from-1]!.rows.length<=MAX_BODY_ROWS){from--;rows+=this.groups[from]!.rows.length;}this.start=from;this.end=to;this.first=this.groups[from]?.id??'';}
 ensure(turnId:string,itemId?:string,owner?:{threadId:string;connectionId:number}){
  const state=this.state;if(!state||owner&&(owner.threadId!==state.threadId||owner.connectionId!==state.connectionId))return false;const index=itemId?this.itemIndex.get(rowIdentity(turnId,itemId)):this.index.get(turnId);if(index===undefined)return false;
  const row=itemId?this.groups[index]!.logical.find(r=>r.turnId===turnId&&r.item.id===itemId):this.groups[index]!.logical.find(r=>r.turnId===turnId);if(!row)return false;this.pinned=rowIdentity(row.turnId,row.item.id);this.priority=index;if(index>=this.start&&index<this.end)return true;this.choose(index);this.changes++;this.refresh(false);return true;
 }
 offset(turnId:string){const index=this.index.get(turnId);return index===undefined?undefined:this.prefix[index];}
 releasePin(){this.pinned='';}
 endingTurns(rows:Row[]){const present=new Set(rows.map(row=>this.itemIndex.get(rowIdentity(row.turnId,row.item.id))));return new Set([...this.lastIndex].filter(([,index])=>present.has(index)).map(([turn])=>turn));}
 element(turnId:string,itemId?:string){const key=itemId?rowIdentity(turnId,itemId):undefined,segment=key?this.segments.get(key):undefined;if(segment&&this.config?.workFold(segment.key)!=='expanded')return Array.from(this.history.children).find(e=>(e as HTMLElement).dataset.workKey===segment.key) as HTMLElement|undefined;return undefined;}
 reveal(turnId:string,itemId?:string){if(!itemId)return;const key=rowIdentity(turnId,itemId),segment=this.segments.get(key);if(segment&&this.config?.workFold(segment.key)!=='expanded'){this.pinned=key;this.config?.expandWork(segment.key);this.refresh(false);}}
 private heightTable(){return this.groups.map((g,index)=>({unitId:g.id,turnId:g.logical[0]!.turnId,itemIds:g.logical.map(r=>r.item.id),renderedIds:g.rows.map(r=>r.item.id),index,revision:g.revision,source:this.valid.has(g.id)?'measured':'estimated',height:this.measured.get(g.id)??this.estimate,measuredHeight:this.valid.has(g.id)?this.measured.get(g.id):null,contentY:this.prefix[index],inWindow:index>=this.start&&index<this.end}));}
 commit(){
  if(this.status.parentElement!==this.history.parentElement)this.history.parentElement?.append(this.status);this.top.remove();this.bottom.remove();if(this.start||this.end<this.groups.length){if(this.start)this.history.prepend(this.top);if(this.end<this.groups.length)this.history.append(this.bottom);this.writeGaps();}this.committing=false;if(!this.firstReadable&&this.history.querySelector('[data-item-id]'))this.firstReadable=performance.now()-this.created;
  const current=new Set(Array.from(this.history.children).filter(row=>(row as HTMLElement).dataset.turnId));for(const row of this.observed)if(!current.has(row)){this.observer.unobserve(row);this.observed.delete(row);}for(const row of current)if(!this.observed.has(row)){this.observer.observe(row);this.observed.add(row);}this.checkSize();this.scheduleCalibration();this.showProgress();
 }
 /** Prefix values are visible origins, not CSS margin boxes. Preserve the
  * original tool/bar margins while absorbing only the virtual boundary. */
 private writeGaps(){
  if(this.top.isConnected){const first=this.origins(this.history).get(this.groups[this.start]?.id??''),leading=first?first.getBoundingClientRect().top-this.top.getBoundingClientRect().bottom:0,top=Math.max(0,(this.prefix[this.start]??0)-leading);if(this.top.style.height!==top+'px')this.top.style.height=top+'px';}
  if(this.bottom.isConnected){const at=this.history.scrollTop+this.bottom.getBoundingClientRect().top-this.history.getBoundingClientRect().top,bottom=Math.max(0,(this.prefix.at(-1)??0)-at);if(this.bottom.style.height!==bottom+'px')this.bottom.style.height=bottom+'px';}
 }
 private unitOf(row:HTMLElement){const item=row.dataset.itemId??row.dataset.workFirstItem;return item?this.itemIndex.get(rowIdentity(row.dataset.turnId??'',item)):row.dataset.turnError?this.lastIndex.get(row.dataset.turnError):undefined;}
 private origins(root:HTMLElement){const map=new Map<string,HTMLElement>();for(const child of Array.from(root.children) as HTMLElement[]){const index=this.unitOf(child),group=index===undefined?undefined:this.groups[index];if(group&&!child.hidden&&!map.has(group.id))map.set(group.id,child);}return map;}
 private heights(root:HTMLElement,from:number,to:number){const origins=this.origins(root),rows=Array.from(root.children) as HTMLElement[],values=new Map<string,number>(),fence=document.createElement('div');fence.style.cssText='height:0;margin:0;padding:0;border:0;';root.append(fence);try{for(let i=from;i<to;i++){const group=this.groups[i]!,first=origins.get(group.id),next=this.groups[i+1],nextRow=next&&origins.get(next.id);if(!first)continue;const last=rows.filter(row=>this.unitOf(row)===i&&!row.hidden).at(-1);if(!last||next&&!nextRow)continue;const height=(nextRow??fence).getBoundingClientRect().top-first.getBoundingClientRect().top;if(Number.isFinite(height)&&height>0)values.set(group.id,height);}return values;}finally{fence.remove();}}
 /** The final live unit has no lookahead DOM. Compare its own border span,
  * then calibrate the true inter-unit height with the normal bounded overlap. */
 private spans(root:HTMLElement,from:number,to:number){const first=new Map<number,HTMLElement>(),last=new Map<number,HTMLElement>();for(const row of Array.from(root.children) as HTMLElement[]){const index=this.unitOf(row);if(index===undefined||index<from||index>=to||row.hidden)continue;if(!first.has(index))first.set(index,row);last.set(index,row);}const result=new Map<string,number>();for(const[index,row]of first)result.set(this.groups[index]!.id,last.get(index)!.getBoundingClientRect().bottom-row.getBoundingClientRect().top);return result;}
 private scheduleMeasure=()=>{if(this.dead)return;this.checkSize();clearTimeout(this.liveTimer);this.liveTimer=setTimeout(()=>{if(this.dead||this.committing)return;const values=this.spans(this.history,this.start,this.end);let changed=false;for(const[id,span]of values)if(this.valid.has(id)&&Math.abs(span-(this.extents.get(id)??0))>.75){this.valid.delete(id);const group=this.groups.find(g=>g.id===id)!;const fold=this.foldSignature(group);if(group.fold!==fold){group.fold=fold;group.revision++;}changed=true;}if(changed){this.stop('visible-growth');this.note('visible-content/fold/async-growth');this.scheduleCalibration();}},100);};
 private scheduleCalibration(){if(this.dead||this.paused||this.running||this.timer!==undefined||!this.config||this.committing)return;if(this.valid.size===this.groups.length&&this.settledGeneration===this.generation){this.phase='ready';this.showProgress();return;}const delay=Math.max(0,this.resizeUntil-performance.now());this.phase=delay?'resizing':'preparing';this.showProgress();this.timer=setTimeout(()=>{this.timer=undefined;void this.calibrate();},delay);}
 private makeWorker(valid:()=>boolean):{host:HTMLElement;root:HTMLElement;renderer:Renderer;released?:boolean}{
  const box=this.history.getBoundingClientRect(),host=document.createElement('div');host.dataset.bodyCalibration='true';host.inert=true;host.setAttribute('aria-hidden','true');host.style.cssText=`position:fixed;left:-100000px;top:0;width:${box.width}px;height:${box.height}px;visibility:hidden;pointer-events:none;contain:layout style;`;
  const shadow=host.attachShadow({mode:'open'});for(const style of document.querySelectorAll('style')){const copy=document.createElement('style');copy.nonce=style.nonce;copy.textContent=style.textContent;shadow.append(copy);}
  const body=document.createElement('body');body.className=document.body.className;Object.assign(body.dataset,document.body.dataset);body.style.cssText='display:block;position:relative;box-sizing:border-box;margin:0;padding:0;width:100%;height:100%;overflow:hidden;';shadow.append(body);
  const slot=document.createElement('div');slot.id='history-slot';slot.className=this.history.parentElement?.className??'';slot.style.cssText='display:block;position:relative;width:100%;height:100%;min-height:0;';body.append(slot);
  const root=document.createElement('main');root.id='history';root.className=this.history.className;root.style.cssText='box-sizing:border-box;flex:none;width:100%;height:100%;margin:0;min-height:0;';slot.append(root);document.body.append(host);
  try{const renderer=this.config!.create(root,valid);return{host,root,renderer};}
  catch(error){host.remove();shadow.replaceChildren();throw error;}
 }
 private releaseWorker(worker=this.worker){if(!worker||worker.released)return;worker.released=true;worker.renderer.dispose();worker.host.remove();worker.host.shadowRoot?.replaceChildren();if(this.worker===worker){this.worker=undefined;this.activeRows=0;}this.released++;}
 releaseBodyRows(){for(const row of this.observed)this.observer.unobserve(row);this.observed.clear();}
 private stop(reason:string){this.generation++;this.priority=-1;clearTimeout(this.timer);this.timer=undefined;if(reason==='thread'||reason==='destroy')this.progressStarted=undefined;if(this.running)this.cancelled++;this.running=false;this.releaseWorker();this.phase=reason;}
 private async calibrate(){
  if(this.dead||this.paused||!this.config||!this.groups.length){this.showProgress();return;}const generation=++this.generation,owner=this.owner,valid=()=>!this.dead&&!this.paused&&this.generation===generation&&this.owner===owner;
  this.running=true;this.runs++;this.phase='preparing';this.started=performance.now();this.completed=0;let worker:ReturnType<BodyWindowPrototype['makeWorker']>|undefined;
  try{
   worker=this.worker=this.makeWorker(valid);if(document.fonts.status==='loading')await document.fonts.ready;if(!valid())return;
   while(valid()&&this.valid.size<this.groups.length){
    const from=this.priority>=0&&this.priority<this.groups.length&&!this.valid.has(this.groups[this.priority]!.id)?this.priority:this.groups.findIndex(g=>!this.valid.has(g.id));this.priority=-1;if(from<0)break;
    let to=Math.min(this.groups.length,from+BATCH_UNITS),rows=this.groups.slice(from,Math.min(this.groups.length,to+1)).flatMap(g=>g.rows);
    while(rows.length>MAX_CALIBRATION_ROWS&&to>from+1){to--;rows=this.groups.slice(from,Math.min(this.groups.length,to+1)).flatMap(g=>g.rows);}
    if(rows.length>MAX_CALIBRATION_ROWS)throw Error('显示单元及测量边界超过 128 项');
    const renderStarted=performance.now();await worker.renderer.render(rows);if(!valid()||worker.released){this.staleRejected++;return;}const renderMs=performance.now()-renderStarted;this.activeRows=rows.length;this.maxRows=Math.max(this.maxRows,rows.length);await frame();if(!valid()){this.staleRejected++;return;}
    for(let attempt=0;attempt<120;attempt++){if(!valid()){this.staleRejected++;return;}if(!worker.root.querySelector('[data-markdown-pending]'))break;if(attempt===119)throw Error('正文异步排版未完成');await frame();}
    // Reading FontFaceSet.ready forces layout even when all fonts are loaded.
    // Pending font loads are still awaited; loadingdone invalidates the generation.
    if(document.fonts.status==='loading')await document.fonts.ready;if(!valid()){this.staleRejected++;return;}
    if(worker.root.clientWidth!==this.width||worker.root.clientHeight!==this.viewport)throw Error('测量区与正文视口不匹配');
    const sample=(root:HTMLElement,id:string)=>{const row=root.querySelector<HTMLElement>('[data-item-id="'+CSS.escape(id)+'"]');if(!row)return null;return[row,...row.querySelectorAll<HTMLElement>('.message-body,.message-head,p,.katex,.katex-html,.code-wrap,.message-actions')].map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{tag:e.tagName,cls:e.className,width:r.width,height:r.height,font:s.font,line:s.lineHeight,margin:s.margin,padding:s.padding};});};for(const row of rows)if(this.history.querySelector('[data-item-id="'+CSS.escape(row.item.id)+'"] .katex')){this.layoutDiagnostic={id:row.item.id,measured:sample(worker.root,row.item.id),actual:sample(this.history,row.item.id)};break;}
    const measureStarted=performance.now(),values=this.heights(worker.root,from,to),spans=this.spans(worker.root,from,to);if(values.size!==to-from||spans.size!==to-from)throw Error('批次未得到完整可见显示单元边界');
    const first=from===0?this.origins(worker.root).get(this.groups[0]!.id):undefined,head=first?worker.root.scrollTop+first.getBoundingClientRect().top-worker.root.getBoundingClientRect().top:undefined;
    this.preserve(()=>{if(head!==undefined)this.headInset=head;for(const[id,height]of values){this.measured.set(id,height);this.extents.set(id,spans.get(id)!);this.valid.add(id);}this.estimate=[...values.values()].reduce((a,b)=>a+b,0)/values.size;this.buildPrefix();this.writeGaps();});this.batchCosts.push({rows:rows.length,renderMs,measureMs:performance.now()-measureStarted});if(this.batchCosts.length>64)this.batchCosts.shift();this.batches++;this.showProgress();
    if(!valid()||worker.released){this.staleRejected++;return;}
    await worker.renderer.render([]);this.activeRows=0;await frame();
   }
   if(valid()){this.phase='ready';this.completed=performance.now();}
  }catch(error){if(valid()){this.error=error instanceof Error?error.message:String(error);this.phase='failed';}}
  finally{this.releaseWorker(worker);if(this.generation===generation){if(!this.error&&this.valid.size===this.groups.length){this.history.dispatchEvent(new Event('body-window-geometry-ready'));await frame();for(let attempt=0;valid()&&attempt<120;attempt++){
   // One document query commits pending animation styles once. Calling
   // Element.getAnimations for every rail node stalled native narrow layouts.
   const moving=document.getAnimations().some(a=>{const target=(a.effect as KeyframeEffect|null)?.target;return a instanceof CSSTransition&&a.transitionProperty==='top'&&a.playState!=='finished'&&target instanceof Element&&target.matches('#turnRail .turn-rail-node');});
   if(!moving){this.settledGeneration=generation;break;}await frame();}if(valid()&&this.settledGeneration!==generation)this.error='轨道位置过渡尚未完成';}if(this.generation===generation){this.running=false;this.showProgress();if(valid()&&this.settled())this.history.dispatchEvent(new Event('body-window-settled'));}}}
 }
 private showProgress(){
  clearTimeout(this.progressTimer);this.progressTimer=undefined;
  if(this.state?.dispatchMode==='daily'&&!this.paused&&!this.error){
   this.progressStarted=undefined;this.status.hidden=true;this.status.style.display='none';return;
  }
  const count=this.valid.size,total=this.groups.length,ready=count===total&&!this.running&&this.settledGeneration===this.generation;
  if(ready||!total)this.progressStarted=undefined;else this.progressStarted??=performance.now();
  const delay=!this.paused&&!this.error&&this.progressStarted!==undefined?this.progressStarted+QUIET_PROGRESS_DELAY_MS-performance.now():0;
  if(!ready&&total&&delay>0)this.progressTimer=setTimeout(()=>this.showProgress(),delay);
  this.status.hidden=!total||ready||delay>0;this.status.style.display=this.status.hidden?'none':'flex';
  this.status.title=`已准备 ${count}/${total} 个显示单元；正文可阅读、节点可点击`+(this.state?.history?.hasMore?'；更早历史尚未全部读取':'');
  this.label.textContent=this.error?'导航准备未完成：'+this.error:this.paused?'导航准备已暂停':'正在准备导航…';
  this.cancel.hidden=this.paused||!!this.error;this.resume.hidden=!this.paused&&!this.error;
 }
 private scrolled=()=>{
  if(this.dead||this.committing||this.pinned||!this.start&&this.end===this.groups.length||!this.history.clientHeight)return;const at=this.history.scrollTop+this.history.clientHeight/2;let low=0,high=this.groups.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if((this.prefix[mid]??0)<=at)low=mid;else high=mid-1;}const index=low,edge=Math.max(1,Math.min(EDGE_UNITS,Math.floor((this.end-this.start)/4)));
  if(index<this.start+edge&&this.start>0||index>=this.end-edge&&this.end<this.groups.length){this.choose(index);this.changes++;this.refresh(true);}
 };
 settled(){return this.valid.size===this.groups.length&&!this.running&&!this.error&&this.settledGeneration===this.generation;}
 read(){const measuredTurns=new Set(this.index.keys());for(const group of this.groups)if(!this.valid.has(group.id))for(const row of group.logical)measuredTurns.delete(row.turnId);return{kind:'isolated-body-window-prototype',ready:!this.committing,geometryReady:this.settled(),version:this.version,windowChanges:this.changes,totalItems:this.state?.items.length??0,totalTurns:this.index.size,totalUnits:this.groups.length,start:this.start,end:this.end,renderedItems:this.groups.slice(this.start,this.end).reduce((sum,g)=>sum+g.rows.length,0),turnIds:[...new Set(this.groups.slice(this.start,this.end).flatMap(g=>g.logical.map(r=>r.turnId)))],measuredTurns:measuredTurns.size,estimatedTurns:this.index.size-measuredTurns.size,estimatedTotalHeight:this.prefix.at(-1)??0,estimate:this.estimate,layoutDiagnostic:this.layoutDiagnostic,calibration:{runs:this.runs,batchCosts:[...this.batchCosts],generation:this.generation,phase:this.phase,valid:this.valid.size,total:this.groups.length,batches:this.batches,activeRows:this.activeRows,maxRows:this.maxRows,workerConnected:!!this.worker?.host.isConnected,released:this.released,cancelled:this.cancelled,staleRejected:this.staleRejected,paused:this.paused,error:this.error,started:this.started,completed:this.completed,durationMs:this.completed?this.completed-this.started:null,firstReadableMs:this.firstReadable}};}
 private dispose=()=>{this.dead=true;this.stop('destroy');clearTimeout(this.liveTimer);clearTimeout(this.progressTimer);this.observer.disconnect();this.sizeObserver.disconnect();this.styleObserver.disconnect();document.fonts.removeEventListener('loadingdone',this.fontsChanged);document.fonts.removeEventListener('loadingerror',this.fontsChanged);this.observed.clear();this.history.removeEventListener('scroll',this.scrolled);this.history.removeEventListener('load',this.scheduleMeasure,true);window.removeEventListener('pagehide',this.dispose);this.status.remove();this.config=undefined;this.state=undefined;this.groups=[];this.index.clear();this.itemIndex.clear();this.lastIndex.clear();this.segments.clear();this.measured.clear();this.extents.clear();this.valid.clear();delete (window as any).__bodyWindowPrototype;};
}
