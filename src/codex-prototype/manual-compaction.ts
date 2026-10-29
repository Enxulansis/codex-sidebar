import type {Notification} from './rpc';
import type {Turn} from './protocol/v2/Turn';

export type CompactionPhase='preparing'|'requesting'|'accepted'|'running'|'canceling'|'completed'|'interrupted'|'failed'|'rejected'|'canceled'|'unknown';
export type CompactionView={phase?:CompactionPhase;turnId?:string;reason:string;blockedReason?:string;canStart:boolean;active:boolean};
const ACTIVE=new Set<CompactionPhase>(['preparing','requesting','accepted','running','canceling']);
const LABELS:Record<CompactionPhase,string>={preparing:'正在核对压缩条件',requesting:'正在提交压缩请求',accepted:'压缩请求已受理，等待公开压缩过程',running:'正在压缩上下文',canceling:'正在停止压缩',completed:'上下文压缩已完成',interrupted:'压缩已中断',failed:'压缩失败；请核对提示',rejected:'压缩请求被拒绝，未自动重试',canceled:'已取消压缩准备，草稿保留',unknown:'压缩结果未确认，请恢复核对；未自动重试'};

/** A maintenance request owns no ordinary turn until a new public contextCompaction item identifies it. */
export class ManualCompaction{
 phase:CompactionPhase='preparing';attempt:string|undefined;turnId:string|undefined;
 private baseline=new Set<string>();private candidate:string|undefined;private itemId:string|undefined;private itemDone=false;
 private terminal:Exclude<Turn['status'],'inProgress'>|undefined;private requested=false;private detached=false;private detail='';private interruptSent=false;
 cancelRequested=false;
 constructor(readonly threadId:string){}
 get active(){return ACTIVE.has(this.phase);}
 get label(){return this.detail||LABELS[this.phase];}
 get submitted(){return this.requested;}
 view(reason:string):CompactionView{return{phase:this.phase,...(this.turnId?{turnId:this.turnId}:{}),reason:this.label,...(reason?{blockedReason:reason}:{}),canStart:!reason,active:this.active};}
 submit(attempt:string,knownTurns:Iterable<string>){if(this.phase!=='preparing')throw Error('压缩准备已失效');this.baseline=new Set(knownTurns);this.attempt=attempt;this.requested=true;this.phase='requesting';}
 accept(){if(this.phase==='requesting')this.phase='accepted';}
 reject(message:string,definite:boolean){if(!this.active)return;if(definite&&!this.candidate){this.phase='rejected';this.detail='压缩请求被拒绝：'+message;}else this.uncertain('压缩结果未确认：'+message+'；请恢复核对，未自动重试');}
 uncertain(reason:string){if(!this.active)return;this.phase='unknown';this.detail=reason;}
 abandon(reason:string){this.uncertain(reason);this.detached=true;}
 stop():string|undefined{
  if(!this.active&&this.phase!=='unknown')return;
  this.cancelRequested=true;
  if(!this.requested){this.phase='canceled';return;}
  if(!this.turnId){this.uncertain('压缩已请求停止，但尚无可核对的压缩回合；请恢复核对，未中断其他回合');return;}
  if(this.terminal){this.uncertain('压缩回合已结束，但条目完成回执缺失；请恢复核对');return;}
  if(this.active)this.phase='canceling';return this.takeInterrupt();
 }
 takeInterrupt(){if(!this.cancelRequested||!this.turnId||this.terminal||this.interruptSent||this.detached)return;this.interruptSent=true;return this.turnId;}
 /** Account for new public events without treating an arbitrary new turn as owned. */
 watches(turnId:string){return this.requested&&!this.detached&&!this.baseline.has(turnId)&&(this.active||this.phase==='unknown');}
 owns(turnId:string){return this.turnId===turnId;}
 observe(n:Notification){
  if(!this.requested||this.detached||!this.active&&this.phase!=='unknown'||!('threadId'in n.params)||n.params.threadId!==this.threadId)return;
  let id:string,compactionId:string|undefined,done=false,terminal:Turn['status']|undefined;
  if(n.method==='turn/started'||n.method==='turn/completed'){
   id=n.params.turn.id;
   if(this.baseline.has(id))return;
   const items=n.params.turn.items.filter(item=>item.type==='contextCompaction');
   if(items.length===1){compactionId=items[0]!.id;done=n.method==='turn/completed';}
   if(items.length>1){this.uncertain('公开压缩条目身份不唯一，请恢复核对');this.detached=true;return;}
   if(n.method==='turn/completed')terminal=n.params.turn.status;
  }else if(n.method==='item/started'||n.method==='item/completed'){
   id=n.params.turnId;if(n.params.item.type==='contextCompaction'){compactionId=n.params.item.id;done=n.method==='item/completed';}
  }else return;
  if(this.baseline.has(id))return;
  if(this.candidate&&this.candidate!==id){this.uncertain('压缩请求期间出现多个新回合，归属未确认；请恢复核对');this.detached=true;return;}
  this.candidate=id;
  if(compactionId){
   if(this.itemId&&this.itemId!==compactionId){this.uncertain('公开压缩条目身份已变化，请恢复核对');this.detached=true;return;}
   this.turnId=id;this.itemId=compactionId;this.itemDone ||= done;
   if(this.active)this.phase=this.cancelRequested?'canceling':'running';
  }
  if(terminal&&terminal!=='inProgress')this.terminal=terminal;
  // Terminal can precede the item receipt. An empty ACK never completes this operation.
  if(this.active&&this.turnId&&this.terminal&&(this.itemDone||this.terminal!=='completed'))this.phase=this.terminal;
  if(this.phase==='failed'&&n.method==='turn/completed'&&n.params.turn.error?.message)this.detail='压缩失败：'+n.params.turn.error.message;
 }
}
