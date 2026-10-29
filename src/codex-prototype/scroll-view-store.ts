import type {DisplayStateStorage} from './display-settings';
export type RailViewport={scrollTop:number;anchor?:{turnId:string;offset:number}};
export type ScrollMemo={scrollTop:number;atBottom:boolean;anchor?:{turnId:string;itemId:string;offset:number;kind?:'work'};rail?:RailViewport;railManual?:boolean};
export const SCROLL_VIEW_KEY='codexPrototype.scrollViews.v1',SCROLL_VIEW_CAP=32;
export function validRailViewport(v:any):v is RailViewport{return !!v&&!Array.isArray(v)&&Object.keys(v).every(k=>['scrollTop','anchor'].includes(k))&&Number.isFinite(v.scrollTop)&&v.scrollTop>=0&&v.scrollTop<=100_000_000&&(v.anchor===undefined||!!v.anchor&&!Array.isArray(v.anchor)&&Object.keys(v.anchor).every(k=>['turnId','offset'].includes(k))&&typeof v.anchor.turnId==='string'&&v.anchor.turnId.length>0&&v.anchor.turnId.length<=256&&Number.isFinite(v.anchor.offset)&&Math.abs(v.anchor.offset)<=100_000_000);}
export function validScrollMemo(v:any):v is ScrollMemo{return !!v&&Number.isFinite(v.scrollTop)&&v.scrollTop>=0&&v.scrollTop<=100_000_000&&typeof v.atBottom==='boolean'&&(v.anchor===undefined||!!v.anchor&&(v.anchor.kind===undefined||v.anchor.kind==='work')&&typeof v.anchor.turnId==='string'&&v.anchor.turnId.length<=256&&typeof v.anchor.itemId==='string'&&v.anchor.itemId.length>0&&v.anchor.itemId.length<=256&&Number.isFinite(v.anchor.offset)&&Math.abs(v.anchor.offset)<=100_000_000)&&(v.rail===undefined||validRailViewport(v.rail))&&(v.railManual===undefined||typeof v.railManual==='boolean');}
const validThread=(t:unknown):t is string=>typeof t==='string'&&t.length>0&&t.length<=256;
/** Public thread/turn/item identity and geometry only. No RPC IDs, body, media, auth or tool state. */
export class ScrollViewStore{
 private records=new Map<string,ScrollMemo>();private corrupt=false;private tail:Promise<unknown>=Promise.resolve();
 private forgotten=new Set<string>();
 constructor(private storage:DisplayStateStorage){const raw=storage.get<any>(SCROLL_VIEW_KEY,undefined);if(raw===undefined)return;if(!Array.isArray(raw)||raw.length>SCROLL_VIEW_CAP||raw.some(v=>!Array.isArray(v)||!validThread(v[0])||!validScrollMemo(v[1]))){this.corrupt=true;return;}this.records=new Map(raw);}
 read(thread:string){if(this.corrupt)throw Error('阅读位置存储无法读取；未覆盖原数据');if(!validThread(thread)||this.forgotten.has(thread))throw Error('阅读线程无效或已永久删除');const value=this.records.get(thread);return value?structuredClone(value):undefined;}
 load(thread:string){const task=this.tail.then(async()=>{const value=this.read(thread);if(value&&[...this.records.keys()].at(-1)!==thread){const next=new Map(this.records);next.delete(thread);next.set(thread,value);await this.storage.update(SCROLL_VIEW_KEY,[...next]);this.records=next;}return value;});this.tail=task.catch(()=>{});return task;}
 save(thread:string,value:unknown,protectedThread=thread){if(!validScrollMemo(value))return Promise.reject(Error('阅读位置格式无效'));const snapshot=structuredClone(value);const task=this.tail.then(async()=>{this.read(thread);const next=new Map(this.records);next.delete(thread);next.set(thread,snapshot);for(const key of next.keys()){if(next.size<=SCROLL_VIEW_CAP)break;if(key!==thread&&key!==protectedThread)next.delete(key);}await this.storage.update(SCROLL_VIEW_KEY,[...next]);this.records=next;return structuredClone(snapshot);});this.tail=task.catch(()=>{});return task;}
 forget(thread:string){if(!validThread(thread)||this.corrupt)return Promise.reject(Error('无法安全清理阅读记录'));this.forgotten.add(thread);const task=this.tail.then(async()=>{const next=new Map(this.records);next.delete(thread);await this.storage.update(SCROLL_VIEW_KEY,[...next]);this.records=next;});this.tail=task.catch(()=>{});return task;}
}
type Owner={threadId:string;connectionId:number;threads:string[]};
export class ScrollViewHost{
 private view='';
 constructor(private store:Pick<ScrollViewStore,'load'|'save'>,private owner:()=>Owner|undefined,private active:()=>boolean){}
 async handle(m:any,post:(m:any)=>unknown){
  if(!['scroll-view-read','scroll-view-save'].includes(m?.type))return false;
  if(!this.active()||!Number.isSafeInteger(m.id)||m.id<1)return true;
  const owner=this.owner(),reply={type:'scroll-view-result',id:m.id,viewId:m.viewId,threadId:m.threadId,connectionId:m.connectionId};
  try{if(!this.view&&m.type==='scroll-view-read'&&/^[0-9a-f-]{36}$/i.test(m.viewId??''))this.view=m.viewId;if(!owner||!this.view||m.viewId!==this.view||m.connectionId!==owner.connectionId||!owner.threads.includes(m.threadId)||(m.type==='scroll-view-read'&&owner.threadId!==m.threadId))throw Error('阅读位置身份已失效');const value=m.type==='scroll-view-read'?await this.store.load(m.threadId):await this.store.save(m.threadId,m.value,owner.threadId);if(this.active())await post({...reply,ok:true,value});}
  catch(e){if(this.active())await post({...reply,ok:false,error:e instanceof Error?e.message:'阅读位置保存失败'});}return true;
 }
}
