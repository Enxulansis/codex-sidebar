import type {DisplayStateStorage} from './display-settings';
import {viewKeyThread} from './thread-view-key';
const KEY='codexPrototype.blockFolds.v1',MAX_BLOCKS=2000;
export interface FoldOwner {threadId:string;connectionId:number;items:Array<{turnId:string;complete?:boolean;item:{type:string;id:string}}>;}
export class BlockFoldStore {
 private keys:Set<string>;private tail:Promise<unknown>=Promise.resolve();
 private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){const saved=storage.get<unknown>(KEY,[]);this.keys=new Set(Array.isArray(saved)?saved.filter(v=>validKey(v)).slice(-MAX_BLOCKS):[]);}
 read(){return [...this.keys];}
 set(key:unknown,folded:unknown,active:()=>boolean){const run=async()=>{if(!active()||this.forgotten.has(viewKeyThread(key)??'')||!validKey(key)||typeof folded!=='boolean')throw Error('折叠身份失效');const next=new Set(this.keys);next.delete(key as string);if(folded)next.add(key as string);while(next.size>MAX_BLOCKS)next.delete(next.values().next().value!);await this.storage.update(KEY,[...next]);this.keys=next;};const p=this.tail.then(run);this.tail=p.catch(()=>{});return p;}
 forget(thread:string){this.forgotten.add(thread);const task=this.tail.then(async()=>{const next=new Set([...this.keys].filter(key=>viewKeyThread(key)!==thread));await this.storage.update(KEY,[...next]);this.keys=next;});this.tail=task.catch(()=>{});return task;}
}
function validKey(key:unknown):boolean {if(typeof key!=='string'||key.length>500)return false;try{const p=JSON.parse(key);return Array.isArray(p)&&p.length===4&&p.slice(0,3).every(v=>typeof v==='string'&&v.length>0&&v.length<=150)&&Number.isSafeInteger(p[3])&&p[3]>=0&&p[3]<=1000000;}catch{return false;}}
export function foldMatches(m:any,owner:FoldOwner|undefined){if(!owner||!validKey(m.key)||m.threadId!==owner.threadId||m.connectionId!==owner.connectionId)return false;const [thread,turn,item]=JSON.parse(m.key);return thread===owner.threadId&&owner.items.some(v=>v.turnId===turn&&v.item.id===item&&v.item.type==='agentMessage'&&v.complete===true);}
export async function handleBlockFold(store:BlockFoldStore,m:any,post:(m:any)=>unknown,owner:()=>FoldOwner|undefined,active:()=>boolean,remember:()=>boolean=()=>true){
 if(m?.type!=='block-fold-read'&&m?.type!=='block-fold-save')return false;
 if(!active())return true;
 if(m.type==='block-fold-read'){await post({type:'block-folds',keys:store.read()});return true;}
 if(!Number.isSafeInteger(m.id)||m.id<1)return true;
 let ok=false;try{await store.set(m.key,m.folded,()=>active()&&remember()&&foldMatches(m,owner()));ok=active()&&foldMatches(m,owner());}catch{}
 if(active())await post({type:'block-fold-saved',id:m.id,key:m.key,folded:m.folded,ok});return true;
}
