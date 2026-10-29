import type {Session} from './session';import {ServiceStatusCatalog} from './service-status';
import {verifyTools} from './tools';
import {WORKSPACE_FILES_SERVER,fileArguments,checkedFileResult,type WorkspaceFileTool} from './workspace-files-contract';
type Owner={session:Session;connectionId:number};
export class ServiceStatusHost{
 private last=0;private busy=false;private source:Owner|undefined;private catalog:ServiceStatusCatalog|undefined;
 private fileRequest:number|undefined;private metadataRequest:number|undefined;private metadataRevision=-1;private directoryRevision=-1;
 constructor(private owner:()=>Owner|undefined,private current:()=>boolean){}
 async handle(m:any,post:(value:object)=>unknown){
  if(m?.type==='service-status-cancel'){const owner=this.owner();if(this.current()&&m.id===this.metadataRequest&&m.threadId===owner?.session.projection.threadId&&m.connectionId===owner?.connectionId)this.metadataRequest=undefined;return true;}
  if(m?.type==='service-files-cancel'){const owner=this.owner();if(this.current()&&m.id===this.fileRequest&&m.threadId===owner?.session.projection.threadId&&m.connectionId===owner?.connectionId)this.fileRequest=undefined;return true;}
  if(m?.type==='service-files-read')return this.readFile(m,post);
  if(m?.type!=='service-status-read'&&m?.type!=='service-app-read'&&m?.type!=='service-apps-list')return false;
  if(!this.current()||!Number.isSafeInteger(m.id)||m.id<1||m.id<=this.last)return true;
  const owner=this.owner(),thread=owner?.session.projection.threadId,epoch=owner?.session.serviceStatusRevision??0,soft=owner?.session.appCatalogRevision??0;
  const owned=()=>{const now=this.owner();return this.current()&&!!owner&&!!thread&&now?.session===owner.session&&now.connectionId===owner.connectionId&&now.session.projection.threadId===thread&&(now.session.serviceStatusRevision??0)===epoch&&owner.session.isConnected&&!owner.session.isOperating&&owner.session.store.read().threads.includes(thread);};
  const live=()=>owned()&&(this.metadataRequest===undefined||this.metadataRequest===m.id);
  if(!owned()||m.threadId!==thread||m.connectionId!==owner?.connectionId)return true;this.last=m.id;
  let catalog:ServiceStatusCatalog|undefined;
  try{
   if(!owner||!thread||!owner.session.isConnected||owner.session.isOperating||!owner.session.store.read().threads.includes(thread)||m.threadId!==thread||m.connectionId!==owner.connectionId||!live())throw Error('服务状态页面、会话或连接尚未就绪');
   if(this.busy)throw Error('服务状态仍在读取');
   if(this.source?.session!==owner.session||this.source.connectionId!==owner.connectionId||this.catalog?.threadId!==thread){this.source=owner;this.catalog=new ServiceStatusCatalog(owner.session.rpc,owner.session.root,thread);}
   catalog=this.catalog!;this.busy=true;this.metadataRequest=m.id;
   let expectedSoft=soft,firstPagePending=m.type==='service-apps-list';
   const current=()=>owned()&&this.metadataRequest===m.id&&(firstPagePending||(owner.session.appCatalogRevision??0)===expectedSoft);
   try{
    if(m.type==='service-status-read')await catalog.refresh(current);
    else{
     if(!Number.isSafeInteger(m.revision)||this.metadataRevision!==epoch||this.directoryRevision!==soft)throw Error('应用快照身份无效');
     // app/list itself can announce loading completion before its first response.
     // That scoped response starts the snapshot; later page/runtime changes invalidate it.
     if(m.type==='service-apps-list')await catalog.readDirectory(m.revision,current,()=>{expectedSoft=owner.session.appCatalogRevision??0;firstPagePending=false;});
     else{if(typeof m.appId!=='string')throw Error('应用快照身份无效');await catalog.readApp(m.appId,m.revision,current);}
    }
    if(current()){this.metadataRevision=epoch;this.directoryRevision=expectedSoft;await post({type:'service-status-result',id:m.id,threadId:thread,connectionId:owner.connectionId,ok:true,appCatalogRevision:expectedSoft,serviceStatusRevision:epoch,value:catalog.snapshot()});}
   }catch{if(owned()&&this.metadataRequest===m.id)await post({type:'service-status-result',id:m.id,threadId:thread,connectionId:owner.connectionId,ok:false,error:'应用或服务状态未确认；请重新读取当前状态',value:catalog.snapshot()});}
   finally{if(this.metadataRequest===m.id)this.metadataRequest=undefined;this.busy=false;}
  }catch{if(owned())await post({type:'service-status-result',id:m.id,threadId:thread,connectionId:owner!.connectionId,ok:false,error:'服务状态未确认；请核对连接与隔离配置后主动重试',value:catalog?.snapshot()});}
  return true;
 }
 private async readFile(m:any,post:(value:object)=>unknown){
  if(!this.current()||!Number.isSafeInteger(m.id)||m.id<1||m.id<=this.last)return true;
  const owner=this.owner(),thread=owner?.session.projection.threadId;
  const owned=()=>{const now=this.owner();return this.current()&&!!owner&&!!thread&&now?.session===owner.session&&now.connectionId===owner.connectionId&&now.session.projection.threadId===thread&&owner.session.isConnected&&!owner.session.isOperating&&owner.session.store.read().threads.includes(thread);};
  const reply=(value:object)=>post({type:'service-files-result',id:m.id,threadId:thread,connectionId:owner?.connectionId,...value});
  if(!owned()||m.threadId!==thread||m.connectionId!==owner?.connectionId)return true;
  this.last=m.id;
  if(this.busy){await reply({ok:false,error:'服务仍在读取；请稍后主动重试'});return true;}
  this.busy=true;this.fileRequest=m.id;const live=()=>owned()&&this.fileRequest===m.id;
  try{
   if(!owner!.session.rpc.workspaceFiles)throw Error('未准入');
   const args=fileArguments(m.tool,m.arguments),tool=m.tool as WorkspaceFileTool;
   await verifyTools(owner!.session.rpc,owner!.session.root,thread!,live);
   if(!live())return true;
   const result:any=await owner!.session.rpc.request('mcpServer/tool/call',{threadId:thread!,server:WORKSPACE_FILES_SERVER,tool,arguments:args});
   if(!live())return true;
   if(result?.isError===true){await reply({ok:false,error:'文件服务未能读取：请核对路径、文件类型、大小和权限'});return true;}
   if(!result||result.isError!==false&&result.isError!==null&&result.isError!==undefined||!Array.isArray(result.content)||result.content.length!==1||result.content[0]?.type!=='text'||typeof result.content[0].text!=='string'||result.content[0].text.length>150000)throw Error('回执无效');
   const value=checkedFileResult(JSON.parse(result.content[0].text),tool,args);
   if(result.structuredContent!=null&&JSON.stringify(checkedFileResult(result.structuredContent,tool,args))!==JSON.stringify(value))throw Error('回执不一致');
   await reply({ok:true,value});
  }catch{if(live())await reply({ok:false,error:'读取未确认；请核对连接与服务状态后主动重试'});}
  finally{if(this.fileRequest===m.id)this.fileRequest=undefined;this.busy=false;}
  return true;
 }
}
