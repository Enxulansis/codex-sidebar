import type {PageHost} from '../page-host';
type Owner={threadId:string;connectionId:number};
export class ReplyActionBridge{
 readonly viewId=crypto.randomUUID();private sequence=0;private speaking:{id:number;turnId:string;itemId:string;owner:Owner}|undefined;private pending=new Map<number,any>();private forkUnknown=false;
 constructor(private host:PageHost,private owner:()=>Owner,private changed:()=>void){this.host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',this.dispose,{once:true});}
 isSpeaking=(turn:string,item:string)=>this.speaking?.turnId===turn&&this.speaking?.itemId===item;
 toggle=(turnId:string,itemId:string)=>this.run(this.isSpeaking(turnId,itemId)?'speech-stop':'speak',turnId,itemId);
 fork=(turnId:string,itemId:string)=>{if(this.forkUnknown)return Promise.reject(Error('分支结果未确认，请正常Reload后核对；未自动重试'));return this.run('fork',turnId,itemId);};
 private run(action:string,turnId:string,itemId:string):Promise<void>{return new Promise((resolve,reject)=>{const id=++this.sequence,owner=this.owner(),timer=setTimeout(()=>{this.pending.delete(id);if(action==='fork')this.forkUnknown=true;else if(action==='speak')this.host.postMessage({type:'reply-action',id:++this.sequence,viewId:this.viewId,...owner,turnId,itemId,action:'speech-stop'});reject(Error(action==='fork'?'分支结果未确认，请正常Reload后核对，勿重复创建':'朗读未确认，已请求停止'));},action==='fork'?30000:7000);this.pending.set(id,{id,action,owner,turnId,itemId,resolve,reject,timer});this.host.postMessage({type:'reply-action',id,viewId:this.viewId,...owner,turnId,itemId,action});});}
 private message=(e:MessageEvent)=>{const m=e.data;if(!['reply-action-result','reply-speech-ended'].includes(m?.type)||m.viewId!==this.viewId)return;const owner=this.owner();if(m.threadId!==owner.threadId||m.connectionId!==owner.connectionId)return;const p=this.pending.get(m.id);if(p&&m.turnId===p.turnId&&m.itemId===p.itemId){clearTimeout(p.timer);this.pending.delete(m.id);if(m.ok===true){if(p.action==='speak'&&m.phase==='started')this.speaking={id:m.id,turnId:m.turnId,itemId:m.itemId,owner};else if(p.action==='speech-stop')this.speaking=undefined;p.resolve();}else p.reject(Error(m.error||'回复操作失败'));}
  if(m.type==='reply-speech-ended'&&this.speaking?.id===m.id)this.speaking=undefined;this.changed();};
 clear(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('回复操作身份已失效'));}this.pending.clear();this.speaking=undefined;this.forkUnknown=false;this.changed();}
 dispose=()=>{if(this.speaking){const s=this.speaking;this.host.postMessage({type:'reply-action',id:++this.sequence,viewId:this.viewId,...s.owner,turnId:s.turnId,itemId:s.itemId,action:'speech-stop'});}this.host.messages.removeEventListener('message',this.message);this.clear();};
}
