import type {DictationCatalog,DictationEvent} from './dictation-types';import type {LocalDictation} from './local-dictation';
type Owner={threadId:string;connectionId:number;writable:boolean};
type Capture=Owner&{captureId:number;post:(value:object)=>unknown;chain:Promise<unknown>;terminal:boolean};
/** A page-owned microphone lease, independent of the backend/model connection. */
export class DictationHost{
 private last=0;private lastOwner='';private capture:Capture|undefined;private probing=false;private catalog:{owner:string;value:DictationCatalog}|undefined;private dead=false;
 constructor(private owner:()=>Owner|undefined,private current:()=>boolean,private engine:Pick<LocalDictation,'probe'|'start'|'stop'|'cancel'>,private beforeStart:()=>void=()=>{}){}
 private key(value:Owner){return JSON.stringify([value.threadId,value.connectionId]);}
 private live(value:Owner){const now=this.owner();return !this.dead&&this.current()&&!!now&&now.threadId===value.threadId&&now.connectionId===value.connectionId&&now.writable;}
 /** Probing and stopping never touch the draft, so a blocked draft must not hide the microphone. */
 private alive(value:Owner){const now=this.owner();return !this.dead&&this.current()&&!!now&&now.threadId===value.threadId&&now.connectionId===value.connectionId;}
 sync(){const value=this.capture;if(value&&!this.live(value))this.abort(value,'草稿来源或页面状态已变化，本次听写已取消');}
 cancel(){const value=this.capture;if(value)this.abort(value,'本次听写已取消，原草稿保留');}
 private abort(value:Capture,reason:string){if(this.capture!==value)return;this.capture=undefined;const closed=this.engine.cancel();
  if(!this.dead&&this.current()&&!value.terminal)void Promise.resolve().then(()=>value.post({type:'dictation-event',captureId:value.captureId,threadId:value.threadId,connectionId:value.connectionId,phase:'cancelled',error:reason})).catch(()=>{});
  void Promise.resolve(closed).catch(()=>{if(!this.dead&&this.current())return Promise.resolve().then(()=>value.post({type:'dictation-cleanup',captureId:value.captureId,threadId:value.threadId,connectionId:value.connectionId,error:'听写进程退出未确认；请核对Windows麦克风指示，确认关闭后再读取本机语言'})).catch(()=>{});});
 }
 private event(value:Capture,event:DictationEvent){
  if(this.capture!==value||value.terminal)return;if(!this.live(value)){this.abort(value,'听写来源已失效，本次结果未加入其他草稿');return;}
  const terminal=['ended','cancelled','error'].includes(event.phase);if(terminal)value.terminal=true;
  value.chain=value.chain.then(async()=>{if(this.capture!==value||!this.live(value))return;await value.post({type:'dictation-event',captureId:value.captureId,threadId:value.threadId,connectionId:value.connectionId,...event});if(terminal&&this.capture===value)this.capture=undefined;}).catch(()=>{if(this.capture===value){this.capture=undefined;this.engine.cancel();}});
 }
 async handle(m:any,post:(value:object)=>unknown){
  if(m?.type!=='dictation')return false;this.sync();if(!this.current()||this.dead||!Number.isSafeInteger(m.id)||m.id<1)return true;
  const owner=this.owner(),reply=(ok:boolean,extra:object={})=>post({type:'dictation-result',id:m.id,action:m.action,threadId:m.threadId,connectionId:m.connectionId,...(Number.isSafeInteger(m.captureId)?{captureId:m.captureId}:{}),ok,...extra});
  try{
   if(!owner||m.threadId!==owner.threadId||m.connectionId!==owner.connectionId||(m.action==='probe'?!this.alive(owner):!this.live(owner)))throw Error('本地听写页面或草稿尚未就绪');
   const key=this.key(owner);if(key!==this.lastOwner){this.lastOwner=key;this.last=0;}if(m.id<=this.last)return true;if(!['probe','start','stop','cancel'].includes(m.action))throw Error('未知听写操作');this.last=m.id;
   if(m.action==='probe'){
    if(this.capture||this.probing)throw Error('本地听写操作仍在进行');this.probing=true;
    try{const value=await this.engine.probe();if(!this.alive(owner))return true;this.catalog={owner:this.key(owner),value};await reply(true,{catalog:value});}finally{this.probing=false;}
   }else if(m.action==='start'){
    if(this.capture||this.probing)throw Error('上一段听写尚未结束');if(this.catalog?.owner!==this.key(owner)||!this.catalog.value.recognizers.some(value=>value.id===m.recognizerId))throw Error('识别语言未核对，请先读取本机语言');
    const value:Capture={...owner,captureId:m.id,post,chain:Promise.resolve(),terminal:false};this.capture=value;this.beforeStart();this.engine.start(m.recognizerId,event=>this.event(value,event),()=>this.capture===value&&this.live(value));await reply(true,{captureId:value.captureId});
   }else if(m.action==='stop'||m.action==='cancel'){
    const value=this.capture;if(!value||value.captureId!==m.captureId||value.terminal)throw Error('本次听写已结束或来源已变化');
    if(m.action==='cancel')this.abort(value,'本次听写已取消，原草稿保留');else this.engine.stop();await reply(true,{captureId:value.captureId});
   }else throw Error('未知听写操作');
  }catch(error){const value=this.capture;if(m.action==='start'&&value&&value.captureId===m.id)this.abort(value,'听写启动失败，原草稿保留');if(!this.dead&&this.current()&&(!owner||this.alive(owner)))await reply(false,{error:error instanceof Error?error.message:'本地听写未确认，原草稿保留'});}
  return true;
 }
 // The extension owns the engine across document replacements, preserving its
 // old-process exit barrier before a new page can acquire the microphone.
 dispose(){if(this.dead)return;const value=this.capture;if(value)this.abort(value,'听写页面已关闭');this.dead=true;this.catalog=undefined;}
}
