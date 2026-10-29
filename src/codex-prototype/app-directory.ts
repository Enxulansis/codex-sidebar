import type {Transport} from './rpc';
export type AppDirectoryEntry={id:string;name:string;accessible:boolean;enabled:boolean};
export type AppDirectory={entries:AppDirectoryEntry[];readAt:number};
const PAGE_SIZE=50,MAX_APPS=256,MAX_PAGES=8;
export const appText=(value:unknown,max=256):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
/** A complete, thread-scoped display snapshot. URLs, branding, schemas and credentials never leave this boundary. */
export async function readAppDirectory(rpc:Pick<Transport,'request'>,threadId:string,current:()=>boolean,firstPage:()=>void=()=>{}):Promise<AppDirectory>{
 const check=()=>{if(!current())throw Error('应用目录来源已失效');};check();
 const entries:AppDirectoryEntry[]=[],ids=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null;
 for(let index=0;index<MAX_PAGES;index++){
  const reply:any=await rpc.request('app/list',{threadId,cursor,limit:PAGE_SIZE,forceRefetch:false});if(index===0)firstPage();check();
  if(!reply||!Array.isArray(reply.data)||reply.data.length>PAGE_SIZE||reply.nextCursor!==null&&!appText(reply.nextCursor,4096)||!reply.data.length&&reply.nextCursor!==null)throw Error('应用目录分页未完整核对');
  for(const raw of reply.data){
   if(!raw||!appText(raw.id)||!appText(raw.name)||typeof raw.isAccessible!=='boolean'||typeof raw.isEnabled!=='boolean'||ids.has(raw.id)||entries.length>=MAX_APPS)throw Error('应用目录重复、过大或字段未核对');
   ids.add(raw.id);entries.push({id:raw.id,name:raw.name,accessible:raw.isAccessible,enabled:raw.isEnabled});
  }
  if(reply.nextCursor===null)return{entries,readAt:Date.now()};
  const next:string=reply.nextCursor;if(cursors.has(next))throw Error('应用目录游标重复');cursor=next;cursors.add(next);
 }
 throw Error('应用目录分页超过显示上限');
}
