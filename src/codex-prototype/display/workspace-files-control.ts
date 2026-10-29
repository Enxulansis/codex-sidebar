import type {PageHost} from '../page-host';import type {PageState} from '../page-model';
import {fileArguments,checkedFileResult,type WorkspaceFileTool} from '../workspace-files-contract';
/** File contents stay in this settings section; never append to the composer or journal. */
export class WorkspaceFilesControl{
 readonly element=document.createElement('section');private state?:PageState;private enabled=false;private owner='';
 private pending:{id:number;tool:WorkspaceFileTool;args:{path:string;startLine?:number};timer:ReturnType<typeof setTimeout>}|undefined;
 private path=document.createElement('input');private line=document.createElement('input');private status=document.createElement('p');private result=document.createElement('pre');private buttons:HTMLButtonElement[]=[];private stop=document.createElement('button');
 constructor(private host:PageHost,private nextId:()=>number){
  this.element.dataset.workspaceFiles='';const title=document.createElement('h4');title.textContent='工作区文件 · 只读';
  const hint=document.createElement('p');hint.className='settings-row-hint';hint.textContent='仅当前项目。隐藏路径、node_modules、链接和二进制文件不在读取范围内。每次最多 100 项或 200 行。';
  const label=document.createElement('label');label.textContent='相对路径';this.path.value='.';this.path.placeholder='例如 src/main.ts';this.path.className='ds-input';this.path.setAttribute('aria-label','项目相对路径');label.append(this.path);
  const start=document.createElement('label');start.textContent='起始行';this.line.type='number';this.line.min='1';this.line.value='1';this.line.className='ds-input';this.line.setAttribute('aria-label','读取起始行');start.append(this.line);
  const actions=document.createElement('div');actions.className='settings-actions';
  for(const [tool,text]of [['list_files','列出目录'],['read_file','读取文本']] as const){const button=document.createElement('button');button.type='button';button.className='ds-trigger settings-action';button.dataset.fileAction=tool;button.textContent=text;button.onclick=()=>this.request(tool);actions.append(button);this.buttons.push(button);}
  this.stop.type='button';this.stop.className='ds-trigger settings-action';this.stop.textContent='停止等待';this.stop.onclick=()=>this.close();actions.append(this.stop);
  this.status.className='settings-row-hint';this.status.setAttribute('role','status');this.result.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto';this.result.tabIndex=0;this.result.setAttribute('aria-label','文件读取结果');
  this.element.append(title,hint,label,start,actions,this.status,this.result);host.messages.addEventListener('message',this.receive);this.sync();
 }
 update(state:PageState,enabled:boolean){const owner=JSON.stringify([state.threadId,state.connectionId]);if(owner!==this.owner){this.cancel();this.result.textContent='';this.status.textContent='';this.owner=owner;}this.state=state;this.enabled=enabled;if(!this.usable()&&this.pending)this.close();this.sync();}
 private usable(){return this.enabled&&!!this.state?.ready&&!!this.state.serviceStatusAvailable&&!this.state.connecting&&!this.state.operating&&!!this.state.threadId;}
 private sync(){for(const b of this.buttons)b.disabled=!!this.pending||!this.usable();this.path.disabled=this.line.disabled=!!this.pending;this.stop.hidden=!this.pending;}
 private request(tool:WorkspaceFileTool){
  if(!this.usable()||this.pending)return;let args:{path:string;startLine?:number};
  try{args=fileArguments(tool,{path:this.path.value,...(tool==='read_file'?{startLine:Number(this.line.value)}:{})});}catch{this.status.textContent='请输入有效的项目相对路径和起始行';return;}
  const id=this.nextId(),timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.cancel();this.status.textContent='读取未确认，已停止等待；可主动重试';this.sync();},20000);
  this.pending={id,tool,args,timer};this.result.textContent='';this.status.textContent='正在读取…';this.sync();
  try{this.host.postMessage({type:'service-files-read',id,threadId:this.state!.threadId,connectionId:this.state!.connectionId,tool,arguments:args});}catch{this.cancel();this.status.textContent='读取未提交；可主动重试';this.sync();}
 }
 private receive=(event:MessageEvent)=>{const m=event.data,p=this.pending,s=this.state;if(m?.type!=='service-files-result'||!p||!s||m.id!==p.id||m.threadId!==s.threadId||m.connectionId!==s.connectionId)return;clearTimeout(p.timer);this.pending=undefined;
  try{if(m.ok!==true){this.status.textContent=typeof m.error==='string'?m.error:'读取失败；可主动重试';return;}const value=checkedFileResult(m.value,p.tool,p.args);this.result.textContent=value.kind==='directory'?value.entries.map(e=>(e.kind==='directory'?'目录  ':'文件  ')+e.name).join('\n')||'目录为空':value.text;
   this.status.textContent=value.truncated?'读取不完整：'+(value.kind==='text'?'可将起始行改为 '+value.nextLine+' 继续读取':'条目达到上限，请缩小目录范围'):'读取完成 · '+value.path;
  }catch{this.result.textContent='';this.status.textContent='读取回执未确认；可主动重试';}finally{this.sync();}
 };
 private cancel(){if(this.pending){clearTimeout(this.pending.timer);try{this.host.postMessage({type:'service-files-cancel',id:this.pending.id,threadId:this.state?.threadId,connectionId:this.state?.connectionId});}catch{}this.pending=undefined;}}
 close(){if(this.pending){this.cancel();this.status.textContent='已停止等待，迟到结果不会显示；服务端读取可能继续';this.sync();}}
 dispose(){this.cancel();this.host.messages.removeEventListener('message',this.receive);}
}
