import type {ThreadCatalog} from './thread-catalog';
export type SidebarReadContext={connectionId:number;threadId:string;owned:readonly string[];ready:boolean;busy:boolean;operating:boolean;loaded:boolean;visible:boolean};
/** Sidebar-local marks. The pinned app-server exposes no read-state mutation request. */
export async function handleThreadReadState(catalog:ThreadCatalog,message:any,context:()=>SidebarReadContext|undefined,current:()=>boolean,post:(value:object)=>unknown){
 if(message?.type!=='thread-read-state')return false;
 const initial=context(),automatic=message.automatic===true;
 const live=()=>{const value=context();return current()&&!!value&&value.connectionId===message.connectionId&&value.owned.includes(message.threadId)&&value.ready&&!value.busy&&!value.operating&&(!automatic||!message.unread&&value.visible&&value.loaded&&value.threadId===message.threadId);};
 try{
  if(!initial||!Number.isSafeInteger(message.id)||message.id<1||typeof message.threadId!=='string'||typeof message.unread!=='boolean'||message.automatic!==undefined&&typeof message.automatic!=='boolean'||!live())throw Error('会话标记身份或阅读状态已失效，未修改');
  await catalog.setUnread(message.threadId,message.unread,live);
  // Availability gates admission, not the acknowledgement of a durable write.
  // A later busy/restore state must not strand the requesting toolbar's pending state.
  if(current()&&context()?.connectionId===message.connectionId)await post({type:'thread-result',id:message.id,connectionId:message.connectionId,ok:true});
 }catch(error){if(current()&&context()?.connectionId===message.connectionId)await post({type:'thread-result',id:message.id,connectionId:message.connectionId,ok:false,error:error instanceof Error?error.message:'会话标记保存失败'});}
 return true;
}
