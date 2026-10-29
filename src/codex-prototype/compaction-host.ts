import type {Session} from './session';
type Owner={session:Session;connectionId:number};
/** The page lease gates preparation; a submitted request remains owned by its Session. */
export class CompactionHost{
 private last=0;private pending=false;
 constructor(private owner:()=>Owner|undefined,private current:()=>boolean){}
 async handle(message:any,post:(value:object)=>unknown):Promise<boolean>{
  if(message?.type!=='compact')return false;
  if(!this.current()||!Number.isSafeInteger(message.id)||message.id<1||message.id<=this.last)return true;this.last=message.id;
  const owner=this.owner(),thread=owner?.session.projection.threadId;
  const live=()=>{const now=this.owner();return this.current()&&!!owner&&now?.session===owner.session&&now.connectionId===owner.connectionId&&now.session.projection.threadId===thread;};
  try{
   if(!owner||message.threadId!==thread||message.connectionId!==owner.connectionId||!live())throw Error('压缩页面、会话或连接已失效，未提交');
   if(this.pending)throw Error('上一项压缩请求尚未确认');
   this.pending=true;
   try{await owner.session.compact(live);if(live())await post({type:'compact-result',id:message.id,threadId:thread,connectionId:owner.connectionId,ok:true});}
   finally{this.pending=false;}
  }catch(error){if(live())await post({type:'compact-result',id:message.id,threadId:thread,connectionId:owner!.connectionId,ok:false,error:error instanceof Error?error.message:'压缩结果未确认'});}
  return true;
 }
}
