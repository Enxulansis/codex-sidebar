import {randomUUID} from 'node:crypto';
import type {DisplayStateStorage} from './display-settings';
import {validDraft} from './draft-store';
import {draftImages,draftFiles,type DraftFields} from './draft-store-types';
import type {Session} from './session';
import {validImageProofs,type ImageProof} from './attachment-policy';

export const LOCAL_QUEUE_KEY='codexPrototype.localQueue.v1';
export const QUEUE_THREAD_CAP=32,QUEUE_ITEM_CAP=20;
export type QueueItem={id:string;value:DraftFields;status:'queued'|'sending'|'unknown';imageProofs?:ImageProof[]};
export type QueueState={items:QueueItem[];paused:boolean;reason:string};
const empty=():QueueState=>({items:[],paused:true,reason:''});
const validThread=(id:unknown):id is string=>typeof id==='string'&&!!id&&id.length<=256;
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export const validQueueValue=(v:unknown):v is DraftFields=>validDraft(v)&&v.text.length<=20000&&!!(v.text.trim()||v.image||v.extraImages?.length||v.files?.length);
export function validQueueState(v:any):v is QueueState{return !!v&&typeof v.paused==='boolean'&&typeof v.reason==='string'&&v.reason.length<=500&&Array.isArray(v.items)&&v.items.length<=QUEUE_ITEM_CAP&&new Set(v.items.map((i:any)=>i?.id)).size===v.items.length&&v.items.every((i:any)=>validId(i?.id)&&validQueueValue(i?.value)&&['queued','sending','unknown'].includes(i.status)&&(i.imageProofs===undefined||validImageProofs(draftImages(i.value),i.imageProofs)));}
const requireProof=(item:QueueItem)=>{if(!validImageProofs(draftImages(item.value),item.imageProofs))throw Error('旧队列图片缺少发送摘要；原条目保留，请核对图片并重新附加后加入队列');};

