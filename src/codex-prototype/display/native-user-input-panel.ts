import type {PageHost} from '../page-host';
import type {PageState} from '../page-model';
import {USER_INPUT_TEXT_LIMIT,type NativeUserInput} from '../native-user-input';
import {showFormulaToast} from './dsh-math-export';

// The installed official client uses foreground inactivity, not deprecated
// autoResolutionMs: 60 seconds idle followed by a visible 90 second countdown.
export const OPTIONAL_INPUT_IDLE_MS=60_000,OPTIONAL_INPUT_COUNTDOWN_MS=90_000;
type Control={id:string;options:HTMLInputElement[];text?:HTMLTextAreaElement};
/** Live requests live outside historical rows and never enter the chat draft store. */
export class NativeUserInputPanel {
  readonly element=document.createElement('section');
  private state:PageState|undefined;private request:NativeUserInput|undefined;private identity='';
  private controls:Control[]=[];private pending=false;private unknown=false;private sequence=0;private waitingSequence=0;
  private ackTimer:ReturnType<typeof setTimeout>|undefined;private idleTimer:ReturnType<typeof setInterval>|undefined;
  private lastActivity=performance.now();private countdownStart:number|undefined;private dead=false;private composing=false;
  private note=document.createElement('div');private submit=document.createElement('button');private skip=document.createElement('button');private stop=document.createElement('button');
  constructor(private host:PageHost,private composer:HTMLElement){
    this.element.id='native-user-input';this.element.className='native-question';this.element.hidden=true;this.element.setAttribute('aria-label','Codex 提问');
    composer.before(this.element);host.messages.addEventListener('message',this.message);
    this.element.addEventListener('keydown',this.keydown);this.element.addEventListener('compositionstart',()=>{this.composing=true;});this.element.addEventListener('compositionend',()=>{this.composing=false;});
    document.addEventListener('input',this.activity);document.addEventListener('pointerdown',this.activity);document.addEventListener('keydown',this.activity);document.addEventListener('wheel',this.activity,{passive:true});
    document.addEventListener('visibilitychange',this.activity);window.addEventListener('pagehide',()=>this.dispose(),{once:true});
  }
  update(state:PageState){
    if(this.dead)return;const request=state.userInputs?.[0],identity=request?JSON.stringify([state.threadId,state.connectionId,request.id,request.callbackToken]):'';
    const usable=state.ready&&!state.needsRecovery&&state.busy&&request?.params.threadId===state.threadId;
    const restoreFocus=this.state?.threadId===state.threadId&&this.state?.connectionId===state.connectionId&&this.element.contains(document.activeElement);
    this.state=state;
    if(!usable||!request){this.clear();if(restoreFocus){const prompt=this.composer.querySelector<HTMLTextAreaElement>('#prompt');if(prompt&&!prompt.disabled)prompt.focus({preventScroll:true});}return;}
    if(identity!==this.identity){this.clear();this.identity=identity;this.request=request;this.mount(request);}
    else this.request=request;
    if(request.status==='submitted'){this.pending=true;this.countdownStart=undefined;}
    this.refresh();
  }
  private clear(){
    clearTimeout(this.ackTimer);clearInterval(this.idleTimer);this.ackTimer=undefined;this.idleTimer=undefined;
    this.identity='';this.request=undefined;this.controls=[];this.pending=false;this.unknown=false;this.waitingSequence=0;this.countdownStart=undefined;this.composing=false;
    // Do not retain a secret or an obsolete question in detached DOM references.
    for(const text of this.element.querySelectorAll('textarea'))text.value='';this.element.replaceChildren();this.element.hidden=true;
  }
  private activity=()=>{this.lastActivity=performance.now();this.countdownStart=undefined;this.refresh();};
  private mount(request:NativeUserInput){
    this.element.hidden=false;this.lastActivity=performance.now();
    const identity=this.identity,live=()=>!this.dead&&this.identity===identity;
    const title=document.createElement('strong');title.textContent=request.params.isBlocking?'Codex 需要你的回答':'Codex 提问（可跳过）';this.element.append(title);
    for(const [index,q] of request.params.questions.entries()){
      const group=document.createElement('fieldset'),legend=document.createElement('legend'),question=document.createElement('div');
      legend.textContent=q.header;question.textContent=q.question;group.append(legend,question);
      const control:Control={id:q.id,options:[]};this.controls.push(control);
      for(const option of q.options??[]){
        const label=document.createElement('label');label.className='native-question-option';const radio=document.createElement('input');radio.type='radio';radio.name=`native-question-${this.sequence}-${index}`;radio.value=option.label;
        const content=document.createElement('span'),name=document.createElement('span');name.textContent=option.label;content.append(name);
        if(option.description){const detail=document.createElement('small');detail.textContent=option.description;content.append(detail);}
        control.options.push(radio);label.append(radio,content);group.append(label);
      }
      if(q.options===null||q.isOther){
        const label=document.createElement('label');label.className='native-question-custom';label.textContent=q.options?'其他回答':'你的回答';
        const text=document.createElement('textarea');text.rows=2;text.maxLength=USER_INPUT_TEXT_LIMIT;text.setAttribute('aria-label',q.header+'：'+(q.options?'其他回答':'你的回答'));text.autocomplete='off';text.spellcheck=!q.isSecret;
        text.addEventListener('input',()=>{for(const radio of control.options)radio.checked=false;});control.text=text;label.append(text);group.append(label);
        if(q.isSecret){const note=document.createElement('small');note.textContent='回答仅用于本次提问，不保存到聊天草稿。';group.append(note);}
      }
      const clear=document.createElement('button');clear.type='button';clear.className='native-question-clear';clear.textContent='跳过此题';clear.onclick=()=>{if(!live())return;for(const radio of control.options)radio.checked=false;if(control.text)control.text.value='';this.activity();};group.append(clear);this.element.append(group);
    }
    this.note=document.createElement('div');this.note.className='native-question-note';this.note.setAttribute('role','status');
    const actions=document.createElement('div');actions.className='native-question-actions';
    this.stop=document.createElement('button');this.stop.type='button';this.stop.textContent='停止回合';this.stop.onclick=()=>{if(live())this.send('stop');};
    this.skip=document.createElement('button');this.skip.type='button';this.skip.textContent='全部跳过';this.skip.onclick=()=>{if(live())this.send('skip');};
    this.submit=document.createElement('button');this.submit.type='button';this.submit.className='native-question-submit';this.submit.textContent='提交回答';this.submit.onclick=()=>{if(live())this.send('answer');};
    actions.append(this.stop,this.skip,this.submit);this.element.append(this.note,actions);
    if(!request.params.isBlocking)this.idleTimer=setInterval(()=>{if(live())this.tick();},1000);
  }
  private keydown=(event:KeyboardEvent)=>{
    this.activity();if(event.defaultPrevented||event.isComposing||this.composing||event.keyCode===229||!(event.target instanceof Element)||!this.element.contains(event.target))return;
    if(event.key==='Escape'){event.preventDefault();this.send('stop');}
    else if(event.key==='Enter'&&!event.shiftKey&&(event.target instanceof HTMLTextAreaElement||event.target instanceof HTMLInputElement)){event.preventDefault();this.send('answer');}
  };
  private tick(){
    if(this.dead||!this.request||this.request.params.isBlocking||this.pending||this.unknown||document.visibilityState!=='visible')return;
    const now=performance.now();if(now-this.lastActivity<OPTIONAL_INPUT_IDLE_MS)return;
    this.countdownStart??=now;
    if(now-this.countdownStart>=OPTIONAL_INPUT_COUNTDOWN_MS){this.send('skip');return;}this.refresh();
  }
  private refresh(){
    if(!this.request)return;const disabled=this.pending||this.unknown;
    for(const input of this.element.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input,textarea'))input.disabled=disabled;
    for(const button of this.element.querySelectorAll<HTMLButtonElement>('.native-question-clear'))button.disabled=disabled;
    this.submit.disabled=disabled;this.skip.disabled=disabled;this.stop.disabled=this.pending&&this.waitingSequence<0;
    this.note.textContent=this.unknown?'回答结果尚未确认；不会自动重发，可停止回合后恢复核对。':this.pending?'回答已提交，等待后端确认。':this.countdownStart!==undefined?`无操作 ${Math.max(0,Math.ceil((OPTIONAL_INPUT_COUNTDOWN_MS-(performance.now()-this.countdownStart))/1000))} 秒后跳过；点击或输入可继续回答。`:'未回答的问题将跳过。Enter 提交，Shift+Enter 换行。';
  }
  private send(action:'answer'|'skip'|'stop'){
    const s=this.state,r=this.request;if(!s||!r||this.dead||(this.pending||this.unknown)&&action!=='stop')return;
    if(action==='stop'&&this.waitingSequence<0)return;
    const answers:Record<string,string>=Object.create(null);
    if(action==='answer')for(const c of this.controls){const value=c.options.find(option=>option.checked)?.value??c.text?.value??'';if(value.trim())answers[c.id]=value;}
    const sequence=++this.sequence;this.waitingSequence=action==='stop'?-sequence:sequence;this.pending=true;this.countdownStart=undefined;this.refresh();
    clearTimeout(this.ackTimer);this.ackTimer=setTimeout(()=>{if(Math.abs(this.waitingSequence)!==sequence)return;this.pending=false;this.unknown=true;this.waitingSequence=0;this.refresh();},15000);
    this.host.postMessage({type:'native-input',sequence,threadId:s.threadId,connectionId:s.connectionId,requestId:r.id,callbackToken:r.callbackToken,action,...(action==='answer'?{answers}:{})});
  }
  private message=(event:MessageEvent)=>{
    const m=event.data,s=this.state,r=this.request;if(m?.type!=='native-input-result'||!s||!r||m.sequence!==Math.abs(this.waitingSequence)||m.requestId!==r.id||m.callbackToken!==r.callbackToken||m.threadId!==s.threadId||m.connectionId!==s.connectionId)return;
    clearTimeout(this.ackTimer);this.ackTimer=undefined;if(!m.ok){this.pending=false;this.unknown=true;this.waitingSequence=0;showFormulaToast(m.error||'回答未确认，未自动重发',true);}this.refresh();
  };
  dispose(){if(this.dead)return;this.dead=true;this.clear();this.host.messages.removeEventListener('message',this.message);document.removeEventListener('visibilitychange',this.activity);document.removeEventListener('input',this.activity);document.removeEventListener('pointerdown',this.activity);document.removeEventListener('keydown',this.activity);document.removeEventListener('wheel',this.activity);this.element.remove();}
}
export const NATIVE_USER_INPUT_STYLE=`
.native-question{box-sizing:border-box;border:1px solid var(--vscode-widget-border);border-radius:10px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));padding:12px 14px;margin-bottom:8px;max-height:min(420px,45vh);overflow:auto;overflow-wrap:anywhere;color:var(--vscode-foreground)}
.native-question[hidden]{display:none}.native-question fieldset{min-width:0;border:0;border-top:1px solid var(--vscode-widget-border);padding:8px 0;margin:8px 0 0}.native-question legend{font-size:12px;color:var(--vscode-descriptionForeground);padding:0 5px 0 0}.native-question-option{display:flex;gap:8px;align-items:flex-start;padding:7px;border-radius:6px;cursor:pointer}.native-question-option:hover{background:var(--vscode-list-hoverBackground)}.native-question-option:has(input:checked){background:var(--vscode-list-inactiveSelectionBackground)}.native-question-option input{flex:0 0 auto;margin-top:4px;accent-color:var(--vscode-focusBorder)}.native-question-option small{display:block;color:var(--vscode-descriptionForeground);font-size:11px}.native-question-custom{display:block;font-size:12px;margin-top:6px}.native-question textarea{display:block;box-sizing:border-box;width:100%;resize:vertical;min-height:44px;max-height:120px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-widget-border));border-radius:5px;padding:6px;font:inherit}.native-question-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:8px}.native-question button{font:inherit;cursor:pointer;border:1px solid var(--vscode-widget-border);border-radius:5px;padding:4px 8px;background:transparent;color:inherit}.native-question button:disabled{cursor:default;opacity:.5}.native-question .native-question-submit{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.native-question .native-question-clear{font-size:11px;margin-top:5px}.native-question-note,.native-question small{font-size:11px;color:var(--vscode-descriptionForeground)}.native-question :focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
`;
