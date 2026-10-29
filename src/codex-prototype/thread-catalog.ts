import {resolve} from 'node:path';
import type {DisplayStateStorage} from './display-settings';
import type {Transport} from './rpc';
import type {Thread} from './protocol/v2/Thread';
import type {ThreadListResponse} from './protocol/v2/ThreadListResponse';
import type {ThreadUnarchiveResponse} from './protocol/v2/ThreadUnarchiveResponse';

export const THREAD_CATALOG_KEY='codexPrototype.sessions.v1';
export type ThreadMutation='rename'|'archive'|'unarchive'|'delete';
type PendingMutation={kind:ThreadMutation;name?:string};
export type ThreadSummary={id:string;title:string;updatedAt:number;archived:boolean;deleted?:boolean;localOnly?:boolean;unread?:boolean;unreadSource?:'task';observed:boolean;pending?:PendingMutation};
type CatalogData={order:string[];entries:ThreadSummary[];sort:'persisted'|'activity'};
type ListPage={cursor:string|null;cursors:Set<string>;query:string;request:number;loading:boolean;error:string};
const emptyPage=():ListPage=>({cursor:null,cursors:new Set(),query:'',request:0,loading:false,error:''});
const validId=(id:unknown):id is string=>typeof id==='string'&&id.length>0&&id.length<=256;
const validEntry=(v:any):v is ThreadSummary=>v&&validId(v.id)&&typeof v.title==='string'&&v.title.length<=256&&Number.isFinite(v.updatedAt)&&typeof v.archived==='boolean'&&typeof v.observed==='boolean'&&(v.deleted===undefined||typeof v.deleted==='boolean')&&(v.localOnly===undefined||typeof v.localOnly==='boolean')&&(v.unread===undefined||typeof v.unread==='boolean')&&(v.unreadSource===undefined||v.unreadSource==='task'&&v.unread===true)&&(v.pending===undefined||v.pending&&['rename','archive','unarchive','delete'].includes(v.pending.kind)&&(v.pending.kind!=='rename'||typeof v.pending.name==='string'&&v.pending.name.length<=80));