/** Durable local submissions. Never interprets a persisted in-flight entry as safe to replay. */
export class LocalQueueStore{
 private records=new Map<string,QueueState>();private tail:Promise<unknown>=Promise.resolve();private corrupt=false;private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){const raw=storage.get<unknown>(LOCAL_QUEUE_KEY,undefined);if(raw===undefined)return;if(!Array.isArray(raw)||raw.length>QUEUE_THREAD_CAP||new Set(raw.map(v=>v?.[0])).size!==raw.length||raw.some(v=>!Array.isArray(v)||v.length!==2||!validThread(v[0])||!validQueueState(v[1]))){this.corrupt=true;return;}this.records=new Map(structuredClone(raw));}
 read(thread:string){if(this.corrupt)throw Error('本地队列存储无法读取；原数据已保留，未自动发送');if(!validThread(thread)||this.forgotten.has(thread))throw Error('队列线程无效或已永久删除');return structuredClone(this.records.get(thread)??empty());}
 async load(thread:string){await this.tail;return this.read(thread);}
 async attachmentReferences(){await this.tail;if(this.corrupt)throw Error('队列存储无法读取；未清理附件');return [...this.records].flatMap(([thread,state])=>state.items.flatMap(item=>{const owner=JSON.stringify([thread,item.id]);return [...draftImages(item.value).map(image=>({owner,path:image.path})),...draftFiles(item.value).map(file=>({owner,path:file.path}))];}));}
 private change(thread:string,change:(value:QueueState)=>void){const task=this.tail.then(async()=>{const value=this.read(thread);change(value);if(!validQueueState(value))throw Error('队列变更格式无效');const next=new Map(this.records);if(value.items.length)next.set(thread,value);else next.delete(thread);if(next.size>QUEUE_THREAD_CAP)throw Error('本地队列已达32会话上限，请先处理已有条目');await this.storage.update(LOCAL_QUEUE_KEY,[...next]);this.records=next;return structuredClone(value);});this.tail=task.catch(()=>{});return task;}
 initialize(){const task=this.tail.then(async()=>{if(this.corrupt)throw Error('本地队列存储无法读取，未覆盖原数据');const next=new Map(structuredClone([...this.records]));for(const value of next.values()){value.paused=true;value.reason=value.items.some(item=>!validImageProofs(draftImages(item.value),item.imageProofs))?'旧队列图片缺少发送摘要；请核对并重新附加，原条目保留':'窗口或连接已重新建立；核对历史后手动继续本地队列';for(const item of value.items)if(item.status==='sending')item.status='unknown';}await this.storage.update(LOCAL_QUEUE_KEY,[...next]);this.records=next;});this.tail=task.catch(()=>{});return task;}
 enqueue(thread:string,id:string,value:DraftFields,waiting:boolean,imageProofs?:ImageProof[],current:()=>boolean=()=>true){
  if(!validId(id)||!validQueueValue(value))return Promise.reject(Error('排队内容或标识无效'));
  if(!validImageProofs(draftImages(value),imageProofs))return Promise.reject(Error('图片缺少已显示预览的发送摘要，未加入队列'));
  return this.change(thread,state=>{
   // The write has not started yet. Once it starts, a later Stop serializes a
   // pause after the commit rather than discarding an acknowledged queue item.
   if(!current())throw Error('排队已取消或身份已变化，草稿保留');
   const existing=state.items.find(item=>item.id===id);
   if(existing){if(JSON.stringify(existing.value)!==JSON.stringify(value)||JSON.stringify(existing.imageProofs??[])!==JSON.stringify(imageProofs??[]))throw Error('排队标识已用于其他内容');return;}
   if(state.items.length>=QUEUE_ITEM_CAP)throw Error('此会话本地队列已达20项，未截断或丢弃内容');
   if(!state.items.length){state.paused=!waiting;state.reason=waiting?'等待当前回合明确结束':'点击“继续发送”后开始本地队列';}
   state.items.push({id,value:structuredClone(value),status:'queued',...(imageProofs?.length?{imageProofs:structuredClone(imageProofs)}:{})});
  });
 }
 edit(thread:string,id:string,text:string){return this.change(thread,state=>{const item=state.items.find(v=>v.id===id);if(!item||item.status!=='queued')throw Error('只能编辑尚未发送的队列条目');if(typeof text!=='string'||!text.trim()||text.length>20000)throw Error('队列文字不能为空且最多20000字符');item.value.text=text;});}
 remove(thread:string,id:string,reviewed=false){return this.change(thread,state=>{const item=state.items.find(v=>v.id===id);if(!item||item.status==='sending'||item.status==='unknown'&&!reviewed)throw Error('条目正在发送或结果未知，请先核对历史');state.items=state.items.filter(v=>v!==item);});}
 pause(thread:string,reason:string){return this.change(thread,state=>{state.paused=true;state.reason=reason.slice(0,500);});}
 resume(thread:string){return this.change(thread,state=>{if(state.items.some(v=>v.status!=='queued'))throw Error('存在发送结果未确认的条目，请先核对历史并移出，不能自动重发');state.items.forEach(requireProof);state.paused=false;state.reason='';});}
 reconcile(thread:string){return this.change(thread,state=>{state.paused=true;state.reason='发送记录尚未核对；请检查公开历史后移出结果未知的条目，不会自动重发';for(const item of state.items)if(item.status==='sending')item.status='unknown';});}
 begin(thread:string,id:string){return this.change(thread,state=>{if(state.paused||state.items[0]?.id!==id||state.items[0].status!=='queued')throw Error('队列已暂停或首项已变化');requireProof(state.items[0]);state.items[0].status='sending';});}
 beginSteer(thread:string,id:string){return this.change(thread,state=>{const item=state.items.find(v=>v.id===id);if(!item||item.status!=='queued'||state.items.some(v=>v.status!=='queued'))throw Error('条目或其他发送结果尚未核对，不能引导');requireProof(item);item.status='sending';});}
 finish(thread:string,id:string,outcome:'accepted'|'failed'|'unknown'){return this.change(thread,state=>{const item=state.items.find(v=>v.id===id);if(!item||item.status!=='sending')throw Error('队列发送回执身份已失效');if(outcome==='accepted')state.items=state.items.filter(v=>v!==item);else{item.status=outcome==='unknown'?'unknown':'queued';state.paused=true;state.reason=outcome==='unknown'?'发送结果未知；核对历史后移出该项，不能自动重发':'本项未发送，队列已暂停；处理问题后手动继续';}});}
 forget(thread:string){if(!validThread(thread)||this.corrupt)return Promise.reject(Error('无法安全清理队列'));this.forgotten.add(thread);const task=this.tail.then(async()=>{const next=new Map(this.records);next.delete(thread);await this.storage.update(LOCAL_QUEUE_KEY,[...next]);this.records=next;});this.tail=task.catch(()=>{});return task;}
}

