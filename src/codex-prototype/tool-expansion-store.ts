import type {DisplayStateStorage} from './display-settings';import type {FoldOwner} from './block-fold-store';
import {viewKeyThread} from './thread-view-key';
import {isPublicToolKind} from './public-tool-types';
import {isPublicRecordKind} from './public-record-types';
export const TOOL_EXPANSION_KEY='codexPrototype.toolExpansion.v1',TOOL_EXPANSION_CAP=2000;
function validKey(key:unknown):key is string{if(typeof key!=='string'||key.length>800)return false;try{const parts=JSON.parse(key);return Array.isArray(parts)&&parts.length===3&&parts.every(v=>typeof v==='string'&&v.length>0&&v.length<=256);}catch{return false;}}
export class ToolExpansionStore{
 private keys:Set<string>;private tail:Promise<unknown>=Promise.resolve();
 private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){const saved=storage.get<unknown>(TOOL_EXPANSION_KEY,[]);this.keys=new Set(Array.isArray(saved)?saved.filter(validKey).slice(-TOOL_EXPANSION_CAP):[]);}
 read(){return [...this.keys];}
 save(key:unknown,expanded:unknown,active:()=>boolean){const run=async()=>{if(!active()||this.forgotten.has(viewKeyThread(key)??'')||!validKey(key)||typeof expanded!=='boolean')throw Error('工具卡身份或记忆开关已失效');const next=new Set(this.keys);next.delete(key);if(expanded)next.add(key);while(next.size>TOOL_EXPANSION_CAP)next.delete(next.values().next().value!);await this.storage.update(TOOL_EXPANSION_KEY,[...next]);this.keys=next;};const task=this.tail.then(run);this.tail=task.catch(()=>{});return task;}
 forget(thread:string){this.forgotten.add(thread);const task=this.tail.then(async()=>{const next=new Set([...this.keys].filter(key=>viewKeyThread(key)!==thread));await this.storage.update(TOOL_EXPANSION_KEY,[...next]);this.keys=next;});this.tail=task.catch(()=>{});return task;}
}
export function toolExpansionMatches(m:any,owner:FoldOwner|undefined){if(!owner||!validKey(m.key)||m.threadId!==owner.threadId||m.connectionId!==owner.connectionId)return false;const[thread,turn,item]=JSON.parse(m.key);return thread===owner.threadId&&owner.items.some(v=>v.turnId===turn&&v.item.id===item&&(['commandExecution','fileChange'].includes(v.item.type)||isPublicToolKind(v.item.type)||isPublicRecordKind(v.item.type)));}
export async function handleToolExpansion(store:ToolExpansionStore,m:any,post:(m:any)=>unknown,owner:()=>FoldOwner|undefined,active:()=>boolean,remember:()=>boolean){
 if(!['tool-expansion-read','tool-expansion-save'].includes(m?.type))return false;if(!active())return true;
 if(m.type==='tool-expansion-read'){await post({type:'tool-expansions',keys:store.read()});return true;}
 if(!Number.isSafeInteger(m.id)||m.id<1)return true;let ok=false;
 try{await store.save(m.key,m.expanded,()=>active()&&remember()&&toolExpansionMatches(m,owner()));ok=active()&&toolExpansionMatches(m,owner());}catch{}
 if(active())await post({type:'tool-expansion-saved',id:m.id,key:m.key,expanded:m.expanded,ok});return true;
}
