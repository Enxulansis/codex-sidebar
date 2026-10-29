import type {PageHost} from '../page-host';
type Owner={threadId:string;connectionId:number};
/** Confirmation can stay open indefinitely; the host owns timeout/recovery after dispatch. */
export class RevertBridge{
 private sequence=0;private pending:{id:number;owner:Owner;resolve:(reverted:boolean)=>void;reject:(error:Error)=>void}|undefined;
 constructor(private host:PageHost,private owner:()=>Owner){host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',this.dispose,{once:true});}
 get busy(){return !!this.pending;}
 run(turnId:string,itemId:string):Promise<boolean>{
  if(this.pending)return Promise.reject(Error('回退仍在等待核对，请勿重复操作'));
  return new Promise((resolve,reject)=>{const id=++this.sequence,owner=this.owner();this.pending={id,owner,resolve,reject};try{this.host.postMessage({type:'conversation-revert',id,...owner,turnId,itemId});}catch(error){this.pending=undefined;reject(error);}});
 }
 private message=(event:MessageEvent)=>{const m=event.data,p=this.pending,o=this.owner();if(m?.type!=='conversation-revert-result'||!p||m.id!==p.id||m.threadId!==o.threadId||m.connectionId!==o.connectionId||o.threadId!==p.owner.threadId||o.connectionId!==p.owner.connectionId)return;this.pending=undefined;if(m.ok===true&&typeof m.reverted==='boolean')p.resolve(m.reverted);else p.reject(Error(m.error||'回退结果待核对，请恢复会话'));};
 clear(){this.pending?.reject(Error('回退页面身份已变化；请核对当前会话状态'));this.pending=undefined;}
 private dispose=()=>{this.host.messages.removeEventListener('message',this.message);this.clear();};
}
