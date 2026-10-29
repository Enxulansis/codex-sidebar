import type {Session} from './session';
import type {RevertPreview} from './conversation-revert';
import type {DraftStore} from './draft-store';
import type {LocalQueueRunner} from './local-queue';
type Owner={session:Session;connectionId:number;queue:LocalQueueRunner};
export class RevertHost{
 private last=0;private pending=false;
 constructor(private owner:()=>Owner|undefined,private current:()=>boolean,private drafts:DraftStore,private confirm:(preview:RevertPreview)=>Promise<boolean>){}
 async handle(message:any,post:(value:object)=>unknown):Promise<boolean>{
  if(message?.type!=='conversation-revert')return false;
  const owner=this.owner(),thread=owner?.session.projection.threadId;
  const live=()=>{const now=this.owner();return this.current()&&!!owner&&now?.session===owner.session&&now.connectionId===owner.connectionId&&now.queue===owner.queue&&now.session.projection.threadId===thread;};
  if(!live()||message.threadId!==thread||message.connectionId!==owner!.connectionId||!Number.isSafeInteger(message.id)||message.id<1||message.id<=this.last)return true;
  this.last=message.id;
  try{
   if(this.pending)throw Error('上一项回退仍在等待核对');
   if(typeof message.turnId!=='string'||!message.turnId||typeof message.itemId!=='string'||!message.itemId)throw Error('回退目标无效');
   this.pending=true;
   try{
    const protect=async()=>{
     if(!live())throw Error('回退页面已失效');
     const draft=await this.drafts.load(thread!);if(draft.uncertain||draft.recovery)throw Error('请先核对并处理上次发送的原内容，草稿保留');
     await owner!.queue.pause(thread!,'对话回退已暂停队列；核对后手动继续');
     const queue=owner!.queue.snapshot(thread!);if(queue.blocked||!queue.paused||queue.items.some(item=>item.status!=='queued'))throw Error('队列保存或发送结果未确认，回退未提交');
    };
    const reverted=await owner!.session.revertTurn(message.turnId,message.itemId,live,protect,this.confirm);
    if(live())await post({type:'conversation-revert-result',id:message.id,threadId:thread,connectionId:owner!.connectionId,ok:true,reverted});
   }finally{this.pending=false;}
  }catch(error){if(live())await post({type:'conversation-revert-result',id:message.id,threadId:thread,connectionId:owner!.connectionId,ok:false,error:error instanceof Error?error.message:'回退结果待核对'});}
  return true;
 }
}
