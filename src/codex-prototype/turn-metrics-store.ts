import type {DisplayStateStorage} from './display-settings';
import type {ThreadTokenUsage} from './protocol/v2/ThreadTokenUsage';
import type {TokenUsageBreakdown} from './protocol/v2/TokenUsageBreakdown';
import {validUsage,USAGE_COUNTERS} from './page-usage';

export type StoredTurnMetrics={wallStart?:number;wallEnd?:number;elapsed?:number;firstVisible?:number;baseline?:TokenUsageBreakdown;usage?:ThreadTokenUsage;incomplete:boolean;orderUnknown:boolean;terminal:boolean};
export interface TurnMetricsPersistence{read(thread:string):[string,StoredTurnMetrics][];save(thread:string,turn:string,value:StoredTurnMetrics):Promise<void>;flush():Promise<void>}
export const TURN_METRICS_KEY='codexPrototype.turnMetrics.v1',TURN_METRICS_THREAD_CAP=128,TURN_METRICS_TURN_CAP=512;
const identity=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=256;
const fields=['wallStart','wallEnd','elapsed','firstVisible','baseline','usage','incomplete','orderUnknown','terminal'];
function valid(value:any):value is StoredTurnMetrics{
 if(!value||Array.isArray(value)||Object.keys(value).some(k=>!fields.includes(k))||['incomplete','orderUnknown','terminal'].some(k=>typeof value[k]!=='boolean'))return false;
 if(['wallStart','wallEnd','elapsed','firstVisible'].some(k=>value[k]!==undefined&&(!Number.isFinite(value[k])||value[k]<0||value[k]>8.64e15)))return false;
 if(value.usage!==undefined&&!validUsage(value.usage))return false;
 const b=value.baseline;return b===undefined||!!b&&!Array.isArray(b)&&Object.keys(b).length===USAGE_COUNTERS.length&&USAGE_COUNTERS.every(k=>Number.isSafeInteger(b[k])&&b[k]>=0);
}
function copy(value:StoredTurnMetrics):StoredTurnMetrics{return{...value,...(value.usage?{usage:validUsage(value.usage)!}:{}),...(value.baseline?{baseline:Object.fromEntries(USAGE_COUNTERS.map(k=>[k,value.baseline![k]])) as TokenUsageBreakdown}:{})};}
/** Workspace-scoped public timing/counter evidence only; never bodies, monotonic clocks or permissions. */
export class TurnMetricsStore implements TurnMetricsPersistence{
 private records=new Map<string,Map<string,StoredTurnMetrics>>();private corrupt=false;private tail:Promise<void>=Promise.resolve();private queued:Promise<void>|undefined;private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){
  const raw=storage.get<any>(TURN_METRICS_KEY,undefined);if(raw===undefined)return;
  if(!Array.isArray(raw)||raw.length>TURN_METRICS_THREAD_CAP||new Set(raw.map(v=>v?.[0])).size!==raw.length||raw.some(v=>!Array.isArray(v)||v.length!==2||!identity(v[0])||!Array.isArray(v[1])||v[1].length>TURN_METRICS_TURN_CAP||new Set(v[1].map((r:any)=>r?.[0])).size!==v[1].length||v[1].some((r:any)=>!Array.isArray(r)||r.length!==2||!identity(r[0])||!valid(r[1])))){this.corrupt=true;return;}
  this.records=new Map(raw.map(([id,turns]:[string,[string,StoredTurnMetrics][]])=>[id,new Map(turns.map(([turn,value])=>[turn,copy(value)]))]));
 }
 private readable(thread:string){if(this.corrupt)throw Error('用时统计存储无法读取；未覆盖原数据');if(!identity(thread)||this.forgotten.has(thread))throw Error('用时统计会话无效或已删除');}
 read(thread:string){this.readable(thread);return structuredClone([...(this.records.get(thread)??[])]);}
 save(thread:string,turn:string,value:StoredTurnMetrics):Promise<void>{
  try{this.readable(thread);if(!identity(turn)||!valid(value))throw Error('用时统计格式无效');}catch(error){return Promise.reject(error);}
  // Keep observed evidence available during an in-flight write or a fast thread switch.
  const turns=this.records.get(thread)??new Map<string,StoredTurnMetrics>();turns.delete(turn);turns.set(turn,copy(value));while(turns.size>TURN_METRICS_TURN_CAP)turns.delete(turns.keys().next().value!);
  this.records.delete(thread);this.records.set(thread,turns);while(this.records.size>TURN_METRICS_THREAD_CAP)this.records.delete(this.records.keys().next().value!);
  return this.write();
 }
 private write(){
  if(this.queued)return this.queued;
  // Only unstarted writes share a snapshot. Once storage starts, later evidence
  // queues a new immutable snapshot; every caller still receives its write error.
  const task=this.tail.catch(()=>{}).then(async()=>{this.queued=undefined;const snapshot=structuredClone([...this.records].map(([id,turns])=>[id,[...turns]]));await this.storage.update(TURN_METRICS_KEY,snapshot);});this.queued=task;this.tail=task;return task;
 }
 flush(){return this.tail;}
 forget(thread:string){try{this.readable(thread);}catch(error){return Promise.reject(error);}this.forgotten.add(thread);this.records.delete(thread);return this.write();}
}
