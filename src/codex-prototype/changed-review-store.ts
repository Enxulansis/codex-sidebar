import {createHash} from 'node:crypto';import type {DisplayStateStorage} from './display-settings';import type {PageRow,WorkTurn} from './page-model';
import {changedFiles} from './changed-files';import {CHANGED_REVIEW_KEY,CHANGED_REVIEW_CAP,changedReviewKey,changedReviewPayload,validChangedReviewKeys} from './changed-review';
type Owner={threadId:string;connectionId:number;items:PageRow[];turns:WorkTurn[]};
/** One queued workspace snapshot per batch; uncertain or corrupt state is preserved until Reload. */
export class ChangedReviewStore{
 private records:string[]=[];private error='';private queue:Promise<unknown>=Promise.resolve();private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){const raw=storage.get<unknown>(CHANGED_REVIEW_KEY,[]);if(validChangedReviewKeys(raw))this.records=[...raw];else this.error='已阅记录格式不可用；原数据已保留，请核对后正常 Reload';}
 snapshot(){return{keys:[...this.records],error:this.error};}async load(){await this.queue;return this.snapshot();}
 set(keys:unknown,reviewed:unknown,active:()=>boolean){return this.enqueue(async()=>{
  if(this.error)throw Error(this.error);if(!validChangedReviewKeys(keys)||!keys.length||typeof reviewed!=='boolean'||keys.some(key=>this.forgotten.has(JSON.parse(key)[0]))||!active())throw Error('变更身份已变化，未保存已阅记录');
  const previous=[...this.records],next=new Set(previous);for(const key of keys){next.delete(key);if(reviewed)next.add(key);}while(next.size>CHANGED_REVIEW_CAP)next.delete(next.values().next().value!);
  await this.persist([...next]);if(!active()){await this.persist(previous);throw Error('变更身份已变化，已撤回本次已阅记录');}this.records=[...next];return this.snapshot();
 });}
 forget(thread:string){this.forgotten.add(thread);return this.enqueue(async()=>{if(this.error)throw Error(this.error);const next=this.records.filter(key=>JSON.parse(key)[0]!==thread);await this.persist(next);this.records=next;});}
 private async persist(keys:string[]){try{await this.storage.update(CHANGED_REVIEW_KEY,keys);}catch{this.error='已阅记录保存未确认；请正常 Reload 后核对，不会自动重试';throw Error(this.error);}}
 private enqueue<T>(run:()=>Promise<T>){const task=this.queue.then(run);this.queue=task.catch(()=>{});return task;}
}
export function changedReviewMatches(m:any,owner:Owner|undefined){
 if(!owner||owner.threadId!==m.threadId||owner.connectionId!==m.connectionId||!validChangedReviewKeys(m.keys)||!m.keys.length)return false;
 const keys=new Set(changedFiles(owner.items,owner.turns).groups.flatMap(group=>group.files.map(file=>changedReviewKey(owner.threadId,group.turnId,createHash('sha256').update(changedReviewPayload(file)).digest('hex')))));
 return m.keys.every((key:string)=>keys.has(key));
}
export async function handleChangedReview(store:ChangedReviewStore,m:any,post:(m:any)=>unknown,owner:()=>Owner|undefined,active:()=>boolean){
 if(!['changed-review-read','changed-review-save'].includes(m?.type))return false;const owned=()=>{const value=owner();return active()&&!!value&&m.threadId===value.threadId&&m.connectionId===value.connectionId;};if(!owned())return true;
 if(m.type==='changed-review-read'){if(!Number.isSafeInteger(m.readId)||m.readId<1)return true;const state=await store.load();if(owned())await post({type:'changed-review-records',readId:m.readId,threadId:m.threadId,connectionId:m.connectionId,...state});return true;}
 if(!Number.isSafeInteger(m.id)||m.id<1||typeof m.reviewed!=='boolean')return true;let ok=false,error='';try{await store.set(m.keys,m.reviewed,()=>owned()&&changedReviewMatches(m,owner()));ok=owned()&&changedReviewMatches(m,owner());}catch(cause){error=cause instanceof Error?cause.message:'已阅记录保存未确认';}
 if(owned()){const state=store.snapshot();await post({type:'changed-review-saved',id:m.id,threadId:m.threadId,connectionId:m.connectionId,requestedKeys:m.keys,reviewed:m.reviewed,ok,...state,error:state.error||error});}return true;
}
