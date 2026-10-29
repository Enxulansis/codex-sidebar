import type {PageHost} from '../page-host';
import type {PageState} from '../page-model';
import {hasDispatchCapacity} from '../composer-reasons';
export function busySubmitMode(preference:unknown,alternate:boolean):'queue'|'steer'{const mode=preference==='steer'?'steer':'queue';return alternate?(mode==='queue'?'steer':'queue'):mode;}
/** Original queue dock and inline editor, backed by an explicitly local queue. */
export class QueuePanel{
 private state:PageState|undefined;private owner='';private sequence=0;private pending:{id:number;action:string;timer:ReturnType<typeof setTimeout>}|undefined;private blocked=false;private notice='';private editing:{id:string;text:string;row?:HTMLElement}|undefined;private signature='';
 private dock=document.createElement('section');private queued=document.createElement('button');private steer=document.createElement('button');private composing=false;
 private preference:'queue'|'steer'='queue';
 constructor(private host:PageHost,private prompt:HTMLTextAreaElement,composer:HTMLElement,private canSubmit:(mode:'queue'|'steer')=>boolean,private submit:(mode:'queue'|'steer')=>void,private unavailable:(mode:'queue'|'steer')=>string=()=> ''){
  this.dock.id='queueDock';this.dock.className='queue-dock';this.dock.hidden=true;this.dock.setAttribute('aria-label','本插件本地待发送队列');composer.before(this.dock);
  this.queued.id='queueSend';this.queued.textContent='排队发送';this.queued.title='当前回合结束后发送';this.steer.id='steerSend';this.steer.textContent='立即插话';this.steer.title='引导当前回合（Ctrl/Cmd+Enter）';for(const button of [this.queued,this.steer]){button.type='button';button.className='queue-action composer-submit-mode';button.hidden=true;button.disabled=true;composer.querySelector('.prototype-run-actions')!.prepend(button);}this.queued.onclick=()=>this.submit('queue');this.steer.onclick=()=>this.submit('steer');
  prompt.addEventListener('keydown',this.key,true);prompt.addEventListener('compositionstart',this.start);prompt.addEventListener('compositionend',this.end);host.messages.addEventListener('message',this.receive);window.addEventListener('pagehide',this.dispose,{once:true});
 }
 configure(preference:unknown){this.preference=preference==='steer'?'steer':'queue';this.refresh();}
 refresh(){const state=this.state;this.queued.hidden=!state?.localQueue||!state.busy&&!state.localQueue.items.length;this.steer.hidden=!state?.localQueue||!state.busy;this.queued.disabled=!!this.pending||this.blocked||!this.canSubmit('queue');this.steer.disabled=!!this.pending||this.blocked||!this.canSubmit('steer');this.queued.title=`当前回合结束后发送（${this.preference==='queue'?'Enter':'Ctrl/Cmd+Enter'}）`;this.steer.title=`引导当前回合（${this.preference==='steer'?'Enter':'Ctrl/Cmd+Enter'}）`;for(const [button,mode]of [[this.queued,'queue'],[this.steer,'steer']]as const)if(button.disabled)button.title=this.pending?'正在确认队列操作…':this.blocked?this.notice:this.unavailable(mode)||button.title;}
 private action(action:string,itemId='',text=''){if(this.pending||this.blocked&&action!=='read'||!this.state)return;const id=++this.sequence,timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.pending=undefined;this.blocked=true;this.notice='队列操作未确认；重新核对后才能继续修改，未自动重试';this.signature='';this.render();},5000);this.pending={id,action,timer};this.host.postMessage({type:'queue-action',id,action,itemId,text,expectedTurnId:this.state.localQueue?.steerTurnId,threadId:this.state.threadId,connectionId:this.state.connectionId});this.signature='';this.render();}
 private button(label:string,run:()=>void,disabled=false){const button=document.createElement('button');button.type='button';button.className='queue-action';button.textContent=label;button.disabled=disabled||!!this.pending||this.blocked||!!this.state?.localQueue?.blocked;button.onclick=run;return button;}
 private render(){
  const s=this.state,q=s?.localQueue;this.refresh();this.dock.hidden=!q||!q.items.length&&!this.notice&&!q.reason;if(!q||this.dock.hidden)return;
  if(this.editing&&!q.items.some(v=>v.id===this.editing!.id&&v.status==='queued'))this.editing=undefined;
  const signature=JSON.stringify([q,s.busy,s.ready,s.operating,s.needsRecovery,s.used,s.limit,this.pending?.id,this.blocked,this.notice,this.editing?.id]);if(this.signature===signature)return;this.signature=signature;
  const nodes:HTMLElement[]=[],head=document.createElement('div'),title=document.createElement('span');head.className='queue-head';title.className='queue-title';title.textContent=`≡ 本地排队 ${q.items.length} 条${q.paused?' · 已暂停':''}`;
  head.append(title,this.button(q.paused?'继续发送':'暂停',()=>this.action(q.paused?'resume':'pause'),!s.ready||!!s.operating||!!s.needsRecovery||q.paused&&(!hasDispatchCapacity(s)||q.items.some(v=>v.status!=='queued'))));
  const read=this.button('重新核对',()=>this.action('read'));read.disabled=!!this.pending;head.append(read);nodes.push(head);
  const reason=document.createElement('div');reason.className='queue-notice';reason.setAttribute('role','status');reason.textContent=this.notice||q.reason||'';reason.hidden=!reason.textContent;nodes.push(reason);
  for(const item of q.items){
   if(this.editing?.id===item.id){
    const editing=this.editing;
    if(!editing.row){
     const row=document.createElement('div'),editor=document.createElement('textarea');row.className='queue-row';row.dataset.queueId=item.id;editor.className='queue-editor';editor.value=editing.text;editor.maxLength=20000;editor.rows=1;editor.setAttribute('aria-label','编辑排队消息');
     const save=this.button('保存',()=>{if(editor.value.trim())this.action('edit',item.id,editor.value);}),cancel=this.button('取消',()=>{this.editing=undefined;this.signature='';this.render();});
     editor.oninput=()=>{if(this.editing!==editing)return;editing.text=editor.value;save.disabled=!editor.value.trim()||!!this.pending||this.blocked||!!this.state?.localQueue?.blocked;};
     editor.onkeydown=event=>{if(event.isComposing||event.keyCode===229)return;if(event.key==='Escape'){event.preventDefault();cancel.click();}else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();save.click();}};
     row.append(editor,save,cancel);editing.row=row;requestAnimationFrame(()=>{if(this.editing===editing&&editor.isConnected){editor.focus();editor.setSelectionRange(editor.value.length,editor.value.length);}});
    }
    const editor=editing.row.querySelector('textarea')!,buttons=editing.row.querySelectorAll('button');
    editor.readOnly=!!this.pending||this.blocked||!!q.blocked;buttons[0]!.disabled=editor.readOnly||!editor.value.trim();buttons[1]!.disabled=!!this.pending;nodes.push(editing.row);
   }else{
    const row=document.createElement('div'),preview=document.createElement('span'),actions=document.createElement('div');row.className='queue-row';row.dataset.queueId=item.id;preview.className='queue-preview';preview.textContent=item.status==='sending'?'正在确认发送…':item.status==='unknown'?'结果未知 · '+item.preview:item.preview;preview.title=item.text+(item.attachments?`\n附件 ${item.attachments} 项`:'');actions.className='queue-actions';
    const edit=this.button('编辑',()=>{this.editing={id:item.id,text:item.text};this.signature='';this.render();},item.status!=='queued'||!!item.attachments);edit.title=item.attachments?'带附件的消息保留完整引用；请移出后重新附加修改':'编辑排队消息';
    const guide=this.button('引导',()=>this.action('steer',item.id),!s.ready||!!s.operating||!!s.needsRecovery||!q.steerTurnId||!hasDispatchCapacity(s)||q.items.some(v=>v.status!=='queued'));guide.title='立即把此条目提交给已确认的当前Codex回合；受理后移出本地队列';
    if(item.skillName){preview.title+='\n技能：'+item.skillName;edit.disabled=true;edit.title='技能引用已保存在条目中；请移出后重新选择修改';}
    actions.append(edit,this.button(item.status==='unknown'?'已核对，移出':'删除',()=>this.action(item.status==='unknown'?'review-remove':'remove',item.id),item.status==='sending'),guide);row.append(preview,actions);nodes.push(row);
   }
  }
  // Keep the active editor connected so state updates preserve focus, selection and IME composition.
  for(const child of Array.from(this.dock.children))if(!nodes.includes(child as HTMLElement))child.remove();
  nodes.forEach((node,index)=>{if(this.dock.children[index]!==node)this.dock.insertBefore(node,this.dock.children[index]??null);});
 }
 private receive=(event:MessageEvent)=>{const m=event.data,p=this.pending;if(m?.type==='state'){const s:PageState=m.state,owner=JSON.stringify([s.threadId,s.connectionId]);if(owner!==this.owner){clearTimeout(this.pending?.timer);this.pending=undefined;this.blocked=false;this.notice='';this.editing=undefined;this.owner=owner;this.signature='';}this.state=s;this.configure(s.copySettings?.busyEnter);this.render();}else if(m?.type==='queue-result'&&p&&p.id===m.id&&m.threadId===this.state?.threadId&&m.connectionId===this.state?.connectionId){clearTimeout(p.timer);this.pending=undefined;if(m.ok===true){if(p.action==='edit')this.editing=undefined;if(p.action==='read')this.blocked=false;this.notice='';}else if(!m.cancelled)this.notice=m.error||'队列操作失败，保留已确认内容';this.signature='';this.render();}};
 private start=()=>{this.composing=true;};private end=()=>{this.composing=false;};
 private key=(event:KeyboardEvent)=>{if(!this.state?.busy||!this.state.localQueue||this.composing||event.isComposing||event.keyCode===229||event.key!=='Enter'||event.shiftKey)return;event.preventDefault();event.stopImmediatePropagation();if(event.repeat||this.pending||this.blocked)return;const mode=busySubmitMode(this.preference,event.ctrlKey||event.metaKey);if(this.canSubmit(mode))this.submit(mode);};
 private dispose=()=>{clearTimeout(this.pending?.timer);this.host.messages.removeEventListener('message',this.receive);this.prompt.removeEventListener('keydown',this.key,true);this.prompt.removeEventListener('compositionstart',this.start);this.prompt.removeEventListener('compositionend',this.end);};
}
/** DSH165 webview.ts 703–712, with narrow-sidebar bounds and explicit unavailable state. */
export const QUEUE_STYLE=`
 .queue-dock { box-sizing:border-box; width:min(100%,var(--column-available,100%)); min-width:0; max-width:var(--content-max,760px); margin:0 auto 6px; padding:7px 8px; border:1px solid var(--vscode-widget-border); border-radius:8px; background:var(--vscode-editor-background); flex-shrink:0; max-height:min(35vh,300px); overflow:auto; }
 .queue-dock[hidden] { display:none; }
 .queue-head { min-width:0; display:flex; align-items:center; gap:6px; margin-bottom:4px; color:var(--vscode-descriptionForeground); font-size:11px; }
 .queue-title { min-width:0; flex:1; font-weight:600; }
 .queue-row { min-width:0; min-height:30px; display:flex; align-items:center; gap:6px; }
 .queue-row + .queue-row { border-top:1px solid color-mix(in srgb,var(--vscode-widget-border) 55%,transparent); }
 .queue-preview { min-width:0; flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
 .queue-actions { flex:0 0 auto; display:flex; align-items:center; gap:3px; }
 .queue-action { min-height:23px; padding:1px 5px; border:0; border-radius:4px; color:var(--vscode-descriptionForeground); background:transparent; font-size:10px; }
 .queue-action:hover { color:var(--vscode-foreground); background:var(--vscode-toolbar-hoverBackground); }
 .queue-editor { width:100%; min-width:0; min-height:30px; height:30px; padding:4px 6px; resize:none; border:1px solid var(--vscode-input-border,var(--vscode-widget-border)); border-radius:4px; background:var(--vscode-input-background); }
 .queue-notice { font-size:11px; color:var(--vscode-descriptionForeground); overflow-wrap:anywhere; }
 .composer-submit-mode { white-space:nowrap; }
 .composer-submit-mode[hidden] { display:none; }
 @media(max-width:420px) { #composer .prototype-run-actions { flex-wrap:wrap; justify-content:flex-end; } }
`;
