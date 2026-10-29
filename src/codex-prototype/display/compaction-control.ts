import type {PageHost} from '../page-host';import type {PageState} from '../page-model';
import {showFormulaToast} from './dsh-math-export';
export class CompactionControl{
 private state:PageState|undefined;private owner='';private sequence=0;private pending:number|undefined;private dead=false;
 private button=document.createElement('button');private notice=document.createElement('div');
 constructor(private host:PageHost,composer:HTMLElement,private ready:()=>boolean){
  this.button.id='compact-context';this.button.type='button';this.button.className='usage-action';this.button.hidden=true;
  
  this.notice.id='compaction-status';this.notice.className='muted';this.notice.hidden=true;this.notice.setAttribute('role','status');
  composer.insertBefore(this.notice,composer.firstChild);
  this.button.onclick=()=>this.start();host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',this.dispose,{once:true});
 }
 get action(){return this.button;}
 update(state:PageState){const owner=JSON.stringify([state.threadId,state.connectionId]);if(owner!==this.owner){this.owner=owner;this.pending=undefined;}this.state=state;if(state.compaction?.active||!state.ready)this.pending=undefined;this.refresh();}
 refresh(){const s=this.state,v=s?.compaction,label=!v?'压缩上下文':v.active?'正在压缩…':v.phase==='failed'||v.phase==='rejected'||v.phase==='unknown'?'重试压缩':'压缩上下文';this.button.textContent=label;this.button.setAttribute('aria-label',label);this.button.hidden=!v;this.button.disabled=this.dead||!!this.pending||!v?.canStart||!this.ready();this.button.setAttribute('aria-busy',String(!!this.pending||!!v?.active));this.button.title=v?.active?v.reason:v?.blockedReason||v?.reason||'压缩会话上下文';this.notice.textContent=v&&(v.phase==='failed'||v.phase==='rejected'||v.phase==='unknown')?v.reason:'';this.notice.hidden=!this.notice.textContent;}
 private start(){const s=this.state;if(!s||this.button.disabled||!this.ready())return;this.pending=++this.sequence;this.refresh();try{this.host.postMessage({type:'compact',id:this.pending,threadId:s.threadId,connectionId:s.connectionId});}catch{this.pending=undefined;this.refresh();showFormulaToast('压缩请求未提交，草稿保留',true);}}
 private message=(event:MessageEvent)=>{const m=event.data,s=this.state;if(m?.type!=='compact-result'||!s||m.threadId!==s.threadId||m.connectionId!==s.connectionId||m.id!==this.pending)return;this.pending=undefined;this.refresh();if(!m.ok)showFormulaToast(m.error||'压缩结果未确认，未自动重试',true);};
 private dispose=()=>{this.dead=true;this.pending=undefined;this.host.messages.removeEventListener('message',this.message);this.button.remove();this.notice.remove();};
}
