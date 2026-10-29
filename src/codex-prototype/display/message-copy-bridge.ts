import type {PageHost} from '../page-host';
type Owner={threadId:string;connectionId:number};
/** Acknowledged whole-message copying. The host resolves the public message identity. */
export class MessageCopyBridge{
 private id=0;private pending=new Map<number,{owner:Owner;turnId:string;itemId:string;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private host:PageHost,private owner:()=>Owner){this.host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',()=>this.dispose(),{once:true});}
 copy=(turnId:string,itemId:string)=>new Promise<void>((resolve,reject)=>{const id=++this.id,owner=this.owner(),timer=setTimeout(()=>{this.pending.delete(id);reject(Error('复制未收到确认，请重试或手动选择'));},3000);this.pending.set(id,{owner,turnId,itemId,resolve,reject,timer});this.host.postMessage({type:'message-copy',id,...owner,turnId,itemId});});
 private message=(e:MessageEvent)=>{const m=e.data;if(m?.type!=='message-copied')return;const p=this.pending.get(m.id);if(!p)return;if(m.threadId!==p.owner.threadId||m.connectionId!==p.owner.connectionId||m.turnId!==p.turnId||m.itemId!==p.itemId)return;clearTimeout(p.timer);this.pending.delete(m.id);const owner=this.owner();if(m.ok===true&&owner.threadId===p.owner.threadId&&owner.connectionId===p.owner.connectionId)p.resolve();else p.reject(Error(typeof m.error==='string'?m.error:'复制失败或消息身份已失效'));};
 clear(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('消息显示身份已失效'));}this.pending.clear();}
 dispose(){this.host.messages.removeEventListener('message',this.message);this.clear();}
}