/** One connection owns dispatch. Visibility never drives this runner. */
export class LocalQueueRunner{
 private epoch=0;private active=false;private disposed=false;private permitted:string|undefined;private handled=new Set<string>();private owner='';private blocked='';private connectionLost=false;
 readonly ready:Promise<void>;
 constructor(readonly store:LocalQueueStore,private session:Session){this.owner=session.projection.threadId;this.ready=store.initialize().catch(error=>{this.blocked=error instanceof Error?error.message:String(error);});session.on('queue-pause',this.pauseEvent);session.on('queue-terminal',this.terminal);session.on('change',this.changed);}
 get isBlocked(){return !!this.blocked;}
 snapshot(thread=this.session.projection.threadId){if(!thread)return{...empty(),blocked:false};try{const value=this.store.read(thread);return this.blocked?{...value,paused:true,blocked:true,reason:this.blocked+'；点击重新核对后处理，未自动重试'}:{...value,blocked:false};}catch(error){return{...empty(),blocked:true,reason:error instanceof Error?error.message:String(error)};}}
 async recover(thread:string){await this.ready;if(this.active)throw Error('提交仍在等待回执，请稍后核对');if(this.blocked){await this.store.reconcile(thread);this.blocked='';this.epoch++;this.permitted=undefined;}return this.store.load(thread);}
 private changed=()=>{const thread=this.session.projection.threadId;if(thread!==this.owner){const old=this.owner;this.owner=thread;if(old)void this.pause(old,'会话已切换；核对后手动继续本地队列');}if(!this.session.isConnected&&thread&&!this.connectionLost){this.connectionLost=true;void this.pause(thread,'连接已断开；核对历史后手动继续本地队列');}else if(this.session.isConnected&&!this.session.sendOutcomeUncertain&&!this.session.approvals.size&&!this.session.waitingForUserInput&&this.permitted===thread&&!this.session.busy&&!this.session.isOperating&&!this.session.isStarting)void this.drain();};
 private terminal=(value:{threadId:string;turnId:string;status:string;canceled:boolean})=>{const key=JSON.stringify([value.threadId,value.turnId]);if(this.handled.has(key))return;this.handled.add(key);if(value.status!=='completed'||value.canceled||!this.session.isConnected||this.session.sendOutcomeUncertain){void this.pause(value.threadId,'当前回合已取消、失败或连接状态未核对；手动继续本地队列');return;}this.permitted=value.threadId;void this.drain();};
 private pauseEvent=(reason:string)=>{if(this.session.projection.threadId)void this.pause(this.session.projection.threadId,reason);};
 async pause(thread:string,reason:string){this.epoch++;this.permitted=undefined;await this.ready;if(!this.blocked)try{await this.store.pause(thread,reason);}catch(error){this.blocked=error instanceof Error?error.message:String(error);}this.session.emit('change');}
 async enqueue(thread:string,value:DraftFields,id=randomUUID(),imageProofs?:ImageProof[],current:()=>boolean=()=>true){
  const epoch=this.epoch,valid=()=>current()&&!this.disposed&&epoch===this.epoch&&this.session.isConnected&&this.session.projection.threadId===thread&&!this.session.sendOutcomeUncertain;
  await this.ready;if(this.blocked)throw Error(this.blocked);if(!valid())throw Error('排队已取消或身份/恢复状态未核对');
  return this.store.enqueue(thread,id,value,this.session.busy&&!!this.session.projection.activeTurn(),imageProofs,valid);
 }
 async resume(thread:string){await this.ready;if(this.blocked)throw Error(this.blocked);if(this.disposed||!this.session.isConnected||this.session.projection.threadId!==thread||this.session.sendOutcomeUncertain||this.session.isOperating||this.session.approvals.size||this.session.waitingForUserInput)throw Error('请先恢复并核对当前会话');await this.store.resume(thread);this.permitted=thread;void this.drain();this.session.emit('change');}
 /** Explicitly steer a selected durable entry; it never becomes a fresh turn/start. */
 async steer(thread:string,id:string,expectedTurnId:string,lease:()=>boolean=()=>true){
  if(this.active)throw Error('队列提交仍在等待确认');this.active=true;const epoch=this.epoch;
  const valid=()=>!this.disposed&&epoch===this.epoch&&lease()&&thread===this.session.projection.threadId&&this.session.isConnected&&!this.session.sendOutcomeUncertain;
  try{
   await this.ready;if(this.blocked)throw Error(this.blocked);
   if(!valid()||!expectedTurnId||this.session.projection.activeTurn()!==expectedTurnId||!this.session.busy||this.session.isOperating||this.session.isStarting||this.session.approvals.size||this.session.waitingForUserInput)throw Error('当前活动回合已变化或正在等待回答/审批/停止/恢复');
   const state=await this.store.beginSteer(thread,id),item=state.items.find(v=>v.id===id)!;let accepted=false;
   try{
    if(!valid())throw Error('引导准备期间身份已变化，未提交');
    const images=draftImages(item.value);accepted=await this.session.steer(item.value.text,images[0]?.path,item.value.files??[],images.slice(1),expectedTurnId,valid,item.imageProofs,item.value.skill);
    await this.store.finish(thread,id,accepted?'accepted':'failed');return accepted;
   }catch(error){
    try{await this.store.finish(thread,id,accepted||this.session.sendOutcomeUncertain?'unknown':'failed');}
    catch(saveError){this.blocked='引导记录保存未确认，已停止自动执行：'+(saveError instanceof Error?saveError.message:String(saveError));this.permitted=undefined;}
    throw error;
   }
  }finally{this.active=false;this.session.emit('change');}
 }
 private async drain(){
  if(this.active||this.disposed||this.blocked)return;this.active=true;const epoch=this.epoch,thread=this.permitted,valid=()=>!this.disposed&&epoch===this.epoch&&thread===this.session.projection.threadId&&this.session.isConnected&&!this.session.sendOutcomeUncertain;
  try{await this.ready;if(!thread||!valid()){this.permitted=undefined;return;}if(this.session.busy||this.session.isOperating||this.session.isStarting||this.session.approvals.size||this.session.waitingForUserInput)return;this.permitted=undefined;const state=await this.store.load(thread),item=state.items[0];if(!valid()||state.paused||!item||item.status!=='queued')return;await this.store.begin(thread,item.id);if(!valid()){await this.store.finish(thread,item.id,'failed');return;}let accepted=false;
   try{const images=draftImages(item.value);accepted=await this.session.send(item.value.text,images[0]?.path,item.value.files??[],images.slice(1),valid,item.imageProofs,item.value.skill);await this.store.finish(thread,item.id,accepted?'accepted':'failed');}
   catch(error){await this.store.finish(thread,item.id,accepted||this.session.sendOutcomeUncertain?'unknown':'failed');this.session.error=error instanceof Error?error.message:String(error);}
  }catch(error){this.blocked='本地队列保存或发送未确认，已停止自动执行：'+(error instanceof Error?error.message:String(error));this.permitted=undefined;}
  finally{this.active=false;this.session.emit('change');}
 }
 dispose(){this.disposed=true;this.epoch++;this.permitted=undefined;this.session.off('queue-pause',this.pauseEvent);this.session.off('queue-terminal',this.terminal);this.session.off('change',this.changed);}
}
