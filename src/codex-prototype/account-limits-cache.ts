import type {Transport} from './rpc';
import {accountLimitsSnapshot,type AccountLimitsView} from './account-limits';
export const ACCOUNT_LIMITS_REFRESH_MS=60_000;
/** One in-memory quota cache per connection. Never blocks connection or conversation setup. */
export class AccountLimitsCache{
 private timer:ReturnType<typeof setTimeout>|undefined;
 private flight:Promise<AccountLimitsView>|undefined;
 private started=false;private dead=false;private epoch=0;private failures=0;
 private value:AccountLimitsView={revision:0,pending:false,error:''};
 constructor(private rpc:Transport,private current:()=>boolean,private changed:()=>void){}
 get view():AccountLimitsView{return this.value;}
 get accountEpoch(){return this.epoch;}
 private publish(value:Omit<AccountLimitsView,'revision'>){this.value={...value,revision:this.value.revision+1};this.changed();}
 start(){if(this.started||this.dead||!this.current())return;this.started=true;void this.refresh();}
 invalidateAccount(){
  if(this.dead)return;this.epoch++;this.failures=0;clearTimeout(this.timer);
  this.publish({pending:!!this.flight,error:''});
  // Let an old read finish before issuing the new account's read; its result is discarded.
  if(this.started&&!this.flight)void this.refresh();
 }
 refresh():Promise<AccountLimitsView>{
  if(this.dead||!this.current())return Promise.resolve(this.value);
  if(this.flight)return this.flight;
  clearTimeout(this.timer);const epoch=this.epoch;
  // Install the shared promise before publishing so reentrant observers cannot duplicate the read.
  const work=Promise.resolve().then(async()=>{
   try{
    if(this.dead||!this.current()||epoch!==this.epoch)return;
    const raw=await this.rpc.request('account/rateLimits/read',{supportsLunaReserve:false,excludeResetCreditDetails:true});
    if(this.dead||!this.current()||epoch!==this.epoch)return;
    const snapshot=accountLimitsSnapshot(raw,Date.now());this.failures=0;this.publish({snapshot,pending:false,error:''});
   }catch(error){
    if(this.dead||!this.current()||epoch!==this.epoch)return;
    this.failures++;this.publish({...this.value,pending:false,error:error instanceof Error?error.message.slice(0,500):'账户额度无法读取'});
   }finally{
    this.flight=undefined;
    if(!this.dead&&this.current()&&this.started){
     if(epoch!==this.epoch)void this.refresh();
     else this.timer=setTimeout(()=>{void this.refresh();},Math.min(300_000,ACCOUNT_LIMITS_REFRESH_MS*2**Math.max(0,this.failures-1)));
    }
   }
   return;
  }).then(()=>this.value);
  this.flight=work;this.publish({...this.value,pending:true,error:''});return work;
 }
 dispose(){if(this.dead)return;this.dead=true;this.started=false;this.epoch++;clearTimeout(this.timer);this.timer=undefined;this.publish({...this.value,pending:false});}
}
