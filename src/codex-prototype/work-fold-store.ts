import {UserFoldStore} from './user-fold-store';import type {DisplayStateStorage} from './display-settings';import {workSegments,type WorkTurn,type WorkRow} from './work-segments';
export const WORK_FOLD_KEY='codexPrototype.workFolds.v1';
/** Reuse the existing queued fold metadata store, with a separate workspace key. */
export class WorkFoldStore extends UserFoldStore{
 private guard:{active:()=>boolean};private queue:Promise<unknown>=Promise.resolve();
 constructor(storage:DisplayStateStorage,key=WORK_FOLD_KEY){const guard={active:()=>true};super({get:<T>(_key:string,fallback:T)=>storage.get(key,fallback),update:async(_key,value)=>{const previous=storage.get(key,[]);await storage.update(key,value);if(!guard.active()){await storage.update(key,previous);throw Error('折叠身份已失效');}}});this.guard=guard;}
 override set(key:unknown,state:unknown,active:()=>boolean){const run=()=>{this.guard.active=active;return super.set(key,state,active);};const p=this.queue.then(run);this.queue=p.catch(()=>{});return p;}
 override forget(thread:string){const task=this.queue.then(()=>{this.guard.active=()=>true;return super.forget(thread);});this.queue=task.catch(()=>{});return task;}
 async load(){await this.queue;return this.read();}
}
type Owner={threadId:string;connectionId:number;items:WorkRow[];turns:WorkTurn[]};
export function workFoldMatches(m:any,owner:Owner|undefined){return !!owner&&m.threadId===owner.threadId&&m.connectionId===owner.connectionId&&typeof m.key==='string'&&workSegments(owner.threadId,owner.items,owner.turns).some(s=>s.key===m.key);}
export async function handleWorkFold(store:WorkFoldStore,m:any,post:(m:any)=>unknown,owner:()=>Owner|undefined,active:()=>boolean,remember:()=>boolean){
 if(!['work-fold-read','work-fold-save'].includes(m?.type))return false;if(!active())return true;
 if(m.type==='work-fold-read'){const records=await store.load();if(active())await post({type:'work-folds',readId:m.readId,records});return true;}if(!Number.isSafeInteger(m.id)||m.id<1)return true;
 let ok=false;try{await store.set(m.key,m.state,()=>active()&&remember()&&workFoldMatches(m,owner()));ok=active()&&workFoldMatches(m,owner());}catch{}
 if(active())await post({type:'work-fold-saved',id:m.id,key:m.key,state:m.state,threadId:m.threadId,connectionId:m.connectionId,ok});return true;
}