/** Workspace display metadata; ownership and the immutable attempt history remain in Store. */
export class ThreadCatalog {
  private data:CatalogData={order:[],entries:[],sort:'persisted'};
  private tail:Promise<unknown>=Promise.resolve();
  private corrupt=false;
  private writeError='';
  private revision=0;
  private deletedNotifications=new Set<string>();
  private activePage=emptyPage();
  private recyclePage=emptyPage();
  get loading(){return this.activePage.loading||this.recyclePage.loading;}
  get error(){return this.corrupt?'会话元数据损坏，原记录保留，修改禁用':this.writeError||this.activePage.error||this.recyclePage.error;}
  get nextCursor(){return this.activePage.cursor;}
  constructor(private storage:DisplayStateStorage){
    const raw=storage.get<any>(THREAD_CATALOG_KEY,undefined);
    if(raw===undefined)return;
    if(!raw||!Array.isArray(raw.order)||!raw.order.every(validId)||new Set(raw.order).size!==raw.order.length||!Array.isArray(raw.entries)||!raw.entries.every(validEntry)||new Set(raw.entries.map((v:any)=>v.id)).size!==raw.entries.length||!['persisted','activity'].includes(raw.sort)){this.corrupt=true;return;}
    this.data=structuredClone(raw);
  }
  private change(edit:(next:CatalogData)=>void,affectsList=true){
    const task=this.tail.then(async()=>{
      if(this.corrupt||this.writeError)throw Error(this.error);
      const next=structuredClone(this.data);edit(next);
      await this.storage.update(THREAD_CATALOG_KEY,next);this.data=next;if(affectsList)this.revision++;
    });
    this.tail=task.catch(()=>{});return task;
  }
  get(id:string):ThreadSummary|undefined{
    const entry=structuredClone(this.data.entries.find(v=>v.id===id));
    if(!this.deletedNotifications.has(id))return entry;
    const deleted:ThreadSummary={...(entry??{id,title:'新会话',updatedAt:0,archived:false,observed:true}),deleted:true};delete deleted.pending;delete deleted.unread;delete deleted.unreadSource;return deleted;
  }
  /** A public deletion is authoritative immediately; cleanup waits for its durable tombstone. */
  deletedUpdated(id:string){
    if(!validId(id))return Promise.reject(Error('删除通知身份无效'));
    this.deletedNotifications.add(id);this.cancelRead();
    return this.change(next=>{let entry=next.entries.find(v=>v.id===id);if(!entry){entry={id,title:'新会话',updatedAt:0,archived:false,observed:true};next.entries.push(entry);}entry.deleted=true;delete entry.pending;delete entry.unread;delete entry.unreadSource;}).then(()=>{this.deletedNotifications.delete(id);},error=>{this.writeError='会话删除标记保存未确认；目录修改已暂停，请Reload后核对：'+(error instanceof Error?error.message:String(error));throw Error(this.writeError);});
  }
  assertUsable(id:string){const entry=this.get(id);if(this.corrupt||entry?.deleted||entry?.archived||entry?.pending)throw Error('会话已归档、删除或操作结果待核对；未执行');}
  snapshot(owned:readonly string[]){
    const all=owned.map(id=>this.get(id)??{id,title:'新会话',updatedAt:0,archived:false,observed:false});
    const order=new Map(this.data.order.map((id,i)=>[id,i]));
    const active=all.filter(v=>!v.archived&&!v.deleted).sort((a,b)=>this.data.sort==='activity'?b.updatedAt-a.updatedAt:(order.get(a.id)??Number.MAX_SAFE_INTEGER)-(order.get(b.id)??Number.MAX_SAFE_INTEGER));
    return {sessions:active,recycle:all.filter(v=>v.archived&&!v.deleted).sort((a,b)=>b.updatedAt-a.updatedAt),sort:this.data.sort,loading:this.loading,error:this.error,hasMore:!!this.activePage.cursor,recycleHasMore:!!this.recyclePage.cursor,scope:'仅本任务拥有的当前工作区会话；未列出的保存状态可能尚未核对'};
  }
  async observe(thread:Thread,archived=false,after?:string){
    await this.change(next=>{
      const prior=next.entries.find(v=>v.id===thread.id);
      if(prior?.deleted||this.deletedNotifications.has(thread.id))throw Error('已永久删除的会话不能由迟到快照恢复');
      const entry:ThreadSummary={id:thread.id,title:(prior?.pending?.kind==='rename'?prior.pending.name!:(thread.name?.trim()||thread.preview?.trim()||'新会话')).slice(0,256),updatedAt:thread.updatedAt,archived,observed:true,...(prior?.unread?{unread:true,...(prior.unreadSource?{unreadSource:prior.unreadSource}:{})}:{}),...(prior?.pending?{pending:prior.pending}:{})};
      next.entries=next.entries.filter(v=>v.id!==thread.id);next.entries.push(entry);
      if(!next.order.includes(thread.id)){const index=after?next.order.indexOf(after):-1;next.order.splice(index<0?next.order.length:index+1,0,thread.id);}
    });
  }
  /** Owned public name notifications contain no activity timestamp or history. */
  nameUpdated(id:string,name:string|null|undefined){
    if(!validId(id))return Promise.resolve();
    return this.change(next=>{
      let entry=next.entries.find(v=>v.id===id);if(entry?.deleted)return;
      if(!entry){if(!name?.trim())return;entry={id,title:'新会话',updatedAt:0,archived:false,observed:true};next.entries.push(entry);if(!next.order.includes(id))next.order.push(id);}
      if(entry.pending?.kind==='rename')entry.title=entry.pending.name!;
      else if(name?.trim())entry.title=name.trim().slice(0,256);
    });
  }
  archiveUpdated(id:string,archived:boolean){
    if(!validId(id))return Promise.resolve();
    return this.change(next=>{const entry=next.entries.find(v=>v.id===id);if(entry&&!entry.deleted)entry.archived=archived;});
  }
  reorder(owned:readonly string[],id:string,before?:string){
    if(!owned.includes(id)||before!==undefined&&!owned.includes(before)||id===before)throw Error('会话排序身份无效');
    return this.change(next=>{const order=[...new Set([...next.order,...owned])].filter(v=>owned.includes(v)&&v!==id);const index=before?order.indexOf(before):-1;order.splice(index<0?order.length:index,0,id);next.order=order;});
  }
  setSort(sort:unknown){if(sort!=='persisted'&&sort!=='activity')throw Error('排序方式无效');return this.change(next=>{next.sort=sort;});}
  /** Local sidebar state only: no history read or backend mutation. Listing preserves it. */
  setUnread(id:string,unread:boolean,current:()=>boolean,source?:'task'){
    if(!validId(id)||typeof unread!=='boolean'||!current())throw Error('未读标记身份已失效');
    return this.change(next=>{if(!current())throw Error('未读标记身份已失效');const entry=next.entries.find(v=>v.id===id);if(!entry||entry.deleted||entry.archived||entry.pending)throw Error('会话不可用或待核对，未修改标记');const manual=entry.unread===true&&!entry.unreadSource;delete entry.unreadSource;if(unread){entry.unread=true;if(source==='task'&&!manual)entry.unreadSource='task';}else delete entry.unread;},false);
  }
  cancelRead(){for(const page of [this.activePage,this.recyclePage]){page.request++;page.loading=false;page.cursor=null;page.cursors.clear();}}
  /** A title-filtered server list is not a full-text content search. Never adopt foreign threads. */
  async list(rpc:Transport,root:string,owned:()=>readonly string[],current:()=>boolean,options:{more?:boolean;archived?:boolean;query?:string}={}){
    const archived=options.archived===true,listPage=archived?this.recyclePage:this.activePage;
    if(listPage.loading&&options.more)return;
    const request=++listPage.request,revision=this.revision;
    if(!options.more){listPage.query=options.query??'';listPage.cursor=null;listPage.cursors.clear();}
    const cursor=options.more?listPage.cursor:null;
    if(options.more&&!cursor)return;
    const query=listPage.query;
    listPage.loading=true;listPage.error='';
    try{
      const page=await rpc.request<'thread/list',ThreadListResponse>('thread/list',{cwd:root,archived,cursor,limit:100,sortKey:'updated_at',sortDirection:'desc',modelProviders:['openai'],useStateDbOnly:true,...(query?{searchTerm:query}:{})});
      if(!current()||request!==listPage.request)return;
      if(!Array.isArray(page.data)||!(page.nextCursor===null||typeof page.nextCursor==='string'&&page.nextCursor.length>0))throw Error('会话列表返回格式无效');
      if(page.nextCursor&&(page.nextCursor===cursor||listPage.cursors.has(page.nextCursor)||!page.data.length))throw Error('会话列表游标未推进，已停止分页');
      if(revision!==this.revision)throw Error('会话列表读取期间有本地更改，请刷新核对');
      const allowed=new Set(owned()),threads=page.data.filter(thread=>allowed.has(thread.id)&&resolve(thread.cwd).toLowerCase()===resolve(root).toLowerCase());
      await this.change(next=>{
        if(!current()||request!==listPage.request)throw Error('会话列表身份已失效');
        for(const thread of threads){
          const old=next.entries.find(v=>v.id===thread.id);
          if(old?.deleted)continue;
          // A mutation receipt can be unknown: a read may confirm, but must never replay it.
          const pending=old?.pending;
          const confirmed=pending&&(pending.kind==='rename'?thread.name===pending.name:pending.kind==='archive'?archived:pending.kind==='unarchive'?!archived:false);
          next.entries=next.entries.filter(v=>v.id!==thread.id);
          next.entries.push({id:thread.id,title:(thread.name?.trim()||thread.preview?.trim()||'新会话').slice(0,256),updatedAt:thread.updatedAt,archived,observed:true,...(old?.unread?{unread:true,...(old.unreadSource?{unreadSource:old.unreadSource}:{})}:{}),...(pending&&!confirmed?{pending}:{})});
          if(!next.order.includes(thread.id))next.order.push(thread.id);
        }
      });
      if(!current()||request!==listPage.request)return;
      listPage.cursor=page.nextCursor;if(cursor)listPage.cursors.add(cursor);
    }catch(error){if(current()&&request===listPage.request)listPage.error=error instanceof Error?error.message:String(error);}
    finally{if(request===listPage.request)listPage.loading=false;}
  }
  async mutate(rpc:Transport,root:string,id:string,kind:ThreadMutation,current:()=>boolean,name?:string){
    if(!validId(id)||!current())throw Error('会话操作身份已失效');
    const entry=this.get(id);
    if(entry?.deleted||entry?.pending)throw Error('会话已删除或上次结果待核对，未重复操作');
    if(kind==='rename'&&(typeof name!=='string'||!name.trim()||name.length>80))throw Error('会话名称须为1–80个字符');
    this.cancelRead();
    const pending:PendingMutation={kind,...(kind==='rename'?{name:name!.trim()}:{})};
    await this.change(next=>{if(!current())throw Error('会话操作身份已失效');let value=next.entries.find(v=>v.id===id);if(value?.pending||value?.deleted)throw Error('会话操作在途或结果待核对');if(!value){value={id,title:'新会话',updatedAt:0,archived:false,observed:false};next.entries.push(value);}value.pending=pending;});
    if(!current()){await this.clearPending(id);throw Error('会话操作身份已失效，未提交');}
    try{
      let acknowledgement:unknown;
      if(kind==='rename')acknowledgement=await rpc.request('thread/name/set',{threadId:id,name:pending.name!});
      else if(kind==='archive')acknowledgement=await rpc.request('thread/archive',{threadId:id});
      else if(kind==='unarchive'){
        const result=await rpc.request<'thread/unarchive',ThreadUnarchiveResponse>('thread/unarchive',{threadId:id});
        if(result.thread.id!==id||resolve(result.thread.cwd).toLowerCase()!==resolve(root).toLowerCase())throw Error('恢复归档的回执身份未核对，未切换');
      }
      else acknowledgement=await rpc.request('thread/delete',{threadId:id});
      if(kind!=='unarchive'&&(!acknowledgement||typeof acknowledgement!=='object'||Array.isArray(acknowledgement)||Object.keys(acknowledgement).length))throw Error('会话操作回执格式未核对；结果未知，不自动重试');
    }catch(error){
      // Explicit JSON-RPC rejection proves this request failed; transport failure is unknown.
      if((error as {requestRejected?:boolean})?.requestRejected)await this.clearPending(id);
      throw error;
    }
    if(!current())throw Error('会话回执身份已失效；保留待核对标记，不自动重试');
    await this.change(next=>{
      const value=next.entries.find(v=>v.id===id)!;delete value.pending;
      if(kind==='rename')value.title=pending.name!;
      else if(kind==='delete'){value.deleted=true;delete value.unread;delete value.unreadSource;}
      else value.archived=kind==='archive';
    });
  }
  /** Only Session may use this after explicit backend absence and no local send attempts.
   * Drafts survive local archiving; permanent removal still uses the normal confirmation. */
  async mutateEmpty(id:string,kind:ThreadMutation,current:()=>boolean,name?:string){
    if(!validId(id)||!current())throw Error('空会话操作身份已失效');
    if(kind==='rename'&&(typeof name!=='string'||!name.trim()||name.length>80))throw Error('会话名称须为1–80个字符');
    this.cancelRead();await this.change(next=>{if(!current())throw Error('空会话操作身份已失效');const value=next.entries.find(v=>v.id===id);if(!value||value.pending||value.deleted)throw Error('空会话记录已变化，未修改');value.localOnly=true;if(kind==='rename')value.title=name!.trim();else if(kind==='delete'){value.deleted=true;delete value.unread;delete value.unreadSource;}else value.archived=kind==='archive';});
  }
  private clearPending(id:string){return this.change(next=>{const entry=next.entries.find(v=>v.id===id);if(entry)delete entry.pending;});}
}
