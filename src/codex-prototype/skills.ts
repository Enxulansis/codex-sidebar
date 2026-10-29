import {isAbsolute,relative,resolve,basename} from 'node:path';import {lstat} from 'node:fs/promises';
import type {Transport} from './rpc';import type {SkillsListResponse} from './protocol/v2/SkillsListResponse';import type {UserInput} from './protocol/v2/UserInput';
import {ownedPath,assertWorkspaceFiles} from './storage';import {ATTACHMENT_BYTES} from './attachment-policy';
import {validSkillIdentity,skillPrompt,type SkillIdentity} from './skill-reference';
import {skillDependencies,limitSkillDependencyDisplay,type SkillDependenciesView} from './skill-dependencies';
export type DisplaySkill=SkillIdentity&SkillDependenciesView&{description:string;scope:string;enabled:boolean;unavailable:string};
export type SkillsView={skills:DisplaySkill[];loading:boolean;complete:boolean;stale:boolean;generation:number;error:string};
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const pathKey=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
/** Public declarations only. No SKILL content, icons, dependency commands/URLs or plugin actions are loaded. */
export class SkillCatalog{
 private value:SkillsView={skills:[],loading:false,complete:false,stale:false,generation:0,error:'技能目录尚未读取'};private intent=0;
 constructor(private rpc:Pick<Transport,'request'>,private root:string){}
 snapshot():SkillsView{return structuredClone(this.value);}
 invalidate(reason:string){this.intent++;this.value={...this.value,loading:false,complete:false,stale:!!this.value.skills.length,generation:this.intent,error:reason};}
 private inside(path:string){const rel=relative(resolve(this.root),resolve(path));return !!rel&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\')&&!isAbsolute(rel);}
 private externalReason(path:string){if(this.inside(path))return '';if(/^[\\/]{2}/.test(path))return '远程共享或设备路径不在本侧栏的本地技能范围';return basename(path).toLowerCase()==='skill.md'?'':'后端技能入口不是本地SKILL.md，未猜测加载';}
 async refresh(current:()=>boolean=()=>true){
  const intent=++this.intent,live=()=>intent===this.intent&&current();this.value={...this.value,loading:true,complete:false,stale:!!this.value.skills.length,generation:intent,error:''};
  try{await assertWorkspaceFiles(this.root);if(!live())throw Error('技能目录请求身份已失效');const reply:SkillsListResponse=await this.rpc.request('skills/list',{cwds:[this.root],forceReload:true});if(!live())throw Error('技能目录回执身份已失效');
   if(!reply||!Array.isArray(reply.data)||reply.data.length!==1)throw Error('技能目录工作区条目不完整');const entry=reply.data[0]!;
   if(typeof entry?.cwd!=='string'||pathKey(entry.cwd)!==pathKey(this.root)||!Array.isArray(entry.skills)||entry.skills.length>512||!Array.isArray(entry.errors)||entry.errors.length>512)throw Error('技能目录工作区、数量或错误字段无法核对');
   const paths=new Set<string>(),skills:DisplaySkill[]=entry.skills.map(raw=>{const ref={name:raw?.name,path:raw?.path};if(!validSkillIdentity(ref)||!isAbsolute(ref.path)||typeof raw.enabled!=='boolean'||!['user','repo','system','admin'].includes(raw.scope)||!text(raw.description,16000))throw Error('技能目录元数据无法核对');const key=pathKey(ref.path);if(paths.has(key))throw Error('技能目录存在重复来源，未猜测选择');paths.add(key);return{...ref,description:raw.description,scope:raw.scope,enabled:raw.enabled,unavailable:!raw.enabled?'此技能已被Codex禁用':this.externalReason(ref.path),...skillDependencies(raw)};});
   limitSkillDependencyDisplay(skills);
   const errors=entry.errors.map(raw=>{if(!text(raw?.path,4096)||!text(raw?.message,16000))throw Error('技能目录错误记录无法核对');return raw.message;});
   this.value={skills,loading:false,complete:!errors.length,stale:false,generation:intent,error:errors.length?'技能目录含读取错误，尚不完整：'+errors.join('；').slice(0,2000):''};
   if(errors.length)throw Error(this.value.error);
  }catch(error){if(intent===this.intent)this.value={...this.value,loading:false,complete:false,stale:!!this.value.skills.length,error:error instanceof Error?error.message:'技能目录读取失败'};throw error;}
 }
 require(ref:SkillIdentity){if(!validSkillIdentity(ref))throw Error('技能引用无效');if(!this.value.complete||this.value.loading||this.value.stale)throw Error('技能目录未完整核对；请主动刷新，原选择保留');const skill=this.value.skills.find(v=>v.name===ref.name&&v.path===ref.path);if(!skill)throw Error('已选技能不在当前目录；原选择保留，请重新选择或移除');if(skill.unavailable||!skill.enabled)throw Error(skill.unavailable||'技能未启用');return structuredClone(skill);}
 async input(ref:SkillIdentity|undefined,text:string,current:()=>boolean):Promise<{text:string;prefix:UserInput[]}>{
  if(ref===undefined)return{text,prefix:[]};const generation=this.value.generation;this.require(ref);const body=skillPrompt(text,ref);if(!current())throw Error('技能发送身份已失效');await assertWorkspaceFiles(this.root);
  if(this.inside(ref.path)){const path=await ownedPath(this.root,ref.path),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||!info.size||info.size>ATTACHMENT_BYTES)throw Error('技能来源不是受控工作区内的有效文件，或超过5MiB边界');}
  // External entries are exact, explicit references from Codex's current catalog.
  // The sidebar neither opens nor stats them. Codex owns native loading and errors;
  // this does not grant the host a new filesystem lease or enable dependency tools.
  if(!current()||generation!==this.value.generation)throw Error('技能目录或发送身份已变化，未提交');this.require(ref);return{text:body,prefix:[{type:'skill',name:ref.name,path:ref.path}]};
 }
}
