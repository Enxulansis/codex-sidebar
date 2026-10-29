/** Desired explicit reference, not permission to read a path or proof of execution. */
export type SkillIdentity={name:string;path:string};
/** Local selection token protects a later re-selection from an older send receipt. */
export type SkillReference=SkillIdentity&{token:string};
export const validSkillIdentity=(value:any):value is SkillIdentity=>!!value&&typeof value.name==='string'&&!!value.name.trim()&&value.name===value.name.trim()&&value.name.length<=256&&!/[\x00-\x1f\x7f]/.test(value.name)&&typeof value.path==='string'&&value.path.length>0&&value.path.length<=4096&&!/[\x00-\x1f\x7f]/.test(value.path)&&/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(value.path);
export const validSkillReference=(value:any):value is SkillReference=>validSkillIdentity(value)&&'token' in value&&typeof value.token==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.token)&&Object.keys(value).every(key=>['name','path','token'].includes(key));
export const sameSkill=(a:SkillReference|undefined,b:SkillReference|undefined)=>a?.name===b?.name&&a?.path===b?.path&&a?.token===b?.token;
export function skillPrompt(text:string,skill:SkillIdentity):string{const value=text.trimStart(),prefix='/'+skill.name;if(!validSkillIdentity(skill)||!value.startsWith(prefix)||value.length>prefix.length&&!/\s/.test(value[prefix.length]!))throw Error('技能引用与草稿前缀不一致，请重新选择或移除技能');return value.slice(prefix.length).trimStart();}
export function matchesSkillPrompt(text:string,skill:SkillIdentity){try{skillPrompt(text,skill);return true;}catch{return false;}}
