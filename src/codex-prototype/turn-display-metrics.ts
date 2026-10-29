import type {Notification} from './rpc';
import type {Turn} from './protocol/v2/Turn';
import type {TokenUsageBreakdown} from './protocol/v2/TokenUsageBreakdown';
import type {ThreadTokenUsage} from './protocol/v2/ThreadTokenUsage';

import type {TailMeta} from './page-model';
import {validUsage,USAGE_COUNTERS as COUNTERS} from './page-usage';
import type {StoredTurnMetrics,TurnMetricsPersistence} from './turn-metrics-store';
const milliseconds=(seconds:number|null|undefined)=>typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>=0&&seconds*1000<=8.64e15?seconds*1000:undefined;
export const publicTurnTimeMs=(turn:Pick<Turn,'startedAt'|'completedAt'>,assistant:boolean)=>milliseconds(assistant?turn.completedAt??turn.startedAt:turn.startedAt);
const duration=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:undefined;
type Observed=StoredTurnMetrics&{monoStart?:number};
/** Public counters and receipt times only. No text retention, tokenization or RPC. */
export class TurnDisplayMetrics{
 private turns=new Map<string,Observed>();private latest:{turnId:string;total:TokenUsageBreakdown}|undefined;private activeId:string|undefined;
 private thread='';
 private fresh=false;private pendingUsage=new Map<string,{usage:ThreadTokenUsage;uncertain:boolean}>();
 constructor(private wall=()=>Date.now(),private monotonic=()=>performance.now(),private persistence?:TurnMetricsPersistence,private onError:(error:unknown)=>void=()=>{}){}
 clear(thread=''){
  if(thread&&thread===this.thread)return;this.thread=thread;this.turns.clear();this.latest=undefined;this.activeId=undefined;this.fresh=false;this.pendingUsage.clear();
  if(thread&&this.persistence)try{for(const[id,record]of this.persistence.read(thread)){if(!record.terminal){record.incomplete=true;delete record.baseline;}this.turns.set(id,record);}}catch(error){this.onError(error);}
 }
 private save(id:string){const value=this.turns.get(id);if(!value||!this.thread||!this.persistence)return;const{monoStart,...record}=value;void this.persistence.save(this.thread,id,record).catch(error=>this.onError(error));}
 flush(){return this.persistence?.flush()??Promise.resolve();}
 /** Only an acknowledged newly created, empty thread can have a known zero output origin. */
 primeNewThread(){this.fresh=true;}
 reconcile(turns:ReadonlyMap<string,Turn>){
  for(const[id,pending]of this.pendingUsage){if(!turns.has(id))continue;this.pendingUsage.delete(id);this.observe({method:'thread/tokenUsage/updated',params:{threadId:this.thread,turnId:id,tokenUsage:pending.usage}},turns);if(pending.uncertain){const record=this.turns.get(id);if(record){record.orderUnknown=true;delete record.baseline;this.save(id);}if(this.latest?.turnId===id)this.latest=undefined;}}
  // An older live receipt cannot stand in for a later public history turn.
  if(this.latest&&[...turns.keys()].at(-1)!==this.latest.turnId)this.latest=undefined;
 }
 disconnect(){this.fresh=false;this.latest=undefined;this.pendingUsage.clear();for(const[id,v]of this.turns)if(!v.terminal){v.incomplete=true;delete v.baseline;delete v.monoStart;this.save(id);}}
 observe(n:Notification,turns:ReadonlyMap<string,Turn>){
  const p=n.params as any,id=p.turnId??p.turn?.id,turn=turns.get(id);if(!turn){if(n.method==='thread/tokenUsage/updated'&&typeof id==='string'&&id.length>0&&id.length<=256){const usage=validUsage(p.tokenUsage);if(usage){const old=this.pendingUsage.get(id),decreasing=old&&COUNTERS.some(k=>usage.total[k]<old.usage.total[k]);this.pendingUsage.set(id,{usage:decreasing?old.usage:usage,uncertain:!!old?.uncertain||!!decreasing});while(this.pendingUsage.size>512)this.pendingUsage.delete(this.pendingUsage.keys().next().value!);}}return;}
  let v=this.turns.get(id);
  if(n.method==='turn/started'){
   if(turn.status!=='inProgress'||v?.monoStart!==undefined||v?.terminal||v?.incomplete)return;
   v={...v,wallStart:this.wall(),monoStart:this.monotonic(),incomplete:v?.incomplete??false,orderUnknown:v?.orderUnknown??false,terminal:false};this.activeId=id;
   if(this.fresh)v.baseline=Object.fromEntries(COUNTERS.map(k=>[k,0])) as TokenUsageBreakdown;
   else if(this.latest&&this.latest.turnId!==id&&turns.get(this.latest.turnId)?.status!=='inProgress')v.baseline={...this.latest.total};this.fresh=false;
   this.turns.set(id,v);this.save(id);return;
  }
  if(n.method==='item/agentMessage/delta'){
   if(turn.status==='inProgress'&&v?.monoStart!==undefined&&v.firstVisible===undefined&&typeof p.delta==='string'&&p.delta.trim()){v.firstVisible=Math.max(0,this.monotonic()-v.monoStart);this.save(id);}
   return;
  }
  if(n.method==='item/completed'&&p.item?.type==='contextCompaction'){
   this.latest=undefined;this.fresh=false;this.pendingUsage.clear();for(const[key,record]of this.turns)if(!record.terminal){delete record.baseline;record.orderUnknown=true;this.save(key);}return;
  }
  if(n.method==='turn/completed'){
   if(!v){v={incomplete:false,orderUnknown:false,terminal:true};this.turns.set(id,v);}
   if(v.wallEnd===undefined){v.wallEnd=this.wall();if(v.monoStart!==undefined)v.elapsed=Math.max(0,this.monotonic()-v.monoStart);}
   v.terminal=true;this.save(id);return;
  }
  if(n.method!=='thread/tokenUsage/updated')return;
  const usage=validUsage(p.tokenUsage);if(!usage)return;
  if(!v){v={incomplete:false,orderUnknown:false,terminal:turn.status!=='inProgress'};this.turns.set(id,v);}
  const old=v.usage?.total;
  if(old&&COUNTERS.some(k=>usage.total[k]<old[k])){v.orderUnknown=true;delete v.baseline;this.save(id);return;}
  if(this.activeId&&this.activeId!==id&&this.latest&&COUNTERS.some(k=>usage.total[k]>this.latest!.total[k])){
   v.orderUnknown=true;delete v.baseline;
   const active=this.turns.get(this.activeId);if(active){active.orderUnknown=true;delete active.baseline;this.save(this.activeId);}this.latest=undefined;this.save(id);return;
  }
  const changed=JSON.stringify(v.usage)!==JSON.stringify(usage);v.usage=usage; // Snapshots replace; repeated notifications never add counters.
  if(changed)this.save(id);
   if(!v.orderUnknown&&(this.activeId===undefined||this.activeId===id)&&(!this.latest||COUNTERS.every(k=>usage.total[k]>=this.latest!.total[k])))this.latest={turnId:id,total:{...usage.total}};
 }
 forTurn(turn:Turn|undefined,assistant:boolean):TailMeta|undefined{
  if(!turn)return;const v=this.turns.get(turn.id),meta:TailMeta={source:'public'};
  const stamp=publicTurnTimeMs(turn,assistant);
  if(stamp!==undefined){meta.timeMs=stamp;meta.timeSource='server-turn';}
  else{const time=assistant?v?.wallEnd??v?.wallStart:v?.wallStart;if(time!==undefined){meta.timeMs=time;meta.timeSource='client-received';}}
  if(!assistant)return meta;
  const known=duration(turn.durationMs),serverStart=milliseconds(turn.startedAt),serverEnd=milliseconds(turn.completedAt);
  const serverDuration=known??(serverStart!==undefined&&serverEnd!==undefined&&serverEnd>=serverStart?serverEnd-serverStart:undefined);
  if(serverDuration!==undefined){meta.durationMs=serverDuration;meta.durationSource='server-turn';}
  else if(v?.elapsed!==undefined){meta.durationMs=v.elapsed;meta.durationSource='client-received';}
  if(v?.firstVisible!==undefined)meta.firstVisibleMs=v.firstVisible;
  if(v?.usage)meta.tokenUsage=validUsage(v.usage)!;
  if(v?.incomplete)meta.incomplete=true;if(v?.orderUnknown)meta.usageOrderUnknown=true;
  if(turn.status!=='inProgress'&&v?.baseline&&v.usage&&!v.incomplete&&!v.orderUnknown&&meta.durationMs!==undefined&&meta.durationMs>0&&COUNTERS.every(k=>v.usage!.total[k]>=v.baseline![k]))meta.averageOutputTokS=(v.usage.total.outputTokens-v.baseline.outputTokens)/(meta.durationMs/1000);
  return meta;
 }
}
