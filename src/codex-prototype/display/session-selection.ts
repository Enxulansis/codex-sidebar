import type {PageHost} from '../page-host';
import {pageContentReady,type PageState} from '../page-model';
type Selection={id:number;threadId:string;connectionId:number;confirmed:boolean;current:()=>boolean;resolve:(ok:boolean)=>void;timer:ReturnType<typeof setTimeout>};
/** A search selection completes only after its restore receipt and usable body state.
 * A newer selection is sent even when its target still appears current: an older
 * restore may already be running in the host and must be followed by the new intent. */
export class SessionSelection{
 private sequence=0;private pending:Selection|undefined;private state:PageState|undefined;private landing:ReturnType<typeof setTimeout>|undefined;
 constructor(private host:PageHost){host.messages.addEventListener('message',this.receive);window.addEventListener('pagehide',this.dispose,{once:true});}
 select(threadId:string,current:()=>boolean){
  this.finish(false);const state=this.state;if(!current()||!state||!pageContentReady(state)||state.busy||!threadId)return Promise.resolve(false);
  return new Promise<boolean>((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.pending=undefined;clearTimeout(this.landing);this.landing=undefined;reject(Error('会话切换回执未确认，请核对当前会话'));},30000);this.pending={id,threadId,connectionId:state.connectionId,confirmed:false,current,resolve,timer};this.host.postMessage({type:'restore',threadId,connectionId:state.connectionId,selectionId:id});});
 }
 private finish(ok:boolean){clearTimeout(this.landing);this.landing=undefined;const pending=this.pending;if(!pending)return;this.pending=undefined;clearTimeout(pending.timer);pending.resolve(ok);}
 private settle(){const pending=this.pending,state=this.state;if(!pending)return;if(!pending.current()||!state||state.connectionId!==pending.connectionId){this.finish(false);return;}if(!pending.confirmed||state.threadId!==pending.threadId||state.operating||this.landing!==undefined)return;
  // Native window message listeners have microtask checkpoints between them.
  // Wait for the whole state dispatch before a consumer inspects its own state.
  this.landing=setTimeout(()=>{this.landing=undefined;if(this.pending!==pending)return;const latest=this.state;if(!pending.current()||!latest||latest.connectionId!==pending.connectionId){this.finish(false);return;}if(latest.threadId===pending.threadId&&!latest.operating)this.finish(pageContentReady(latest)&&!latest.needsRecovery);},0);
 }
 private receive=(event:MessageEvent)=>{const message=event.data;if(message?.type==='state'){this.state=message.state;this.settle();return;}const pending=this.pending;if(message?.type!=='session-selected'||!pending||message.id!==pending.id||message.connectionId!==pending.connectionId||message.threadId!==pending.threadId)return;if(!message.ok){this.finish(false);return;}pending.confirmed=true;this.settle();};
 dispose=()=>{this.finish(false);this.host.messages.removeEventListener('message',this.receive);window.removeEventListener('pagehide',this.dispose);};
}
