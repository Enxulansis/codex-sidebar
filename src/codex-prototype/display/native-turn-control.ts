import type {PageHost} from '../page-host';import type {PageState} from '../page-model';
import {showCopyMenu,closeStaleMathMenu,showFormulaToast} from './dsh-math-export';
/** Compact live plan and public-diff entry; this never sends a turn or modifies a file. */
export class NativeTurnControl{
 private state:PageState|undefined;private owner='';private dead=false;private sequence=0;private signature='';
 private panel=document.createElement('details');private head=document.createElement('summary');private title=document.createElement('span');private diff=document.createElement('button');private body=document.createElement('div');
 private pending:{id:number;key:string;timer:ReturnType<typeof setTimeout>}|undefined;
 constructor(private host:PageHost,composer:HTMLElement){
  this.panel.id='native-turn-progress';this.panel.className='queue-dock';this.panel.hidden=true;this.head.className='queue-head';this.title.className='queue-title queue-preview';this.diff.id='native-turn-diff';this.diff.type='button';this.diff.className='queue-action';this.diff.textContent='回合差异';this.diff.onclick=event=>{event.preventDefault();event.stopPropagation();this.menu();};this.head.append(this.title,this.diff);this.panel.append(this.head,this.body);composer.before(this.panel);host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',this.dispose,{once:true});
 }
 private key(){const s=this.state,v=s?.turnProgress;return JSON.stringify([s?.threadId,s?.connectionId,v?.turnId,v?.diff?.revision]);}
 update(state:PageState){
  const owner=JSON.stringify([state.threadId,state.connectionId]);if(owner!==this.owner){this.cancel();this.owner=owner;this.panel.open=false;}this.state=state;if(this.pending&&this.pending.key!==this.key())this.cancel();
  const v=state.turnProgress;this.panel.hidden=!v;if(!v){closeStaleMathMenu();return;}const done=v.plan?.steps.filter(s=>s.status==='completed').length??0,total=v.plan?.steps.length??0,active=v.plan?.steps.find(s=>s.status==='inProgress')?.step??'';
  const phase=state.connecting?' · 连接中 · 上次快照':!state.ready?' · 未连接 · 上次快照':state.needsRecovery?' · 状态待核对 · 上次快照':v.status==='inProgress'?' · 运行中':v.status==='completed'?' · 已结束':v.status==='failed'?' · 失败':' · 已中断';
  this.title.textContent=(v.plan?`计划 ${done}/${total}`:'当前回合')+phase+(active?' · '+active:'');this.title.title=`回合 ${v.turnId} · 最近收到的公开计划快照`;
  this.diff.hidden=!v.diff||v.diff.characters===0&&!v.diff.error;this.diff.disabled=!!this.pending||!state.ready||!!state.connecting||!!v.diff?.error;this.diff.title=v.diff?.error??(this.pending?'正在打开公开差异':'完整公开补丁或有明确行号的片段对比；不读取当前文件作为基准');this.diff.setAttribute('aria-busy',String(!!this.pending));
  const signature=JSON.stringify([v.plan,v.planError,v.diff?.error]);if(signature!==this.signature){this.signature=signature;this.body.replaceChildren();if(v.plan?.explanation){const note=document.createElement('div');note.className='queue-notice';note.textContent=v.plan.explanation;this.body.append(note);}if(v.plan){const list=document.createElement('ol');list.setAttribute('aria-label','公开计划步骤');for(const step of v.plan.steps){const row=document.createElement('li');row.textContent=({'pending':'○ 待处理','inProgress':'◉ 进行中','completed':'✓ 已完成'}[step.status])+' · '+step.step;row.dataset.status=step.status;list.append(row);}this.body.append(list);}for(const error of [v.planError,v.diff?.error])if(error){const note=document.createElement('div');note.className='queue-notice';note.textContent=error;this.body.append(note);}}
  closeStaleMathMenu();
 }
 private menu(){const s=this.state,v=s?.turnProgress,d=v?.diff;if(!s||!v||!d||this.diff.disabled)return;const key=this.key(),valid=()=>!this.dead&&this.key()===key&&!this.pending&&!!this.state?.ready&&!this.state.connecting;
  const entries=[{label:'完整公开补丁',run:async()=>this.request('raw')},...d.options.map(option=>({label:`片段 ${option.index+1} · ${option.afterPath} · −${option.oldStart},${option.oldCount} +${option.newStart},${option.newCount}`,run:async()=>this.request('hunk',option.index)}))];
  if(d.hunkCount>d.options.length)entries.push({label:`${d.hunkCount-d.options.length}段仅提供完整补丁查看（行号未核对或超出对比上限）`,run:async()=>this.request('raw')});
  showCopyMenu(new MouseEvent('click'),valid,entries,valid,()=>{if(!this.diff.disabled)this.diff.focus({preventScroll:true});},this.diff);
 }
 private request(mode:'raw'|'hunk',index?:number){const s=this.state,v=s?.turnProgress;if(!s||!v?.diff||this.pending||this.diff.disabled)return;const id=++this.sequence,key=this.key(),timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.cancel();if(this.state)this.update(this.state);showFormulaToast('差异窗口响应未确认；不会自动重开，可核对后重试',true);},10000);this.pending={id,key,timer};this.update(s);try{this.host.postMessage({type:'turn-diff-open',id,threadId:s.threadId,connectionId:s.connectionId,turnId:v.turnId,revision:v.diff.revision,mode,...(mode==='hunk'?{index}:{})});}catch{this.cancel();if(this.state)this.update(this.state);showFormulaToast('差异请求未提交',true);}}
 private message=(event:MessageEvent)=>{const m=event.data,s=this.state,p=this.pending;if(!s||!p||m?.type!=='turn-diff-result'||m.id!==p.id||m.threadId!==s.threadId||m.connectionId!==s.connectionId||m.turnId!==s.turnProgress?.turnId||m.revision!==s.turnProgress?.diff?.revision||p.key!==this.key())return;this.cancel();this.update(s);if(!m.ok)showFormulaToast(m.error||'公开差异未能打开',true);};
 private cancel(){clearTimeout(this.pending?.timer);this.pending=undefined;}
 private dispose=()=>{this.dead=true;this.cancel();this.host.messages.removeEventListener('message',this.message);this.panel.remove();};
}
