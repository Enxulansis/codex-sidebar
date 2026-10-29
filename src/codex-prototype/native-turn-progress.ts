import type {Turn} from './protocol/v2/Turn';import type {Notification} from './rpc';
import {parsePublicDiff,publicDiffOptions,PUBLIC_DIFF_CHARACTERS,type ParsedPublicDiff,type PublicDiffOption} from './public-diff';
export type PublicPlan={explanation:string|null;steps:{step:string;status:'pending'|'inProgress'|'completed'}[]};
export type NativeTurnView={turnId:string;status:Turn['status'];plan?:PublicPlan;planError?:string;diff?:{revision:number;characters:number;stats:ParsedPublicDiff['stats'];options:PublicDiffOption[];hunkCount:number;error?:string}};
const PLAN_STEPS=200,PLAN_CHARACTERS=50_000;
// Projection keeps chronological order, including older pages prepended before live turns.
const latest=(turns:ReadonlyMap<string,Turn>)=>{let last:Turn|undefined;for(const turn of turns.values())last=turn;return last;};
/** Only live public metadata for the current/most recent turn; never inferred from history text. */
export class NativeTurnProgress{
 private revision=0;private value:{turnId:string;plan?:PublicPlan;planError?:string;diff?:string;parsed?:ParsedPublicDiff;diffRevision?:number;diffError?:string}|undefined;
 clear(){this.value=undefined;this.revision++;}
 apply(n:Notification,threadId:string,turns:ReadonlyMap<string,Turn>){
  if(n.method!=='turn/started'&&n.method!=='turn/plan/updated'&&n.method!=='turn/diff/updated')return;
  if(n.params.threadId!==threadId)return;const current=latest(turns);if(!current)return;
  const turnId=n.method==='turn/started'?n.params.turn.id:n.params.turnId;if(turnId!==current.id)return;
  if(this.value?.turnId!==turnId){this.clear();this.value={turnId};}const value=this.value;
  if(n.method==='turn/plan/updated'){
   const {explanation,plan}=n.params;
   if(explanation!==null&&typeof explanation!=='string'||!Array.isArray(plan)||plan.length>PLAN_STEPS||plan.some(s=>!s||typeof s.step!=='string'||!['pending','inProgress','completed'].includes(s.status))||(explanation?.length??0)+plan.reduce((count,s)=>count+s.step.length,0)>PLAN_CHARACTERS){value.planError='公开计划字段无效或超过显示上限；上次快照保留';return;}
   value.plan={explanation,steps:plan.map(s=>({step:s.step,status:s.status}))};delete value.planError;
  }
  if(n.method==='turn/diff/updated'){
   const {diff}=n.params;if(typeof diff!=='string'||diff.length>PUBLIC_DIFF_CHARACTERS){delete value.diff;delete value.parsed;value.diffRevision=++this.revision;value.diffError='本次公开差异无效或超过200万字符，未提供不完整对比';return;}
   if(value.diff===diff&&!value.diffError)return;value.diff=diff;value.parsed=parsePublicDiff(diff);value.diffRevision=++this.revision;delete value.diffError;
  }
 }
 snapshot(turns:ReadonlyMap<string,Turn>):NativeTurnView|undefined{
  const v=this.value;if(!v||!v.plan&&!v.planError&&v.diff===undefined&&!v.diffError)return;const turn=latest(turns);if(!turn||turn.id!==v.turnId)return;
  return{turnId:v.turnId,status:turn.status,...(v.plan?{plan:structuredClone(v.plan)}:{}),...(v.planError?{planError:v.planError}:{}),...(v.diffRevision!==undefined?{diff:{revision:v.diffRevision,characters:v.diff?.length??0,stats:v.parsed?.stats??null,options:v.parsed?publicDiffOptions(v.parsed):[],hunkCount:v.parsed?.hunkCount??0,...(v.diffError?{error:v.diffError}:{})}}:{})};
 }
 readDiff(turns:ReadonlyMap<string,Turn>,turnId:string,revision:number){const v=this.value;if(!v||latest(turns)?.id!==turnId||v.turnId!==turnId||v.diffRevision!==revision||v.diff===undefined||v.diffError)throw Error('公开差异已更新或来源失效，请重新打开');return{diff:v.diff,parsed:v.parsed!};}
}
