export type SkillDependenciesView={pluginId?:string|null;dependencies?:{type:string;value:string}[];dependencyError?:string};
const text=(v:unknown,max=256):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
/** Declarations only: commands, URLs, transports and descriptions never grant tool access or reach the page. */
export function skillDependencies(raw:any):SkillDependenciesView{
 const result:SkillDependenciesView={};if(raw.pluginId===null||text(raw.pluginId))result.pluginId=raw.pluginId;else if(raw.pluginId!==undefined)result.dependencyError='所属插件字段未核对';
 if(raw.dependencies===undefined)return result;
 if(!raw.dependencies||!Array.isArray(raw.dependencies.tools)||raw.dependencies.tools.length>32||raw.dependencies.tools.some((v:any)=>!v||!text(v.type,64)||!text(v.value))){result.dependencyError='工具依赖声明未完整核对';return result;}
 result.dependencies=raw.dependencies.tools.map((v:any)=>({type:v.type,value:v.value}));return result;
}
export function skillDependencySummary(skill:SkillDependenciesView){return[skill.pluginId?'所属插件：'+skill.pluginId:'',skill.dependencies?.length?'声明工具：'+skill.dependencies.map(v=>v.type+' · '+v.value).join('；'):'',skill.dependencyError||''].filter(Boolean).join('；');}
const DEPENDENCY_DISPLAY_ENTRIES=256,DEPENDENCY_DISPLAY_CHARACTERS=64_000;
/** Whole declarations beyond the per-catalog display budget stay explicitly unverified, never silently empty. */
export function limitSkillDependencyDisplay(skills:SkillDependenciesView[]){
 let entries=0,characters=0;
 for(const skill of skills){const values=skill.dependencies;if(!values)continue;const size=values.reduce((n,value)=>n+value.type.length+value.value.length,0);
  if(entries+values.length>DEPENDENCY_DISPLAY_ENTRIES||characters+size>DEPENDENCY_DISPLAY_CHARACTERS){delete skill.dependencies;skill.dependencyError=[skill.dependencyError,'依赖声明超过本次展示上限，未展开；不代表没有依赖'].filter(Boolean).join('；');}
  else{entries+=values.length;characters+=size;}
 }
}
