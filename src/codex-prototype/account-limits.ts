/** Public account quota snapshots, separate from per-thread tokens and billing. */
export type AccountLimitWindow={usedPercent:number;windowDurationMins:number|null;resetsAt:number|null};
export type AccountLimitBucket={id:string;name:string;primary:AccountLimitWindow|null;secondary:AccountLimitWindow|null};
export type AccountLimitsSnapshot={readAt:number;ordinaryUsageAllowed:boolean|null;buckets:AccountLimitBucket[]};
export type AccountLimitsView={revision:number;pending:boolean;error:string;snapshot?:AccountLimitsSnapshot};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const label=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value)?value:undefined;
function window(value:unknown):AccountLimitWindow|null{
 if(value===null||value===undefined)return null;
 if(!object(value)||typeof value.usedPercent!=='number'||!Number.isFinite(value.usedPercent)||value.usedPercent<0)throw Error('额度百分比无法核对');
 const optional=(v:unknown,minimum:number)=>v===null||v===undefined?null:Number.isSafeInteger(v)&&Number(v)>=minimum?Number(v):undefined;
 const duration=optional(value.windowDurationMins,1),reset=optional(value.resetsAt,0);
 if(duration===undefined||reset===undefined||(reset!==null&&reset>8640000000000))throw Error('额度窗口或重置时间无法核对');
 return{usedPercent:value.usedPercent,windowDurationMins:duration,resetsAt:reset};
}
/** Copy only display fields. Never forward account IDs, credits, banners or reset actions. */
export function accountLimitsSnapshot(value:unknown,readAt:number):AccountLimitsSnapshot{
 if(!object(value)||!Number.isSafeInteger(readAt)||readAt<=0||readAt>8640000000000000)throw Error('账户额度响应无法核对');
 const multiple=value.rateLimitsByLimitId;
 if(multiple!=null&&!object(multiple))throw Error('账户额度目录无法核对');
 const entries=multiple&&Object.keys(multiple).length?Object.entries(multiple):[['',value.rateLimits]];
 const buckets=entries.map(([key,row])=>{
  if(!object(row))throw Error('账户额度窗口无法核对');
  const id=label(key)||label(row.limitId)||'account',name=label(row.limitName)||label(key)||label(row.limitId)||'账户';
  return{id,name,primary:window(row.primary),secondary:window(row.secondary)};
 });
 const ordinary=value.ordinaryUsageAllowed;
 if(ordinary!=null&&typeof ordinary!=='boolean')throw Error('账户额度允许状态无法核对');
 return{readAt,ordinaryUsageAllowed:typeof ordinary==='boolean'?ordinary:null,buckets};
}
export function validAccountLimitsSnapshot(value:unknown):value is AccountLimitsSnapshot{
 if(!object(value)||!Array.isArray(value.buckets)||!Number.isSafeInteger(value.readAt)||Number(value.readAt)<=0||Number(value.readAt)>8640000000000000||(value.ordinaryUsageAllowed!==null&&typeof value.ordinaryUsageAllowed!=='boolean'))return false;
 try{return value.buckets.every(row=>object(row)&&!!label(row.id)&&!!label(row.name)&&[row.primary,row.secondary].every(v=>v===null||v!==undefined&&!!window(v)));}catch{return false;}
}
