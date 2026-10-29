import type {DisplayStateStorage} from './display-settings';import type {FoldOwner} from './block-fold-store';
import {viewKeyThread} from './thread-view-key';
const KEY='codexPrototype.userFolds.v1',MAX_RECORDS=2000;
export type UserFoldState='folded'|'expanded';
function validKey(key:unknown):key is string{if(typeof key!=='string'||key.length>500)return false;try{const p=JSON.parse(key);return Array.isArray(p)&&p.length===3&&p.every(v=>typeof v==='string'&&v.length>0&&v.length<=150);}catch{return false;}}
export class UserFoldStore{
 private records:Map<string,UserFoldState>;private tail:Promise<unknown>=Promise.resolve();
 private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){const saved=storage.get<unknown>(KEY,[]);this.records=new Map(Array.isArray(saved)?saved.filter(v=>Array.isArray(v)&&validKey(v[0])&&['folded','expanded'].includes(v[1])).slice(-MAX_RECORDS):[]);}
 read(){return [...this.records];}
 set(key:unknown,state:unknown,active:()=>boolean){const run=async()=>{if(!active()||this.forgotten.has(viewKeyThread(key)??'')||!validKey(key)||(state!=='folded'&&state!=='expanded'))throw Error('用户消息折叠身份已失效');const next=new Map(this.records);next.delete(key);next.set(key,state);while(next.size>MAX_RECORDS)next.delete(next.keys().next().value!);await this.storage.update(KEY,[...next]);this.records=next;};const p=this.tail.then(run);this.tail=p.catch(()=>{});return p;}
 forget(thread:string){this.forgotten.add(thread);const task=this.tail.then(async()=>{const next=new Map([...this.records].filter(([key])=>viewKeyThread(key)!==thread));await this.storage.update(KEY,[...next]);this.records=next;});this.tail=task.catch(()=>{});return task;}
}
export function userFoldMatches(m:any,owner:FoldOwner|undefined){if(!owner||!validKey(m.key)||m.threadId!==owner.threadId||m.connectionId!==owner.connectionId)return false;const [thread,turn,item]=JSON.parse(m.key);return thread===owner.threadId&&owner.items.some(v=>v.turnId===turn&&v.item.id===item&&v.item.type==='userMessage');}
export async function handleUserFold(store:UserFoldStore,m:any,post:(m:any)=>unknown,owner:()=>FoldOwner|undefined,active:()=>boolean,remember:()=>boolean=()=>true){if(m?.type!=='user-fold-read'&&m?.type!=='user-fold-save')return false;if(!active())return true;if(m.type==='user-fold-read'){await post({type:'user-folds',records:store.read()});return true;}if(!Number.isSafeInteger(m.id)||m.id<1)return true;let ok=false;try{await store.set(m.key,m.state,()=>active()&&remember()&&userFoldMatches(m,owner()));ok=active()&&userFoldMatches(m,owner());}catch{}if(active())await post({type:'user-fold-saved',id:m.id,key:m.key,state:m.state,ok});return true;}
