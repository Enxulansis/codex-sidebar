import type {PageHost} from '../page-host';import type {PageState} from '../page-model';import type {ServiceStatus} from '../service-status';
import {skillDependencySummary} from '../skill-dependencies';
import {WorkspaceFilesControl} from './workspace-files-control';
const runtime:Record<string,string>={notStarted:'尚未启动',starting:'连接中',connected:'已连接',authenticationRequired:'需要登录',failed:'连接失败',cancelled:'已取消',disabled:'已禁用'};
const auth:Record<string,string>={unknown:'未知',unsupported:'不支持认证',notLoggedIn:'未登录',bearerToken:'Token',oAuth:'OAuth'};
/** A read-only section of settings. It never resolves preference saves or edits the composer. */
export class ServiceStatusControl{
 readonly element=document.createElement('div');private state:PageState|undefined;private owner='';private value:ServiceStatus|undefined;
 private sequence=0;private valueRevision=0;private appRevision=0;private pending:{id:number;kind:string;timer:ReturnType<typeof setTimeout>}|undefined;private notice='';private signature='';private dead=false;
 private files:WorkspaceFilesControl;
 private focusAction:string|undefined;
 constructor(private host:PageHost){this.files=new WorkspaceFilesControl(host,()=>++this.sequence);this.element.id='service-status';this.element.style.overflowWrap='anywhere';host.messages.addEventListener('message',this.receive);this.render();}
 update(state:PageState){
  const owner=JSON.stringify([state.threadId,state.connectionId]),previous=this.state;
  if(owner!==this.owner){this.cancel();this.owner=owner;this.value=undefined;this.appRevision=state.appCatalogRevision??0;this.focusAction=undefined;this.notice='';}
  else if(previous&&(previous.serviceStatusRevision??0)!==(state.serviceStatusRevision??0)){this.cancel();this.notice='账户状态已变化；上次快照仅供查看，请重新读取';}
  else if(previous&&(previous.appCatalogRevision??0)!==(state.appCatalogRevision??0)&&(state.appCatalogRevision??0)>this.appRevision&&this.pending?.kind!=='directory'){this.cancel();this.notice='应用目录已变化；上次快照仅供查看，请重新读取';}
  this.state=state;if(!this.canRead()&&this.pending){this.cancel();this.notice='连接或会话状态已变化；请就绪后重新读取';}this.files.update(state,!!this.value?.workspaceFiles&&!this.notice);this.render();
 }
 private canRead(){const s=this.state;return !this.dead&&!!s?.ready&&!!s.serviceStatusAvailable&&!!s.threadId&&!s.operating&&!s.connecting;}
 private node(tag:string,content:string){const node=document.createElement(tag);node.textContent=content;return node;}
 private summary(content:string,key:string){const node=this.node('summary',content);node.dataset.serviceAction=key;return node;}
 private button(label:string,key:string,run:()=>void){const button=document.createElement('button');button.type='button';button.className='ds-trigger settings-action';button.dataset.serviceAction=key;button.textContent=label;button.disabled=!!this.pending||!this.canRead();button.onclick=run;return button;}
 private request(appId?:string,directory=false){
  const s=this.state;if(!s||!this.canRead()||this.pending||(appId||directory)&&(!this.value||this.notice))return;
  const id=++this.sequence,timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.cancel();this.notice='读取未确认，上次快照仅供查看；可主动重试';this.files.update(s,false);this.render();},directory?30000:20000);this.pending={id,kind:directory?'directory':appId?'app':'status',timer};this.notice='';this.render();
  try{this.host.postMessage({type:directory?'service-apps-list':appId?'service-app-read':'service-status-read',id,threadId:s.threadId,connectionId:s.connectionId,...(appId||directory?{...(appId?{appId}:{}),revision:this.value!.revision}:{})});}catch{this.cancel();this.notice='读取未提交，上次快照仅供查看；可主动重试';this.files.update(s,false);this.render();}
 }
 private render(){
  const s=this.state,v=this.value,skills=s?.skills,signature=JSON.stringify([this.owner,this.canRead(),this.valueRevision,!!this.pending,this.notice,skills?.generation,skills?.loading,skills?.complete,skills?.stale,skills?.error]);if(signature===this.signature)return;this.signature=signature;
  const active=document.activeElement instanceof HTMLElement&&this.element.contains(document.activeElement)?document.activeElement.dataset.serviceAction:undefined;
  if(active)this.focusAction=active;else if(document.activeElement!==document.body)this.focusAction=undefined;
  const expanded=new Set(Array.from(this.element.querySelectorAll<HTMLElement>('details[open] > summary[data-service-action]')).map(node=>node.dataset.serviceAction));
  const refresh=this.button(this.pending?'正在读取…':'读取当前状态','refresh',()=>this.request()),status=this.node('p',this.notice||(!this.canRead()?(v?'显示上次数据；请选择已连接会话':'请选择已连接的会话'):v?'更新于 '+new Date(v.readAt).toLocaleTimeString():'尚未读取'));status.className='settings-row-hint';status.setAttribute('role','status');
  const nodes:Node[]=[refresh,status];if(v){
   nodes.push(this.node('p','应用已关闭 · MCP '+(v.workspaceFiles?'仅工作区文件只读服务可用':v.isolated?'已禁用':'状态未确认')));
   if(v.workspaceFiles)nodes.push(this.files.element);
   for(const error of v.errors)nodes.push(this.node('p',error));nodes.push(this.node('h4','MCP 服务'));
   if(v.mcp===null)nodes.push(this.node('p','MCP 目录未知'));
   else {if(!v.mcpComplete)nodes.push(this.node('p','已读取 '+v.mcp.length+' 项服务，目录未完整'));for(const service of v.mcp){const details=document.createElement('details');details.open=expanded.has('mcp-summary:'+service.name);details.append(this.summary(service.name+' · '+(service.runtime?runtime[service.runtime]:'状态未知'),'mcp-summary:'+service.name),this.node('p','认证：'+auth[service.auth]+' · '+(service.catalogError?'工具 '+service.tools.length+'（列表未完整）':'工具 '+service.tools.length)+' · 资源 '+service.resources+' · 模板 '+service.templates));if(service.tools.length){const list=document.createElement('ul');for(const name of service.tools)list.append(this.node('li',name));details.append(list);}nodes.push(details);}}
   nodes.push(this.node('h4','Apps 目录'));
   const directoryButton=this.button(v.directory?'重新读取应用目录':'读取应用目录','apps-directory',()=>this.request(undefined,true));directoryButton.disabled ||= !!this.notice;nodes.push(directoryButton);
   nodes.push(this.node('p','本侧栏主动关闭应用调用；目录和公开工具摘要仅供查看。'));
   nodes.push(this.node('p',v.directory?'完整目录 '+v.directory.entries.length+' 项 · '+new Date(v.directory.readAt).toLocaleTimeString():'应用目录尚未读取'));
   if(v.apps===null)nodes.push(this.node('p','已安装应用快照未知'));
   else if(!v.apps.length)nodes.push(this.node('p','本次已安装快照未返回应用'));
   const ids=new Set([...(v.directory?.entries.map(app=>app.id)??[]),...(v.apps?.map(app=>app.id)??[])]);
   for(const id of ids){
    const entry=v.directory?.entries.find(app=>app.id===id),installed=v.apps?.find(app=>app.id===id),app=installed??v.directoryTools?.find(app=>app.id===id);
    const row=document.createElement('details');row.dataset.serviceApp=id;row.open=expanded.has('app-summary:'+id);
    row.append(this.summary((entry?.name||app?.name||id)+' · 本侧栏已关闭','app-summary:'+id),this.node('p','账户访问：'+(entry?(entry.accessible?'可访问':'未就绪（不等同于需要登录）'):'未确认')+' · 目录配置：'+(entry?(entry.enabled?'已启用':'已禁用'):'未确认')),this.node('p',installed?'运行快照：'+(installed.enabled?'已启用':'已禁用')+' · '+(installed.callable?'声明可调用':'声明不可调用'):v.apps===null?'运行快照未知':'未出现在已安装快照'));
    const button=this.button('查看公开工具','app:'+id,()=>this.request(id));button.disabled ||= !!this.notice||!installed&&!entry?.accessible;row.append(button);
    if(!installed&&!entry?.accessible)row.append(this.node('p','账户访问未就绪；当前不提供登录或启用操作'));
    if(app?.toolsKnown===false)row.append(this.node('p','公开工具摘要未知'));
    else if(app?.tools){const list=document.createElement('ul');for(const tool of app.tools)list.append(this.node('li',(tool.title||tool.name)+' · '+tool.name+' · 摘要'+(tool.enabled?'已启用':'已禁用')+' · '+(tool.readOnly?'声明只读':'可能修改数据')));if(!app.tools.length)list.append(this.node('li','本次公开摘要没有工具'));row.append(list);}nodes.push(row);
   }
   nodes.push(this.node('h4','已禁用插件'),this.node('p',v.disabledPlugins.join('；')));
  }
  nodes.push(this.node('h4','技能依赖'));
  if(!skills?.complete||skills.stale)nodes.push(this.node('p','技能列表未完整，请在 / 菜单刷新'));
  if(skills){const declared=skills.skills.filter(skill=>!!skillDependencySummary(skill));for(const skill of declared)nodes.push(this.node('p','/'+skill.name+'：'+skillDependencySummary(skill)));if(skills.complete&&!declared.length)nodes.push(this.node('p','未声明服务依赖'));}
  this.element.replaceChildren(...nodes);if(!this.pending&&this.focusAction){const button=Array.from(this.element.querySelectorAll<HTMLElement>('[data-service-action]')).find(node=>node.dataset.serviceAction===this.focusAction);this.focusAction=undefined;if(button&&!button.matches(':disabled'))button.focus({preventScroll:true});}
 }
 private receive=(event:MessageEvent)=>{const m=event.data,p=this.pending,s=this.state;if(m?.type!=='service-status-result'||!p||!s||m.id!==p.id||m.threadId!==s.threadId||m.connectionId!==s.connectionId)return;this.cancel(false);if(m.ok===true&&m.serviceStatusRevision===(s.serviceStatusRevision??0)&&Number.isSafeInteger(m.appCatalogRevision)&&m.appCatalogRevision>=(s.appCatalogRevision??0)&&m.value?.threadId===s.threadId&&Number.isSafeInteger(m.value.revision)){this.value=m.value;this.appRevision=m.appCatalogRevision;this.valueRevision++;this.notice='';}else this.notice=(m.error||'服务状态未确认')+'；上次快照仅供查看';this.files.update(s,!!this.value?.workspaceFiles&&!this.notice);this.render();};
 private cancel(notify=true){const pending=this.pending;clearTimeout(pending?.timer);this.pending=undefined;if(notify&&pending&&this.state)try{this.host.postMessage({type:'service-status-cancel',id:pending.id,threadId:this.state.threadId,connectionId:this.state.connectionId});}catch{}}
 close(){this.focusAction=undefined;this.files.close();if(this.pending){this.cancel();this.notice='已停止等待本次读取，可主动重试';this.render();}}
 dispose(){this.dead=true;this.cancel();this.files.dispose();this.host.messages.removeEventListener('message',this.receive);}
}
