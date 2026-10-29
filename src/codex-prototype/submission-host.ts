import {matchesSendRequest,validSendFiles} from './send-request';
import type {Session} from './session';
import type {DraftStore} from './draft-store';
import {draftFiles,draftImages} from './draft-store-types';
import type {LocalQueueRunner} from './local-queue';
type Identity={threadId:string;connectionId:number;threads:string[]};
/** Additional submission modes share the production draft transaction and transport lease. */
export class SubmissionHost{
 private view='';private lastSend=0;private lastAction=0;
 constructor(private queue:LocalQueueRunner,private drafts:DraftStore,private session:Session,private identity:()=>Identity,private current:()=>boolean,private confirmUnknown:()=>Promise<boolean>){}
 async handle(m:any,post:(message:any)=>unknown){
  const submission=m?.type==='send'&&['queue','steer'].includes(m.mode),mutation=m?.type==='queue-action';if(!submission&&!mutation)return false;if(!this.current())return true;
  const owner=this.identity(),current=()=>this.current()&&this.identity().threadId===owner.threadId&&this.identity().connectionId===owner.connectionId;
  if(submission){
   const cancellationVersion=this.session.cancellationVersion,canDispatch=()=>current()&&this.session.cancellationVersion===cancellationVersion;
   const reply=(ok:boolean,unknown=false,error='')=>current()?post({type:'sent',mode:m.mode,viewId:m.viewId,requestId:m.requestId,threadId:m.threadId,connectionId:m.connectionId,ok,unknown,error}):undefined;
   if(!validSendFiles(m)||!matchesSendRequest(m,owner)||!owner.threads.includes(m.threadId)){await reply(false,false,'提交身份或附件格式无效');return true;}
   if(!this.view)this.view=m.viewId;if(m.viewId!==this.view||m.requestId<=this.lastSend)return true;this.lastSend=m.requestId;
   let begun=false,accepted=false;
   try{
    await this.queue.ready;if(!canDispatch())throw Error('提交已取消或页面/连接已变化，草稿保留');
    await this.drafts.begin(m.threadId,m.text,m.image||'',m.imageToken,m.files,m.extraImages,m.skill,m.draftEditId,m.mode);begun=true;if(!canDispatch())throw Error('保存期间提交已取消或身份已变化，草稿保留');
    if(m.mode==='queue'){const value=this.drafts.read(m.threadId);await this.queue.enqueue(m.threadId,{text:m.text,image:m.image||'',imageToken:m.imageToken||'',pathInput:value.pathInput,...(m.files?.length?{files:m.files}:{}),...(m.extraImages?.length?{extraImages:m.extraImages}:{}),...(m.skill?{skill:{...m.skill}}:{})},m.queueId,m.imageProofs,canDispatch);accepted=true;}
    else accepted=await this.session.steer(m.text,m.image||undefined,m.files,m.extraImages,m.expectedTurnId,canDispatch,m.imageProofs,m.skill);
    await this.drafts.finish(m.threadId,m.text,m.image||'',accepted,m.imageToken,m.files,m.extraImages,m.skill,m.draftEditId);await reply(accepted);
   }catch(error){let draftUnknown=true;try{draftUnknown=this.drafts.read(m.threadId).uncertain;}catch{}let unknown=accepted||this.session.sendOutcomeUncertain||!begun&&draftUnknown;if(begun&&!unknown)try{await this.drafts.finish(m.threadId,m.text,m.image||'',false,m.imageToken,m.files,m.extraImages,m.skill,m.draftEditId);}catch{unknown=true;}await reply(false,unknown,error instanceof Error?error.message:String(error));}
   this.session.emit('change');return true;
  }
  const reply:any={type:'queue-result',id:m.id,threadId:m.threadId,connectionId:m.connectionId};
  try{
   if(!Number.isSafeInteger(m.id)||m.id<1||m.threadId!==owner.threadId||m.connectionId!==owner.connectionId||!owner.threads.includes(m.threadId)||!['read','edit','remove','review-remove','pause','resume','steer'].includes(m.action))throw Error('本地队列操作身份无效');
   if(m.id<=this.lastAction)return true;this.lastAction=m.id;await this.queue.ready;if(!current())return true;
   if(this.queue.isBlocked&&m.action!=='read')throw Error('队列保存未确认；请先点击重新核对，不会自动重试');
   if(m.action==='read')await this.queue.recover(m.threadId);
   else if(m.action==='resume')await this.queue.resume(m.threadId);
   else if(m.action==='pause')await this.queue.pause(m.threadId,'用户已暂停本地队列；手动继续后才会发送');
   else if(m.action==='steer'){if(typeof m.expectedTurnId!=='string')throw Error('缺少已确认活动回合');await this.queue.steer(m.threadId,m.itemId,m.expectedTurnId,current);}
   else if(m.action==='edit')await this.queue.store.edit(m.threadId,m.itemId,m.text);
   else if(m.action==='remove')await this.queue.store.remove(m.threadId,m.itemId);
   else{const item=(await this.queue.store.load(m.threadId)).items.find(item=>item.id===m.itemId);if(item?.status!=='unknown')throw Error('该条目不是结果未知状态');if(!await this.confirmUnknown()){reply.cancelled=true;if(current())await post(reply);return true;}if(!current())return true;await this.queue.store.remove(m.threadId,m.itemId,true);}
   reply.ok=true;
  }catch(error){reply.ok=false;reply.error=error instanceof Error?error.message:String(error);}
  if(current()){this.session.emit('change');await post(reply);}return true;
 }
}
/** No filesystem bytes or guessed runtime queue entries enter this display projection. */
export function queueDisplay(queue:LocalQueueRunner,session:Session){const value=queue.snapshot();return{...value,items:value.items.map(item=>({id:item.id,text:item.value.text,preview:(item.value.text.replace(/\s+/g,' ').trim()||'附件').slice(0,200),attachments:draftImages(item.value).length+draftFiles(item.value).length,...(item.value.skill?{skillName:item.value.skill.name}:{}),status:item.status})),steerTurnId:session.steerableTurnId??''};}
