import {speechText,type LocalSpeech} from './local-speech';
import type {MessageCopyOwner} from './message-copy';
export type ReplyOwner=MessageCopyOwner&{busy?:boolean;approvals?:unknown[]};
/** Host resolves current public assistant text. Clients send identity, never executable text. */
export class ReplyActionHost{
 private speech?:any;private speechPost:((m:any)=>unknown)|undefined;private lastRequest=0;private view='';
 constructor(private owner:()=>ReplyOwner|undefined,private active:()=>boolean,private engine:Pick<LocalSpeech,'start'|'stop'>,private fork:(turn:string,item:string)=>Promise<string>,private forkReason:(turn:string,item:string)=>string){}
 sync(){if(this.speech){const o=this.owner(),m=this.speech;if(!this.active()||!o||o.threadId!==m.threadId||o.connectionId!==m.connectionId||!o.items.some(v=>v.complete&&v.turnId===m.turnId&&v.item.id===m.itemId&&v.item.text===m.sourceText))this.stop();}}
 stop(){const m=this.speech,post=this.speechPost;this.engine.stop();this.speech=undefined;this.speechPost=undefined;if(m&&post&&this.active())void post({type:'reply-speech-ended',id:m.id,viewId:m.viewId,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,itemId:m.itemId,ok:true,phase:'stopped'});}
 async handle(m:any,post:(m:any)=>unknown){
  if(m?.type!=='reply-action')return false;if(!this.active())return true;
  const reply={type:'reply-action-result',id:m.id,viewId:m.viewId,threadId:m.threadId,connectionId:m.connectionId,turnId:m.turnId,itemId:m.itemId};
  try{
   if(!Number.isSafeInteger(m.id)||m.id<1||!['speak','speech-stop','fork'].includes(m.action)||!/^[0-9a-f-]{36}$/i.test(m.viewId??''))throw Error('回复操作标识无效');
   if(!this.view)this.view=m.viewId;if(m.viewId!==this.view)throw Error('回复视图已失效');
   const o=this.owner(),row=o?.items.find(v=>v.item.id===m.itemId&&v.turnId===m.turnId);
   if(!o||o.threadId!==m.threadId||o.connectionId!==m.connectionId||!row?.complete||row.item.type!=='agentMessage')throw Error('回复操作身份已失效或正文尚未完成');
   if(m.id<=this.lastRequest)throw Error('该操作已经处理或已过期，未重复执行');this.lastRequest=m.id;
   if(m.action==='speech-stop'){if(this.speech&&this.speech.turnId===m.turnId&&this.speech.itemId===m.itemId)this.stop();await post({...reply,ok:true,phase:'stopped'});return true;}
   if(m.action==='fork'){const reason=this.forkReason(m.turnId,m.itemId);if(reason)throw Error(reason);const threadId=await this.fork(m.turnId,m.itemId);if(this.active())await post({...reply,ok:true,threadIdCreated:threadId});return true;}
   const text=speechText(row.item.text??'');this.stop();m.sourceText=row.item.text;this.speech=m;this.speechPost=post;
   this.engine.start(text,(phase,error,bytes)=>{if(this.speech!==m||!this.active())return;this.sync();if(this.speech!==m)return;if(phase==='started')void post({...reply,ok:true,phase});else{this.speech=undefined;void post({...reply,type:'reply-speech-ended',ok:phase!=='error',phase,error,verifiedBytes:bytes});}});
  }catch(e){if(this.active())await post({...reply,ok:false,error:e instanceof Error?e.message:'回复操作失败'});}return true;
 }
}
