import type {Transport} from './rpc';import {checkConfig,DISABLED_MCP,DISABLED_PLUGINS,assertWorkspaceCatalog} from './tools';
import {WORKSPACE_FILES_SERVER} from './workspace-files-contract';
import {readAppDirectory,type AppDirectory} from './app-directory';
export type ServiceTool={name:string;title:string|null;enabled:boolean;readOnly:boolean};
export type McpService={name:string;runtime:string|null;auth:string;tools:string[];resources:number;templates:number;catalogError:boolean};
export type AppService={id:string;enabled:boolean;callable:boolean;name?:string;tools?:ServiceTool[];toolsKnown?:boolean};
export type ServiceStatus={threadId:string;revision:number;readAt:number;isolated:boolean;workspaceFiles?:boolean;mcpComplete:boolean;mcp:McpService[]|null;apps:AppService[]|null;directory?:AppDirectory;directoryTools?:AppService[];disabledPlugins:string[];errors:string[]};
const runtimes=new Set(['notStarted','starting','connected','authenticationRequired','failed','cancelled','disabled']);
const auths=new Set(['unknown','unsupported','notLoggedIn','bearerToken','oAuth']);
const text=(value:unknown,max=256):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
function mcpService(value:any):McpService{
 if(!value||!text(value.name)||value.runtimeStatus!==null&&!runtimes.has(value.runtimeStatus)||!value.tools||typeof value.tools!=='object'||Array.isArray(value.tools)||!Array.isArray(value.resources)||!Array.isArray(value.resourceTemplates))throw Error('服务目录字段未核对');
 const tools=Object.keys(value.tools);if(tools.length>512||tools.some(name=>!text(name))||value.resources.length>2048||value.resourceTemplates.length>2048)throw Error('服务目录超过显示上限');
 return{name:value.name,runtime:value.runtimeStatus,auth:auths.has(value.authStatus)?value.authStatus:'unknown',tools,resources:value.resources.length,templates:value.resourceTemplates.length,catalogError:!!value.toolsError};
}
/** Public read-side metadata only. Never retain config bodies, endpoint URLs, credentials, tool schemas or resource contents. */
export class ServiceStatusCatalog{
 private value:ServiceStatus|undefined;private revision=0;
 constructor(private rpc:Pick<Transport,'request'|'workspaceFiles'>,private root:string,readonly threadId:string){}
 snapshot(){return this.value?structuredClone(this.value):undefined;}
 async readDirectory(revision:number,current:()=>boolean,firstPage:()=>void=()=>{}){
  const source=this.value,epoch=++this.revision,live=()=>this.value===source&&this.revision===epoch&&current();
  if(!source||source.revision!==revision||!live())throw Error('应用快照身份已失效，请重新读取状态');
  await checkConfig(this.rpc as Transport,this.root);if(!live())throw Error('应用目录来源已失效');
  const directory=await readAppDirectory(this.rpc,this.threadId,live,firstPage);
  // Runtime flags come from their own public snapshot, never from directory access.
  let apps:AppService[]|null=null;
  try{const reply=await this.rpc.request('app/installed',{threadId:this.threadId,forceRefresh:false});if(!live())throw Error('应用快照已失效');apps=installedApps(reply);}catch{if(!live())throw Error('应用快照已失效');}
  if(!live())throw Error('应用目录来源已失效');
  this.value={...source,revision:epoch,readAt:Date.now(),apps,directory,directoryTools:[],errors:source.errors.filter(error=>!error.startsWith('已安装应用快照'))};
  if(apps===null)this.value.errors.push('已安装应用快照不可用；目录可见不代表工具可调用');
 }
 async refresh(current:()=>boolean){
  const revision=++this.revision,live=()=>revision===this.revision&&current(),check=()=>{if(!live())throw Error('服务状态来源已失效');};check();
  await checkConfig(this.rpc as Transport,this.root);check();
  let mcp:McpService[]|null=null,apps:AppService[]|null=null,workspaceCatalog=false;const errors:string[]=[];
  try{
   const values:McpService[]=[],names=new Set<string>(),cursors=new Set<string>();let cursor:string|null=null;
   for(let page=0;;page++){
    if(page===8)throw Error('服务目录分页过多');check();const reply:any=await this.rpc.request('mcpServerStatus/list',{threadId:this.threadId,cursor,limit:100,detail:'full'});check();
    if(!reply||!Array.isArray(reply.data)||reply.data.length>100||reply.nextCursor!==null&&!text(reply.nextCursor,4096))throw Error('服务目录分页不完整');
    for(const raw of reply.data){const value=mcpService(raw);if(names.has(value.name)||values.length>=128||values.reduce((n,v)=>n+v.tools.length,0)+value.tools.length>4096)throw Error('服务目录重复或过大');names.add(value.name);values.push(value);if(this.rpc.workspaceFiles&&raw.name===WORKSPACE_FILES_SERVER){try{assertWorkspaceCatalog(raw);workspaceCatalog=true;}catch{workspaceCatalog=false;}}}
    cursor=reply.nextCursor;if(!cursor)break;if(cursors.has(cursor))throw Error('服务目录游标重复');cursors.add(cursor);
   }
   mcp=values;
  }catch{check();errors.push('MCP 服务目录未完整核对；可主动重试');}
  try{
   check();const reply:any=await this.rpc.request('app/installed',{threadId:this.threadId,forceRefresh:false});check();
   apps=installedApps(reply);
  }catch{check();apps=null;errors.push('已安装应用快照不可用；未将未知状态当作没有应用');}
  check();const expected=[...DISABLED_MCP,...(this.rpc.workspaceFiles?[WORKSPACE_FILES_SERVER]:[])],mcpComplete=!!mcp&&expected.every(name=>mcp!.some(value=>value.name===name)),disabled=!!mcp&&DISABLED_MCP.every(name=>mcp!.some(v=>v.name===name&&v.runtime==='disabled'&&!v.catalogError&&!v.tools.length&&!v.resources&&!v.templates)),isolated=mcpComplete&&mcp!.length===DISABLED_MCP.length&&disabled,workspaceFiles=!!this.rpc.workspaceFiles&&mcpComplete&&mcp!.length===expected.length&&disabled&&workspaceCatalog;
  if(mcp&&!mcpComplete)errors.push('服务目录缺少配置项；当前仅为部分已知状态');
  if(mcp&&!isolated&&!workspaceFiles)errors.push('服务目录与当前连接的隔离设定不一致；未据此开放工具');
  this.value={threadId:this.threadId,revision,readAt:Date.now(),isolated,workspaceFiles,mcpComplete,mcp,apps,disabledPlugins:[...DISABLED_PLUGINS],errors};
 }
 async readApp(id:string,revision:number,current:()=>boolean){
  const source=this.value,installed=source?.apps?.find(app=>app.id===id),entry=source?.directory?.entries.find(app=>app.id===id),live=()=>this.value===source&&this.revision===revision&&current();
  if((!installed&&!entry?.accessible)||source?.revision!==revision||!live())throw Error('应用不在当前已核对的可访问快照中，请重新读取');
  const reply:any=await this.rpc.request('app/read',{threadId:this.threadId,appIds:[id],includeTools:true});if(!live())throw Error('应用工具回执来源已失效');
  if(!reply||!Array.isArray(reply.apps)||!Array.isArray(reply.missingAppIds)||reply.apps.length!==1||reply.missingAppIds.length||reply.apps[0]?.id!==id)throw Error('应用工具目录不可用，请重新读取快照');
  const raw=reply.apps[0];if(!text(raw.name)||raw.toolSummaries!==null&&(!Array.isArray(raw.toolSummaries)||raw.toolSummaries.length>512))throw Error('应用工具目录无法完整核对');
  const names=new Set<string>(),tools:ServiceTool[]=(raw.toolSummaries??[]).map((tool:any)=>{if(!tool||!text(tool.name)||tool.title!==null&&!text(tool.title)||typeof tool.isEnabled!=='boolean'||typeof tool.isReadOnly!=='boolean'||names.has(tool.name))throw Error('应用工具摘要字段未核对');names.add(tool.name);return{name:tool.name,title:tool.title,enabled:tool.isEnabled,readOnly:tool.isReadOnly};});
  const summaries=[...(source.apps??[]),...(source.directoryTools??[])];
  if(summaries.reduce((n,v)=>n+(v.id===id?0:v.tools?.length??0),0)+tools.length>4096)throw Error('公开工具摘要超过本次显示上限');
  const metadata={name:raw.name,tools,toolsKnown:raw.toolSummaries!==null};
  if(installed)Object.assign(installed,metadata);
  else source.directoryTools=[...(source.directoryTools??[]).filter(app=>app.id!==id),{id,enabled:false,callable:false,...metadata}];
 }
}
function installedApps(reply:any):AppService[]{
 if(!reply||!Array.isArray(reply.apps)||reply.apps.length>256)throw Error('应用快照不完整');const names=new Set<string>();
 return reply.apps.map((raw:any)=>{if(!raw||!text(raw.id)||typeof raw.enabled!=='boolean'||typeof raw.callable!=='boolean'||raw.runtimeName!==null&&!text(raw.runtimeName)||names.has(raw.id)||raw.callable&&!raw.enabled)throw Error('应用快照字段未核对');names.add(raw.id);return{id:raw.id,...(raw.runtimeName?{name:raw.runtimeName}:{}),enabled:raw.enabled,callable:raw.callable};});
}
