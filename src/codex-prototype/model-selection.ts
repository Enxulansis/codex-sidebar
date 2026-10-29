import type {Transport} from './rpc';
import type {ModelListResponse} from './protocol/v2/ModelListResponse';
import type {DisplayStateStorage} from './display-settings';
export const FAST_SERVICE_TIER='priority',STANDARD_SERVICE_TIER='default';
export type ServiceTierChoice=typeof FAST_SERVICE_TIER|typeof STANDARD_SERVICE_TIER;
export type ModelChoice={model:string;effort?:string;serviceTier?:ServiceTierChoice};
export type DisplayModel={id:string;model:string;displayName:string;description:string;availabilityMessage?:string;isDefault:boolean;inputModalities:string[];efforts:{value:string;description:string}[];defaultEffort:string;serviceTiers:{id:string;name:string;description:string}[];defaultServiceTier:string|null};
export type ModelCatalogState={models:DisplayModel[];loading:boolean;complete:boolean;stale:boolean;error:string;generation:number};
export type ModelSelectionView=ModelCatalogState&{nextChoice?:ModelChoice|undefined;defaultChoice?:ModelChoice|undefined;observed?:{model:string;effort:string|null;serviceTier?:string|null}|undefined;submitted?:{threadId:string;turnId?:string;choice:ModelChoice;outcome:'accepted'|'rejected'|'unknown'}|undefined;selectionError:string;saving:boolean;canSelect:boolean;canDefault:boolean};
const text=(value:unknown,max=256):value is string=>typeof value==='string'&&!!value.trim()&&value===value.trim()&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
export const validModelChoice=(value:any):value is ModelChoice=>!!value&&text(value.model)&&(value.effort===undefined||text(value.effort,64))&&(value.serviceTier===undefined||value.serviceTier===FAST_SERVICE_TIER||value.serviceTier===STANDARD_SERVICE_TIER)&&Object.keys(value).every(key=>['model','effort','serviceTier'].includes(key));
function modelOf(value:any):DisplayModel{
 if(!value||!text(value.id)||!text(value.model)||!text(value.displayName,512)||typeof value.description!=='string'||value.description.length>16000||typeof value.hidden!=='boolean'||typeof value.isDefault!=='boolean'||!Array.isArray(value.inputModalities)||!value.inputModalities.length||value.inputModalities.length>8||!value.inputModalities.every((v:unknown)=>text(v,64))||new Set(value.inputModalities).size!==value.inputModalities.length||!Array.isArray(value.supportedReasoningEfforts)||value.supportedReasoningEfforts.length>32||!text(value.defaultReasoningEffort,64))throw Error('模型目录字段不完整或超过边界');
 const efforts=value.supportedReasoningEfforts.map((e:any)=>{if(!e||!text(e.reasoningEffort,64)||typeof e.description!=='string'||e.description.length>16000)throw Error('模型思考强度字段无法核对');return{value:e.reasoningEffort,description:e.description};});
 if(new Set(efforts.map((e:{value:string})=>e.value)).size!==efforts.length||efforts.length&&!efforts.some((e:{value:string})=>e.value===value.defaultReasoningEffort))throw Error('模型默认思考强度与目录不一致');
 if(value.availabilityNux!==undefined&&value.availabilityNux!==null&&(typeof value.availabilityNux.message!=='string'||value.availabilityNux.message.length>16000))throw Error('模型可用性提示无法核对');
 if(!Array.isArray(value.serviceTiers)||value.serviceTiers.length>16)throw Error('模型速度目录不完整或超过边界');
 const serviceTiers=value.serviceTiers.map((tier:any)=>{if(!tier||!text(tier.id,64)||!text(tier.name,512)||typeof tier.description!=='string'||tier.description.length>16000)throw Error('模型速度档位无法核对');return{id:tier.id,name:tier.name,description:tier.description};});
 if(new Set(serviceTiers.map((tier:{id:string})=>tier.id)).size!==serviceTiers.length||!(value.defaultServiceTier===null||text(value.defaultServiceTier,64)&&(value.defaultServiceTier===STANDARD_SERVICE_TIER||serviceTiers.some((tier:{id:string})=>tier.id===value.defaultServiceTier))))throw Error('模型默认速度与目录不一致');
 return{id:value.id,model:value.model,displayName:value.displayName,description:value.description,...(value.availabilityNux?.message?{availabilityMessage:value.availabilityNux.message}:{}),isDefault:value.isDefault,inputModalities:[...value.inputModalities],efforts,defaultEffort:value.defaultReasoningEffort,serviceTiers,defaultServiceTier:value.defaultServiceTier};
}
/** Public read-only catalog. Partial, stale or conflicting pages never authorize a selection. */
export class ModelCatalog{
 private value:ModelCatalogState={models:[],loading:false,complete:false,stale:false,error:'模型目录尚未读取',generation:0};private intent=0;
 constructor(private rpc:Pick<Transport,'request'>){}
 snapshot():ModelCatalogState{return structuredClone(this.value);}
 invalidate(reason:string){this.intent++;this.value={...this.value,loading:false,complete:false,stale:!!this.value.models.length,error:reason,generation:this.intent};}
 async refresh(current:()=>boolean=()=>true):Promise<void>{
  const intent=++this.intent,live=()=>intent===this.intent&&current(),models:DisplayModel[]=[],seen=new Set<string>(),ids=new Set<string>(),names=new Set<string>();let cursor:string|null=null;
  this.value={...this.value,loading:true,complete:false,stale:!!this.value.models.length,error:'',generation:intent};
  try{for(let page=0;page<8;page++){
   if(!live())throw Error('模型目录读取身份已失效');const reply:ModelListResponse=await this.rpc.request('model/list',{includeHidden:false,limit:100,...(cursor?{cursor}:{})});if(!live())throw Error('模型目录回执身份已失效');
   if(!reply||!Array.isArray(reply.data)||reply.data.length>100||!(reply.nextCursor===null||text(reply.nextCursor,4096)))throw Error('模型目录分页回执不完整');
   for(const value of reply.data){const model=modelOf(value);if(ids.has(model.id)||names.has(model.model))throw Error('模型目录有重复或歧义标识');ids.add(model.id);names.add(model.model);if(!value.hidden)models.push(model);}
   if(reply.nextCursor===null){this.value={models,loading:false,complete:true,stale:false,error:'',generation:intent};return;}
   if(!reply.data.length||seen.has(reply.nextCursor))throw Error('模型目录分页没有进展');seen.add(reply.nextCursor);cursor=reply.nextCursor;
  }throw Error('模型目录超过8页核对边界，尚未取得完整目录');}
  catch(error){if(intent===this.intent)this.value={...this.value,loading:false,complete:false,stale:!!this.value.models.length,error:error instanceof Error?error.message:'模型目录读取失败'};throw error;}
 }
 require(choice:ModelChoice):DisplayModel{
  if(!this.value.complete||this.value.loading||this.value.stale)throw Error('模型目录未完整核对；请手动刷新后再选择或发送覆盖');if(!validModelChoice(choice))throw Error('模型选择无效');
  const model=this.value.models.find(m=>m.model===choice.model);if(!model)throw Error('已保存模型不在当前可用目录；原选择保留，请主动重选');if(choice.effort!==undefined&&!(model.efforts.length?model.efforts.some(e=>e.value===choice.effort):choice.effort===model.defaultEffort))throw Error('已保存思考强度不受当前模型支持；请主动重选');if(choice.serviceTier===FAST_SERVICE_TIER&&!model.serviceTiers.some(tier=>tier.id===FAST_SERVICE_TIER))throw Error('当前模型未提供 Fast；原选择保留，请选择标准速度或刷新目录');return structuredClone(model);
 }
 defaultImage():DisplayModel{const models=this.value.models;const selected=models.find(m=>m.isDefault&&m.inputModalities.includes('image'))??models.find(m=>m.inputModalities.includes('image'));if(!selected)throw Error('当前 Codex 模型目录没有可用于五项验收的图片模型；停止');return this.require({model:selected.model});}
}
export const MODEL_SELECTION_KEY='codexPrototype.modelSelections.v1';
export const DAILY_MODEL_SELECTION_KEY='codexPrototype.dailyModelSelections.v1';
type Data={version:1;threads:{id:string;choice:ModelChoice}[];default?:ModelChoice};
const validData=(raw:any):raw is Data=>raw?.version===1&&Array.isArray(raw.threads)&&raw.threads.length<=128&&new Set(raw.threads.map((v:any)=>v?.id)).size===raw.threads.length&&raw.threads.every((v:any)=>v&&text(v.id)&&validModelChoice(v.choice))&&(raw.default===undefined||validModelChoice(raw.default));
/** Workspace-local desired settings only; no global config or invented server selection events. */
export class ModelSelections{
 private data:Data={version:1,threads:[]};private original:unknown;private writing:Data|undefined;private blocked='';private tail:Promise<unknown>=Promise.resolve();private forgotten=new Set<string>();private pendingWrites=0;revision=0;
 constructor(private storage:DisplayStateStorage,private key=MODEL_SELECTION_KEY){const raw=storage.get<unknown>(this.key,undefined);this.original=structuredClone(raw);if(raw===undefined)return;if(!validData(raw)){this.blocked='模型选择记录无法读取；原数据保留，未覆盖';return;}this.data=structuredClone(raw);}
 private assert(){if(this.blocked)throw Error(this.blocked);const actual=JSON.stringify(this.storage.get(this.key,undefined));if(actual!==JSON.stringify(this.original)&&(!this.writing||actual!==JSON.stringify(this.writing))){this.blocked='模型选择记录已变化；请窗口 Reload 后核对，未覆盖';throw Error(this.blocked);}}
 read(thread:string):ModelChoice|undefined{this.assert();return structuredClone(this.data.threads.find(v=>v.id===thread)?.choice);}
 default():ModelChoice|undefined{this.assert();return structuredClone(this.data.default);}
 get saving(){return this.pendingWrites>0;}
 error(){return this.blocked;}
 private change(fn:(data:Data)=>void,current:()=>boolean){this.pendingWrites++;const task=this.tail.then(async()=>{if(this.blocked)throw Error(this.blocked);if(!current())throw Error('模型选择页面或线程已失效');this.assert();const next=structuredClone(this.data);fn(next);if(!validData(next))throw Error('模型选择记录无效或超过128线程；未淘汰已有选择');if(!current())throw Error('模型选择保存前身份已失效');this.writing=structuredClone(next);try{await this.storage.update(this.key,next);if(this.blocked||JSON.stringify(this.storage.get(this.key,undefined))!==JSON.stringify(next))throw Error('model selection acknowledgement mismatch');this.data=next;this.original=structuredClone(next);this.revision++;}catch{this.blocked||='模型选择保存未确认；原选择保留，需窗口 Reload 核对，未自动重试';throw Error(this.blocked);}finally{this.writing=undefined;}});const settled=task.finally(()=>{this.pendingWrites--;});this.tail=settled.catch(()=>{});return settled;}
 set(thread:string,choice:ModelChoice|undefined,current:()=>boolean){return this.change(data=>{if(this.forgotten.has(thread))throw Error('线程模型选择已清理，旧保存失效');if(!text(thread)||choice!==undefined&&!validModelChoice(choice))throw Error('线程或模型选择无效');data.threads=data.threads.filter(v=>v.id!==thread);if(choice)data.threads.push({id:thread,choice:structuredClone(choice)});},current);}
 setDefault(choice:ModelChoice|undefined,current:()=>boolean){return this.change(data=>{if(choice!==undefined&&!validModelChoice(choice))throw Error('默认模型选择无效');if(choice)data.default=structuredClone(choice);else delete data.default;},current);}
 forget(thread:string){this.forgotten.add(thread);return this.change(data=>{data.threads=data.threads.filter(v=>v.id!==thread);},()=>true);}
}
