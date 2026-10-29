import type {DisplayStateStorage} from './display-settings';
export const SEARCH_HISTORY_KEY='codexPrototype.searchHistory.v1';
/** Original workspace-local last ten queries; independent of execution/attempt ledgers. */
export class SearchHistoryStore {
 private values:string[]=[];private corrupt=false;private tail:Promise<unknown>=Promise.resolve();
 constructor(private storage:DisplayStateStorage){const raw=storage.get<unknown>(SEARCH_HISTORY_KEY,undefined);if(raw===undefined)return;if(!Array.isArray(raw)||raw.length>10||!raw.every(value=>typeof value==='string'&&!!value.trim()&&value.length<=160)||new Set(raw).size!==raw.length){this.corrupt=true;return;}this.values=[...raw];}
 read(){if(this.corrupt)throw Error('搜索历史格式未核对，原记录保留；当前搜索仍可使用');return[...this.values];}
 async load(){await this.tail;return this.read();}
 change(action:'add'|'remove'|'clear',query:string,current:()=>boolean){
  const task=this.tail.then(async()=>{if(!current())throw Error('搜索页面已失效');const values=this.read();let next:string[];
   if(action==='clear')next=[];else{if(typeof query!=='string'||!query.trim()||query.length>160)throw Error('搜索历史查询无效');const text=query.trim();next=values.filter(value=>value!==text);if(action==='add')next.unshift(text);else if(action!=='remove')throw Error('搜索历史操作无效');next=next.slice(0,10);}
   await this.storage.update(SEARCH_HISTORY_KEY,next);this.values=next;return this.read();});this.tail=task.catch(()=>{});return task;
 }
}
export async function handleSearchHistory(store:SearchHistoryStore,message:any,post:(message:object)=>unknown,current:()=>boolean){
 if(message?.type!=='search-history')return false;
 if(!Number.isSafeInteger(message.id)||message.id<1||!current())return true;
 try{const values=message.action==='read'?await store.load():['add','remove','clear'].includes(message.action)?await store.change(message.action,message.query,current):undefined;if(!values)throw Error('搜索历史操作无效');if(current())await post({type:'search-history-result',id:message.id,ok:true,values});}
 catch(error){if(current())await post({type:'search-history-result',id:message.id,ok:false,error:error instanceof Error?error.message:'搜索历史保存失败'});}return true;
}
