import type {PageTokenUsage,UsageCounters} from './page-model';
export const USAGE_COUNTERS=['totalTokens','inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens'] as const;
export function validUsage(value:unknown):PageTokenUsage|undefined{
 const v=value as PageTokenUsage|undefined;
 const breakdown=(b:UsageCounters|undefined)=>!!b&&USAGE_COUNTERS.every(k=>Number.isSafeInteger(b[k])&&b[k]>=0);
 if(!v||!breakdown(v.total)||!breakdown(v.last)||(v.modelContextWindow!==null&&(!Number.isSafeInteger(v.modelContextWindow)||v.modelContextWindow<=0)))return;
 const copy=(b:UsageCounters)=>Object.fromEntries(USAGE_COUNTERS.map(k=>[k,b[k]])) as UsageCounters;
 return{total:copy(v.total),last:copy(v.last),modelContextWindow:v.modelContextWindow};
}
