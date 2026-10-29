import type {PageHost} from '../page-host';
import {validAccountLimitsSnapshot,type AccountLimitsSnapshot,type AccountLimitWindow,type AccountLimitsView} from '../account-limits';
export type AccountLimitsContext={threadId:string;connectionId:number;enabled:boolean;available:boolean;accountLimits?:AccountLimitsView|undefined};
const duration=(minutes:number|null)=>minutes===null?'时段未提供':minutes%1440===0?`${minutes/1440}天`:minutes%60===0?`${minutes/60}小时`:`${minutes}分钟`;
const stamp=(milliseconds:number)=>new Date(milliseconds).toLocaleString(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
/** Lives inside the existing usage popup. Its replies cannot reopen a closed popup. */
export class AccountLimitsControl{
 readonly element=document.createElement('section');private heading=document.createElement('div');private refresh=document.createElement('button');private status=document.createElement('div');private rows=document.createElement('div');
 private context:AccountLimitsContext|undefined;private owner='';private sequence=0;private pending:{id:number;owner:string;timer:ReturnType<typeof setTimeout>}|undefined;
 private snapshot:AccountLimitsSnapshot|undefined;private error='';private signature='';private dead=false;
 private revision=-1;private refreshing=false;
 constructor(private host:PageHost,private changed:()=>void){
  this.element.className='usage-account';this.element.hidden=true;this.heading.className='usage-header';const title=document.createElement('b');title.textContent='账户额度';this.refresh.type='button';this.refresh.id='account-limits-refresh';this.refresh.onclick=()=>this.read();this.heading.append(title,this.refresh);this.status.className='usage-account-status';this.status.setAttribute('role','status');this.rows.className='usage-account-rows';this.element.append(this.heading,this.status,this.rows);host.messages.addEventListener('message',this.message);
 }
 update(context:AccountLimitsContext|undefined){
  if(this.dead)return;const owner=context?JSON.stringify([context.threadId,context.connectionId]):'';
  if(context?.connectionId!==this.context?.connectionId||context?.available!==this.context?.available){this.snapshot=undefined;this.error='';this.revision=-1;this.refreshing=false;}
  if(owner!==this.owner){this.owner=owner;clearTimeout(this.pending?.timer);this.pending=undefined;}
  else if(!context?.enabled&&this.pending){clearTimeout(this.pending.timer);this.pending=undefined;this.error='连接已断开，本次读取未确认';}
  this.context=context;if(context?.accountLimits)this.accept(context.accountLimits);this.paint();
 }
 private accept(value:AccountLimitsView){
  if(!value||!Number.isSafeInteger(value.revision)||value.revision<this.revision||typeof value.pending!=='boolean'||typeof value.error!=='string'||value.snapshot!==undefined&&!validAccountLimitsSnapshot(value.snapshot))return false;
  this.revision=value.revision;this.snapshot=value.snapshot;this.error=value.error.slice(0,500);this.refreshing=value.pending;
  if(!value.pending){clearTimeout(this.pending?.timer);this.pending=undefined;}return true;
 }
 read(){
  const context=this.context;if(this.dead||!context?.available||!context.enabled||this.pending)return;
  const id=++this.sequence,owner=this.owner,timer=setTimeout(()=>{if(this.pending?.id!==id||this.owner!==owner)return;this.pending=undefined;this.error='读取超时；可手动刷新';this.paint();this.changed();},20000);
  this.pending={id,owner,timer};this.error='';this.paint();this.changed();
  this.host.postMessage({type:'account-limits-read',id,threadId:context.threadId,connectionId:context.connectionId});
 }
 private message=(event:MessageEvent)=>{
  const m=event.data,p=this.pending,c=this.context;
  if(!this.dead&&m?.type==='account-limits-state'&&c?.available&&m.connectionId===c.connectionId&&this.accept(m.accountLimits)){this.paint();this.changed();return;}
  if(this.dead||!p||m?.type!=='account-limits-result'||m.id!==p.id||p.owner!==this.owner||!c||m.threadId!==c.threadId||m.connectionId!==c.connectionId)return;
  clearTimeout(p.timer);this.pending=undefined;
  if(!this.accept(m.accountLimits))this.error=typeof m.error==='string'?m.error.slice(0,500):'账户额度响应无法核对';
  this.paint();this.changed();
 };
 private paint(){
  const c=this.context,reading=!!this.pending||this.refreshing,signature=JSON.stringify([c,this.snapshot,this.error,this.pending?.id,reading]);if(signature===this.signature)return;this.signature=signature;
  this.element.hidden=!c?.available;this.refresh.disabled=!c?.enabled||reading;this.refresh.textContent=reading?(this.snapshot?'更新中…':'读取中…'):this.snapshot?'刷新':'读取账户额度';this.refresh.setAttribute('aria-busy',String(reading));
  const snapshot=this.snapshot;this.rows.replaceChildren();
  const notes=[reading&&!this.snapshot?'正在读取账户额度…':this.error?`读取失败：${this.error}`:!c?.enabled?'连接后可读取账户额度':''];
  if(snapshot){
   notes.push(`账户共享 · ${stamp(snapshot.readAt)}`);if(this.error||!c?.enabled)notes.push('显示上次数据');
   if(snapshot.ordinaryUsageAllowed===false)notes.push('普通额度受限');else if(snapshot.ordinaryUsageAllowed===null)notes.push('普通额度状态未知');
   for(const bucket of snapshot.buckets){const group=document.createElement('div'),title=document.createElement('b');title.textContent=bucket.name;group.append(title);let count=0;
    for(const [name,value]of [['主要',bucket.primary],['次要',bucket.secondary]] as [string,AccountLimitWindow|null][]){if(!value)continue;count++;const row=document.createElement('div'),label=document.createElement('span'),amount=document.createElement('strong'),remaining=Math.max(0,100-value.usedPercent);row.className='usage-row';label.textContent=`${name} · ${duration(value.windowDurationMins)}`;amount.className='usage-account-percent';amount.style.setProperty('--quota-hue',String(remaining*1.2));amount.textContent=`剩余 ${remaining.toLocaleString(undefined,{maximumFractionDigits:1})}%`;row.append(label,amount);group.append(row);const reset=document.createElement('div');reset.className='usage-account-reset';reset.textContent=value.resetsAt===null?'重置时间未提供':`重置：${stamp(value.resetsAt*1000)}`;group.append(reset);}
    if(!count){const note=document.createElement('div');note.textContent='未提供额度窗口';group.append(note);}this.rows.append(group);
   }
   if(!snapshot.buckets.length)notes.push('未提供额度窗口');
  }
  this.status.textContent=notes.filter(Boolean).join('\n');this.status.hidden=!this.status.textContent;
 }
 dispose(){this.dead=true;clearTimeout(this.pending?.timer);this.pending=undefined;this.host.messages.removeEventListener('message',this.message);}
}
