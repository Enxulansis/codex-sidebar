import type {PageHost} from '../page-host';
import {pageContentReady,type PageSession,type PageState} from '../page-model';
import {showCopyMenu,closeStaleMathMenu} from './dsh-math-export';
import {codexMark} from './codex-mark';
import {tabActivity,nextCodexAnimation} from './codex-presence';
export function sessionTabSize(label:string,minimum=112){const min=Number.isSafeInteger(minimum)&&minimum>=68&&minimum<=200?minimum:112,maximum=Math.max(150,min);let text=0;for(const ch of label)text+=(ch.codePointAt(0)??0)>0x7f?12:6.5;return{width:Math.round(Math.max(min,Math.min(maximum,text+16))),maximum};}
export function sessionDropTarget(order:string[],source:string,target:string,after:boolean):{before?:string}|undefined{
 if(source===target||!order.includes(source)||!order.includes(target))return;
 const remaining=order.filter(id=>id!==source),index=remaining.indexOf(target)+(after?1:0),next=[...remaining.slice(0,index),source,...remaining.slice(index)];
 if(next.every((id,i)=>id===order[i]))return;const before=remaining[index];return before===undefined?{}:{before};
}

/** DSH 165 session-tab DOM, width calculation and reconciliation, with symmetric drop edges. */
export class SessionBar {
  private state:PageState|undefined;
  private nodes=new Map<string,HTMLDivElement>();
  private dragSource:string|undefined;
  private lastOrder='';
  private lastActive='';
  private readOwner='';
  private readEntered=false;
  private taskReadEntered=false;
  private readingVisible=true;
  private visibility:{connectionId:number;visible:boolean}|undefined;
  private sequence=0;
  private pending=0;
  private timer:ReturnType<typeof setTimeout>|undefined;private noticeTimer:ReturnType<typeof setTimeout>|undefined;
  private renameId='';
  private deleteTarget:{id:string;connectionId:number}|undefined;
  private menuKey='';
  private root=document.getElementById('sessionBar')!;
  private tabs=document.getElementById('sessionTabs')!;
  private menu=document.getElementById('recycleMenu')!;
  private rename=document.getElementById('renamePopup')!;
  private input=document.getElementById('renameInput') as HTMLInputElement;
  private renameStatus=document.getElementById('renameStatus')!;
  private deletePopup=document.getElementById('deletePopup')!;
  private notice=document.getElementById('sessionNotice')!;
  constructor(private host:PageHost,private callbacks:{select:(id:string)=>Promise<void>;create:()=>Promise<void>;restart:()=>void}){
    const refresh=document.getElementById('refreshSessions')!;refresh.title='刷新会话列表';refresh.innerHTML='<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.1 6"/><path d="M20 4v7h-7"/></svg>';
    const connect=document.getElementById('reconnectSession')!,indicator=document.createElement('span'),label=document.createElement('span');indicator.className='connection-led';indicator.setAttribute('aria-hidden','true');label.className='connect-label';connect.replaceChildren(indicator,label);
    document.getElementById('newSession')!.onclick=()=>void callbacks.create();
    document.getElementById('refreshSessions')!.onclick=()=>this.list(false);
    document.getElementById('reconnectSession')!.onclick=()=>callbacks.restart();
    document.getElementById('moreSessions')!.onclick=()=>this.list(true);
    document.getElementById('sessionSort')!.onchange=event=>this.post({type:'thread-sort',sort:(event.target as HTMLSelectElement).value});
    document.getElementById('recycleSession')!.onclick=()=>{
      if(!this.menu.hidden){this.closeRecycle();return;}this.menu.hidden=false;document.getElementById('recycleSession')!.setAttribute('aria-expanded','true');this.renderRecycle();this.list(false,true);
    };
    document.getElementById('renameCancel')!.onclick=()=>this.closeRename();
    document.getElementById('renameOk')!.onclick=()=>{if(this.renameUnavailable()){this.syncRename();return;}const name=this.input.value.trim();if(!name){this.renameStatus.textContent='会话名称须为1–80个字符';this.renameStatus.hidden=false;return;}if(this.manage('rename',this.renameId,name))this.closeRename();};
    this.input.addEventListener('keydown',event=>{if(event.isComposing)return;if(event.key==='Enter'){event.preventDefault();document.getElementById('renameOk')!.click();}if(event.key==='Escape'){event.preventDefault();this.closeRename();}});
    document.getElementById('deleteCancel')!.onclick=()=>this.closeDelete();document.getElementById('deleteOk')!.onclick=()=>{const target=this.deleteTarget;this.closeDelete();if(target&&this.state?.connectionId===target.connectionId&&!this.locked()&&this.state.sessionCatalog?.recycle.some(value=>value.id===target.id&&!value.pending))this.manage('delete',target.id);};
    document.addEventListener('click',this.outside);document.addEventListener('keydown',this.key);
    this.tabs.addEventListener('wheel',event=>{
      if(!event.deltaY)return;const unit=event.deltaMode===1?16:event.deltaMode===2?window.innerHeight:1,max=this.tabs.scrollWidth-this.tabs.clientWidth;
      if(max<=0)return;const previous=this.tabs.scrollLeft,next=Math.min(max,Math.max(0,previous+event.deltaY*unit));this.tabs.scrollLeft=next;if(next!==previous)event.preventDefault();
    },{passive:false});
    this.tabs.addEventListener('dragover',event=>{if(this.dragSource!==undefined){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';if(!(event.target as Element).closest('.session-tab'))this.clearDrop();}});
    this.tabs.addEventListener('drop',event=>{if(this.dragSource===undefined)return;event.preventDefault();event.stopPropagation();if(!this.sortLocked()&&!(event.target as Element).closest('.session-tab'))this.post({type:'thread-reorder',threadId:this.dragSource});this.clearDrag();});
    host.messages.addEventListener('message',this.receive);
    window.addEventListener('pagehide',()=>{clearTimeout(this.timer);host.messages.removeEventListener('message',this.receive);document.removeEventListener('click',this.outside);document.removeEventListener('keydown',this.key);},{once:true});
  }
  private post(message:object){this.host.postMessage({...message,connectionId:this.state?.connectionId});}
  private list(more:boolean,archived=false){if(this.state?.ready)this.post({type:'thread-list',more,archived});}
  private locked(){return !this.state?.ready||this.state.threadManagementAvailable===false||this.state.busy||this.state.operating||!!this.pending;}
  private selectionLocked(){return !pageContentReady(this.state)||this.state?.busy||this.state?.operating||!!this.pending;}
  private sortLocked(){return !this.state||this.state.busy||this.state.operating||!!this.pending;}
  private manage(action:string,id:string,name?:string,automatic=false){
    if(this.locked()||!id)return false;
    const idNumber=++this.sequence;this.pending=idNumber;this.notice.textContent=this.state?.dispatchMode==='daily'?'':'正在保存会话操作…';
    this.timer=setTimeout(()=>{if(this.pending!==idNumber)return;this.pending=0;this.notice.textContent='操作回执未确认；请刷新核对，不要重复提交';if(this.state)this.render(this.state);},30000);
    this.post(action==='read'||action==='unread'?{type:'thread-read-state',id:idNumber,threadId:id,unread:action==='unread',...(automatic?{automatic:true}:{})}:{type:'thread-manage',id:idNumber,threadId:id,action,...(name?{name}:{})});
    if(this.state)this.render(this.state);
    return true;
  }
  private renameUnavailable(){
    const state=this.state;
    if(!state?.ready)return '连接暂不可用；已保留名称，可连接恢复后确认';
    if(state.threadManagementAvailable===false)return '当前会话管理不可用；已保留名称';
    if(state.busy)return '会话正在运行；已保留名称，运行完成后可确认';
    if(state.operating||this.pending)return '会话操作尚未完成；已保留名称，完成后可确认';
    const target=state.sessionCatalog?.sessions.find(value=>value.id===this.renameId);
    if(!target)return '此会话已不在当前目录；可取消并刷新核对';
    if(target.pending)return '上次会话操作结果待核对；已保留名称，请先刷新';
    return '';
  }
  private syncRename(){if(this.rename.hidden)return;const reason=this.renameUnavailable(),button=document.getElementById('renameOk') as HTMLButtonElement;button.disabled=!!reason;button.title=reason;this.renameStatus.textContent=reason;this.renameStatus.hidden=!reason;}
  private managedSession(id:string){return this.state?.offlinePreview||this.locked()?undefined:this.state?.sessionCatalog?.sessions.find(value=>value.id===id&&!value.pending);}
  private openRename(id:string){const current=this.managedSession(id);if(!current)return;this.closeRecycle();this.closeDelete(false);this.renameId=current.id;this.input.value=current.title.slice(0,80);this.rename.hidden=false;this.syncRename();this.input.focus();this.input.select();}
  private openMenu(id:string,event:MouseEvent){
    const connectionId=this.state?.connectionId,unread=this.managedSession(id)?.unread===true,valid=()=>this.state?.connectionId===connectionId&&!!this.managedSession(id)&&(this.managedSession(id)?.unread===true)===unread&&!!this.nodes.get(id)?.isConnected;
    if(!valid())return;this.closeRename();this.closeDelete(false);this.closeRecycle();
    showCopyMenu(event,valid,[{label:'重命名…',run:async()=>this.openRename(id)},{label:unread?'标记为已读':'标记为未读',run:async()=>{this.manage(unread?'read':'unread',id);}},{label:'归档（移入回收站）',run:async()=>{this.manage('archive',id);}}],valid,()=>this.nodes.get(id)?.focus({preventScroll:true}));
  }
  private enteredRead(){
    const state=this.state,threadId=state?.threadId,owner=JSON.stringify([state?.connectionId,threadId]);if(owner!==this.readOwner){this.readOwner=owner;this.readEntered=false;this.taskReadEntered=false;}
    const task=state?.sessionCatalog?.sessions.find(value=>value.id===threadId)?.unreadSource==='task';if(!task)this.taskReadEntered=false;
    if(!state||this.readingVisible===false||this.readEntered&&(!task||this.taskReadEntered)||this.locked()||state.offlinePreview||state.needsRecovery||!state.toolCheck?.verified||state.toolCheck.threadId!==state.threadId)return;
    this.readEntered=true;this.taskReadEntered=task;if(!threadId||!this.managedSession(threadId)?.unread)return;
    queueMicrotask(()=>{if(this.readingVisible!==false&&this.readOwner===owner&&this.state?.threadId===threadId&&!this.locked()&&!this.state.needsRecovery)this.manage('read',threadId,undefined,true);});
  }
  private closeRename(){const tab=this.nodes.get(this.renameId),restore=!this.rename.hidden&&this.rename.contains(document.activeElement);this.rename.hidden=true;this.renameId='';if(restore&&tab?.isConnected)tab.focus({preventScroll:true});}
  private readingVisibility(visible:boolean){this.readingVisible=visible;if(!visible){this.readEntered=false;this.taskReadEntered=false;}else this.enteredRead();}
  private closeRecycle(){this.menu.hidden=true;document.getElementById('recycleSession')!.setAttribute('aria-expanded','false');}
  private openDelete(id:string){if(this.locked()||!this.state?.sessionCatalog?.recycle.some(value=>value.id===id&&!value.pending))return;this.closeRename();this.deleteTarget={id,connectionId:this.state.connectionId};this.deletePopup.hidden=false;document.getElementById('deleteCancel')!.focus();}
  private closeDelete(restoreFocus=true){const open=!this.deletePopup.hidden;this.deletePopup.hidden=true;this.deleteTarget=undefined;if(restoreFocus&&open){this.closeRecycle();document.getElementById('recycleSession')!.focus();}}
  private outside=(event:MouseEvent)=>{const target=event.target as Element;if(!document.getElementById('recycleWrap')!.contains(target))this.closeRecycle();if(!this.rename.contains(target)&&!target.closest?.('.tab-action'))this.closeRename();if(!this.deletePopup.contains(target))this.closeDelete(false);};
  private key=(event:KeyboardEvent)=>{if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.key!=='Escape')return;if(!this.deletePopup.hidden){event.preventDefault();event.stopPropagation();this.closeDelete();}else if(!this.menu.hidden){event.preventDefault();this.closeRecycle();document.getElementById('recycleSession')!.focus();}};
  private clearDrop(){for(const node of this.nodes.values()){node.classList.remove('drag-over');delete node.dataset.dropSide;}}
  private clearDrag(){this.dragSource=undefined;this.clearDrop();for(const node of this.nodes.values())node.classList.remove('drag-source');}
  private dropTarget(tab:HTMLElement,x:number){const rect=tab.getBoundingClientRect(),after=x>=rect.left+rect.width/2;return{after,target:this.dragSource===undefined?undefined:sessionDropTarget(this.state?.sessionCatalog?.sessions.map(s=>s.id)??[],this.dragSource,tab.dataset.sessionId!,after)};}
  private build(session:PageSession){
    const tab=document.createElement('div');tab.className='session-tab';tab.setAttribute('role','tab');tab.setAttribute('aria-haspopup','menu');tab.tabIndex=0;tab.draggable=true;tab.dataset.sessionId=session.id;
    const title=document.createElement('span');title.className='tab-title';const actions=document.createElement('span');actions.className='tab-actions';
    for(const [label,kind]of [['✎','rename'],['✕','archive']]){
      const button=document.createElement('button');button.type='button';button.className='tab-action'+(kind==='archive'?' danger':'');button.dataset.action=kind;button.textContent=label!;button.title=kind==='rename'?'重命名':'移入回收站（Codex归档）';button.setAttribute('aria-label',button.title);
      button.onclick=event=>{event.stopPropagation();if(!this.managedSession(session.id))return;if(kind==='rename')this.openRename(session.id);else this.manage('archive',session.id);};actions.append(button);
    }
    const run=document.createElement('span');run.className='tab-run';run.hidden=true;run.setAttribute('aria-hidden','true');run.append(codexMark());
    run.onanimationiteration=event=>{if(run.dataset.activity==='working'&&event.target===run.querySelector('svg>path:last-child'))run.dataset.animation=nextCodexAnimation(run.dataset.animation);};
    tab.append(run,title,actions);tab.onclick=()=>{if(this.selectionLocked()||tab.getAttribute('aria-disabled')==='true')return;if(this.state?.threadId===session.id&&this.state.toolCheck?.verified&&!this.state.needsRecovery&&this.managedSession(session.id)?.unread)this.manage('read',session.id);else void this.callbacks.select(session.id);};
    tab.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();this.openMenu(session.id,event);};
    tab.onkeydown=event=>{if(event.target!==tab||event.isComposing||event.keyCode===229)return;if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();const rect=tab.getBoundingClientRect();this.openMenu(session.id,new MouseEvent('contextmenu',{clientX:rect.left,clientY:rect.bottom}));}else if(event.key==='Enter'||event.key===' '){event.preventDefault();tab.click();}};
    tab.ondragstart=event=>{if(this.sortLocked()||tab.getAttribute('aria-disabled')==='true'){event.preventDefault();return;}this.dragSource=session.id;tab.classList.add('drag-source');if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',session.id);}};
    tab.ondragover=event=>{if(this.dragSource===undefined||this.sortLocked())return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';this.clearDrop();const{after,target}=this.dropTarget(tab,event.clientX);if(target){tab.classList.add('drag-over');tab.dataset.dropSide=after?'after':'before';}};
    tab.ondragleave=event=>{if(event.relatedTarget instanceof Node&&tab.contains(event.relatedTarget))return;tab.classList.remove('drag-over');delete tab.dataset.dropSide;};tab.ondragend=()=>this.clearDrag();
    tab.ondrop=event=>{event.preventDefault();event.stopPropagation();const{target}=this.dropTarget(tab,event.clientX);if(!this.sortLocked()&&this.dragSource!==undefined&&target)this.post({type:'thread-reorder',threadId:this.dragSource,...target});this.clearDrag();};
    return tab;
  }
  private render(state:PageState){
    const previousConnection=this.state?.connectionId;this.state=state;
    if(this.visibility?.connectionId===state.connectionId){this.readingVisible=this.visibility.visible;if(!this.readingVisible){this.readEntered=false;this.taskReadEntered=false;}}
    if(previousConnection!==undefined&&previousConnection!==state.connectionId){clearTimeout(this.timer);this.pending=0;this.closeRename();this.closeDelete(false);this.closeRecycle();this.clearDrag();}
    closeStaleMathMenu();
    this.root.setAttribute('aria-busy',String(!!this.pending));
    this.syncRename();
    if(this.deleteTarget&&(this.locked()||!state.sessionCatalog?.recycle.some(value=>value.id===this.deleteTarget!.id&&!value.pending)))this.closeDelete(false);
    if(this.sortLocked())this.clearDrag();
    const catalog=state.sessionCatalog;this.root.hidden=!catalog;this.root.dataset.nativeToolbar=String(state.dispatchMode==='daily');document.getElementById('legacy-thread-nav')!.hidden=!!catalog;
    if(!catalog)return;
    const seen=new Set(catalog.sessions.map(v=>v.id)),added=catalog.sessions.filter(v=>!this.nodes.has(v.id));
    for(const[id,node]of this.nodes)if(!seen.has(id)){node.remove();this.nodes.delete(id);}
    const order=catalog.sessions.map(v=>v.id).join(','),moved=order!==this.lastOrder;
    for(const value of catalog.sessions){
      let node=this.nodes.get(value.id);if(!node){node=this.build(value);this.nodes.set(value.id,node);}
      if(moved||node.parentNode!==this.tabs){if(node.parentNode===this.tabs&&typeof this.tabs.moveBefore==='function')this.tabs.moveBefore(node,null);else this.tabs.append(node);}
      const label=value.title||'新会话',title=node.querySelector('.tab-title')!;if(title.textContent!==label)title.textContent=label;
      const size=sessionTabSize(label,state.copySettings?.sessionTabMinWidth);node.style.width=size.width+'px';node.style.maxWidth=size.maximum+'px';
      node.classList.toggle('active',value.id===state.threadId);node.setAttribute('aria-selected',String(value.id===state.threadId));
      const activity=tabActivity(state,value.id),run=node.querySelector<HTMLElement>('.tab-run')!;if(activity.mode==='working'&&run.dataset.activity!=='working')run.dataset.animation=nextCodexAnimation(run.dataset.animation);run.hidden=activity.mode==='idle';run.dataset.activity=activity.mode;run.title=activity.label;node.classList.toggle('has-activity',activity.mode!=='idle');
      node.classList.toggle('unread',value.unread===true);node.setAttribute('aria-label',label+(value.unread?'，未读':'')+(activity.label?'，'+activity.label:''));
      const disabled=!!this.selectionLocked()||!!value.pending;node.setAttribute('aria-disabled',String(disabled));node.title=label+(value.pending?this.pending?'\n正在保存会话操作…':'\n上次操作结果待核对':!value.observed?'\n保存状态尚未核对':'')+'\n'+value.id;
      const showRename=state.copySettings?.sessionTabRenameButton!==false,showArchive=state.copySettings?.sessionTabArchiveButton!==false;
      (node.querySelector('.tab-actions') as HTMLElement).hidden=state.offlinePreview===true||!showRename&&!showArchive;
      for(const button of node.querySelectorAll<HTMLButtonElement>('.tab-action')){button.hidden=button.dataset.action==='rename'?!showRename:!showArchive;button.disabled=!!this.locked()||!!value.pending;}
    }
    this.lastOrder=order;
    if(this.lastActive!==state.threadId||added.length){
      const node=this.nodes.get(state.threadId)??this.nodes.get(added[0]?.id??'');
      if(node){const strip=this.tabs.getBoundingClientRect(),rect=node.getBoundingClientRect();if(rect.left<strip.left+8)this.tabs.scrollLeft+=rect.left-strip.left-8;else if(rect.right>strip.right-8)this.tabs.scrollLeft+=rect.right-strip.right+8;}
    }
    this.lastActive=state.threadId;
    (document.getElementById('newSession') as HTMLButtonElement).disabled=!!this.locked();
    const sort=document.getElementById('sessionSort') as HTMLSelectElement;sort.disabled=!!this.sortLocked();sort.title='仅改变本地会话排列；手动排序时可拖动标签';
    (document.getElementById('sessionSort') as HTMLSelectElement).value=catalog.sort;
    (document.getElementById('refreshSessions') as HTMLButtonElement).disabled=this.locked()||catalog.loading;document.getElementById('refreshSessions')!.setAttribute('aria-busy',String(catalog.loading));
    (document.getElementById('reconnectSession') as HTMLButtonElement).disabled=!!state.connecting||(state.busy&&!state.approvals.length&&!state.userInputs?.length);
    const connect=document.getElementById('reconnectSession')!,label=state.connecting?'连接中…':state.ready?'重新连接':'连接 Codex';connect.querySelector('.connect-label')!.textContent=label;connect.classList.toggle('connecting',!!state.connecting);connect.classList.toggle('connected',state.ready);connect.title=state.ready?'重新连接 Codex；不会自动重发':'连接 Codex；不会自动发送';connect.setAttribute('aria-label',label);connect.setAttribute('aria-busy',String(!!state.connecting));
    (document.getElementById('recycleSession') as HTMLButtonElement).disabled=this.locked();
    for(const id of ['newSession','refreshSessions','recycleWrap','reconnectSession'])document.getElementById(id)!.hidden=state.offlinePreview===true;
    if(state.threadManagementAvailable===false){document.getElementById('newSession')!.title='未配置发送额度，不能新建运行线程；可使用离线交互体验';document.getElementById('refreshSessions')!.title='没有本插件拥有的真实会话；不会读取其他客户端历史';document.getElementById('recycleSession')!.title='没有可管理的本插件会话';}
    const more=document.getElementById('moreSessions') as HTMLButtonElement;more.hidden=!catalog.hasMore;more.disabled=catalog.loading;
    const count=document.getElementById('recycleCount')!;count.textContent=String(catalog.recycle.length);count.hidden=!catalog.recycle.length;
    if(catalog.error)this.notice.textContent=catalog.error;
    if(!this.menu.hidden)this.renderRecycle();
    this.enteredRead();
  }
  private renderRecycle(){
    const catalog=this.state?.sessionCatalog;if(!catalog)return;
    const key=JSON.stringify([catalog.recycle,catalog.loading,catalog.error,catalog.recycleHasMore,this.pending]);if(key===this.menuKey)return;this.menuKey=key;
    this.menu.replaceChildren();const heading=document.createElement('div');heading.className='ds-group';heading.textContent=catalog.recycle.some(v=>v.localOnly)?'回收站 · Codex归档与未保存的空会话':'回收站 · Codex归档（不会自动永久删除）';this.menu.append(heading);
    for(const value of catalog.recycle){
      const row=document.createElement('div');row.className='ds-option';const label=document.createElement('span');label.className='ds-option-title';label.textContent=value.title;label.title=value.id+(value.localOnly?'\n无已保存的Codex历史；本地草稿仍保留':'');row.append(label);
      for(const [name,action]of [[value.localOnly?'查看草稿':'恢复','unarchive'],['永久删除','delete']]){const button=document.createElement('button');button.type='button';button.className='tab-action';button.textContent=action==='delete'?'✕':'↶';button.title=name!;button.setAttribute('aria-label',name!);button.disabled=this.locked()||!!value.pending;button.onclick=event=>{event.stopPropagation();if(action==='delete')this.openDelete(value.id);else this.manage(action!,value.id);};row.append(button);}
      this.menu.append(row);
    }
    if(!catalog.recycle.length){const empty=document.createElement('div');empty.className='ds-group';empty.textContent=catalog.loading?'正在读取已归档会话…':'当前已核对列表中没有回收会话';this.menu.append(empty);}
    const note=document.createElement('div');note.className='ds-group';note.textContent=catalog.loading?'正在核对公开目录…':catalog.recycleHasMore?'列表未完整；可继续读取':'仅列本任务拥有的当前项目会话';this.menu.append(note);
    if(catalog.recycleHasMore){const more=document.createElement('button');more.textContent='加载更多';more.disabled=catalog.loading;more.onclick=()=>this.list(true,true);this.menu.append(more);}
  }
  private receive=(event:MessageEvent)=>{
    const message=event.data;if(message?.type==='state')this.render(message.state);
    if(message?.type==='session-visibility'&&Number.isSafeInteger(message.connectionId)&&message.connectionId>=0&&typeof message.visible==='boolean'){this.visibility={connectionId:message.connectionId,visible:message.visible};if(message.connectionId===this.state?.connectionId)this.readingVisibility(message.visible);return;}
    if(message?.type==='session-toolbar'&&message.connectionId===this.state?.connectionId&&this.state?.dispatchMode==='daily'&&!this.state.offlinePreview){
      if(message.action==='refresh')(document.getElementById('refreshSessions') as HTMLButtonElement).click();
      else if(message.action==='reconnect')(document.getElementById('reconnectSession') as HTMLButtonElement).click();
      else if(message.action==='sort'&&['persisted','activity'].includes(message.sort)&&!this.sortLocked())this.post({type:'thread-sort',sort:message.sort});
      return;
    }
    if(message?.type==='display-settings'&&typeof message.ok==='boolean'&&message.copySettings&&this.state)this.render({...this.state,copySettings:message.copySettings});
    if(message?.type!=='thread-result'||message.id!==this.pending||message.connectionId!==this.state?.connectionId)return;
    clearTimeout(this.timer);this.pending=0;
    const notice=message.cancelled?'':message.cleanupPending?'历史删除已确认；本地视图清理待重试':message.ok?this.state?.dispatchMode==='daily'?'':'会话操作已确认':message.unknown?'结果待核对；请刷新，未自动重试':message.error||'会话操作失败';
    this.notice.textContent=notice;clearTimeout(this.noticeTimer);
    if(notice&&!message.error&&!message.unknown)this.noticeTimer=setTimeout(()=>{if(this.notice.textContent===notice)this.notice.textContent='';},4000);
    if(this.state)this.render(this.state);
  };
}
