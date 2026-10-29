import type {Transport} from './rpc';
import type {AccountLimitsCache} from './account-limits-cache';
type Owner={rpc:Transport;threadId:string;connectionId:number;ready:boolean;cache:AccountLimitsCache};
/** Page leases only; every page and thread shares the connection's in-flight read. */
export class AccountLimitsHost{
 private last=0;
 constructor(private owner:()=>Owner|undefined,private current:()=>boolean){}
 async handle(message:any,post:(reply:object)=>unknown):Promise<boolean>{
  if(message?.type!=='account-limits-read')return false;
  if(!this.current()||!Number.isSafeInteger(message.id)||message.id<1||message.id<=this.last)return true;
	  const id=this.last=message.id,owner=this.owner(),accountEpoch=owner?.cache.accountEpoch;
  const live=()=>{const next=this.owner();return this.current()&&next?.rpc===owner?.rpc&&next?.connectionId===owner?.connectionId&&next?.threadId===owner?.threadId&&next?.ready===true;};
  try{
   if(!owner?.ready||!live()||message.threadId!==owner.threadId||message.connectionId!==owner.connectionId)throw Error('账户额度读取的连接或页面已失效');
	   const value=await owner.cache.refresh();
	   if(live()&&owner.cache.accountEpoch===accountEpoch)await post({type:'account-limits-result',id,threadId:owner.threadId,connectionId:owner.connectionId,ok:!value.error&&!!value.snapshot,accountLimits:value});
  }catch(error){if(live())await post({type:'account-limits-result',id,threadId:owner?.threadId,connectionId:owner?.connectionId,ok:false,error:error instanceof Error?error.message.slice(0,500):'账户额度无法读取'});}
  return true;
 }
}
