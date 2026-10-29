import type {DisplaySettings} from '../display-settings';import type {UserFoldState} from '../user-fold-store';import {selectionDragEnded} from './block-fold';
export interface UserFoldConfig{enabled:boolean;previewLines:number;triggerRatio:number;minExtraLines:number;minChars:number}
export function userFoldConfig(s:Partial<DisplaySettings>):UserFoldConfig{return{enabled:s.userFoldEnabled!==false,previewLines:s.userFoldPreviewLines??4,triggerRatio:s.userFoldTriggerRatio??.5,minExtraLines:s.userFoldMinExtraLines??3,minChars:s.userFoldMinChars??100};}
export function shouldAutoFold(full:number,lineHeight:number,viewport:number,chars:number,hasAttachments:boolean,cfg:UserFoldConfig){return cfg.enabled&&(hasAttachments||chars>=cfg.minChars)&&full>Math.max(viewport*cfg.triggerRatio,lineHeight*(cfg.previewLines+cfg.minExtraLines));}
type Target={article:HTMLElement;text:HTMLElement;body:HTMLElement;row:HTMLElement;key:string;valid:()=>boolean;attachments:boolean;textFoldable:boolean;manual:boolean;state:UserFoldState|'plain';revision:number;load:()=>void};
/** Original user-bubble folding; transport and persistence are supplied at the display boundary. */
export class UserMessageFolds{
 private cfg=userFoldConfig({});private targets=new Set<Target>();private dirty=new Set<Target>();private frame:number|undefined;
 private auto=new Map<string,'plain'|'folded'>();private observer:ResizeObserver;private dead=false;
 constructor(private scroll:()=>HTMLElement,private memory:{get:(key:string)=>UserFoldState|undefined;save:(key:string,state:UserFoldState)=>Promise<void>}){this.observer=new ResizeObserver(()=>this.markAll());this.observer.observe(scroll());document.addEventListener('visibilitychange',this.onVisible);window.addEventListener('pagehide',this.onPageHide,{once:true});}
 configure(settings:Partial<DisplaySettings>){const next=userFoldConfig(settings);if(JSON.stringify(next)!==JSON.stringify(this.cfg))this.auto.clear();this.cfg=next;}
 bind(article:HTMLElement,text:string,images:HTMLElement[],owner:readonly[string,string,string],valid:()=>boolean){
  article.classList.add('message','user');const row=document.createElement('div');row.className='msg-row';const body=document.createElement('div');body.className='message-body';const textEl=document.createElement('div');textEl.className='msg-text';textEl.textContent=text;body.append(textEl);if(images.length){const media=document.createElement('div');media.className='message-images';media.append(...images);body.append(media);}row.append(body);article.append(row);article.style.setProperty('--msg-fold-lines',String(this.cfg.previewLines));
  const key=JSON.stringify(owner),manual=this.memory.get(key),target:Target={article,text:textEl,body,row,key,valid,attachments:images.length>0,textFoldable:false,manual:manual!==undefined,state:'plain',revision:0,load:()=>this.mark(target)};
  this.targets.add(target);row.addEventListener('load',target.load,true);if(target.manual)textEl.dataset.manual='1';this.apply(target,!this.cfg.enabled?'plain':manual??this.auto.get(key)??'plain');this.mark(target);
 }
 private mark(t:Target){if(this.dead)return;this.dirty.add(t);if(this.frame===undefined)this.frame=requestAnimationFrame(()=>{this.frame=undefined;this.flush();});}
 private markAll(){for(const t of this.targets)this.mark(t);}
 private onVisible=()=>{if(document.visibilityState==='visible')this.markAll();};
 private flush(){const scroll=this.scroll();if(!scroll.clientHeight||!scroll.getClientRects().length)return;const list=[...this.dirty].filter(t=>t.valid()&&t.article.isConnected);this.dirty.clear();for(const t of list)t.article.classList.remove('msg-folded');const sizes=list.map(t=>({t,full:t.body.offsetHeight,textHeight:t.text.offsetHeight,line:parseFloat(getComputedStyle(t.text).lineHeight)||21.45}));for(const {t,full,textHeight,line} of sizes){t.textFoldable=shouldAutoFold(textHeight,line,scroll.clientHeight,t.text.textContent?.length??0,false,this.cfg);if(t.manual&&!t.attachments&&this.cfg.enabled)t.textFoldable=textHeight>line*this.cfg.previewLines;const state=t.textFoldable||t.attachments&&shouldAutoFold(full,line,scroll.clientHeight,0,true,this.cfg)?'folded':'plain';if(!t.manual){this.auto.delete(t.key);this.auto.set(t.key,state);while(this.auto.size>2000)this.auto.delete(this.auto.keys().next().value!);}this.apply(t,!this.cfg.enabled?'plain':t.manual?t.state:state);}}
 private change(t:Target,next:UserFoldState){const revision=++t.revision,previous=t.state,wasManual=t.manual;t.manual=true;t.text.dataset.manual='1';this.apply(t,next);void this.memory.save(t.key,next).catch(()=>{if(t.valid()&&t.article.isConnected&&revision===t.revision){t.manual=wasManual;if(!wasManual)delete t.text.dataset.manual;this.apply(t,previous);}});}
 /** Transfer only an explicit local choice once a real public item owns it. */
 adopt(owner:readonly[string,string,string],next:UserFoldState){if(!this.cfg.enabled)return;const key=JSON.stringify(owner),target=[...this.targets].find(t=>t.key===key&&t.valid()&&t.article.isConnected);if(target)this.change(target,next);}
 private apply(t:Target,state:UserFoldState|'plain'){t.state=state;t.article.classList.toggle('msg-folded',state==='folded');t.article.classList.toggle('msg-text-exempt',!t.textFoldable);let button=t.row.querySelector<HTMLButtonElement>(':scope > .msg-fold-toggle');if(state==='plain'){button?.remove();return;}if(!button){button=document.createElement('button');button.type='button';button.className='msg-fold-toggle disclosure-toggle';button.addEventListener('click',event=>{if(!t.valid()||!t.article.isConnected||selectionDragEnded(event))return;const collapsing=t.state!=='folded';this.change(t,collapsing?'folded':'expanded');if(collapsing)t.article.scrollIntoView({block:'nearest'});});t.row.prepend(button);}const folded=state==='folded',mediaOnly=t.attachments&&!t.textFoldable;button.innerHTML='<span class="fold-label">'+(folded?'展开':'收起')+(mediaOnly?'附件':'')+'</span>';button.title=mediaOnly?(folded?'展开附件，正文保持完整':'收起附件，正文保持完整'):folded?'展开完整消息':'收起消息';button.setAttribute('aria-expanded',folded?'false':'true');}
 clear(){if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined;for(const t of this.targets)t.row.removeEventListener('load',t.load,true);this.targets.clear();this.dirty.clear();}
 prune(){for(const t of this.targets)if(!t.article.isConnected){t.row.removeEventListener('load',t.load,true);this.targets.delete(t);this.dirty.delete(t);}}
 private onPageHide=()=>this.dispose();
 dispose(){this.dead=true;this.clear();this.auto.clear();this.observer.disconnect();document.removeEventListener('visibilitychange',this.onVisible);window.removeEventListener('pagehide',this.onPageHide);}
}
export const USER_MESSAGE_FOLD_STYLE=`
    .message.user { display: flex; flex-direction: column; align-items: flex-end; padding-top: 6px; }
    .message.user .message-body { box-sizing: border-box; width: fit-content; max-width: 82%; margin-left: auto; padding: 8px 12px; white-space: pre-wrap; border-radius: 12px; background: color-mix(in srgb, var(--vscode-foreground) 8%, var(--vscode-editor-background)); font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
    .message.user .message-images { width: 100%; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; justify-content: flex-end; }
    .user .msg-row { display: flex; align-items: flex-start; width: 100%; min-width: 0; }
    .message.user .msg-text { min-width: 0; }
    .message.user.msg-folded .msg-text { max-height: calc(var(--msg-fold-lines, 4) * 1.65em); overflow: hidden; -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent); }
    .message.user.msg-folded.msg-text-exempt .msg-text { max-height: none; -webkit-mask-image: none; mask-image: none; }
    .msg-fold-toggle { position: sticky; z-index: 3; top: 8px; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px; margin-right: 6px; padding: 2px 9px 2px 8px; border: 1px solid var(--vscode-widget-border); border-radius: 999px; background: var(--vscode-sideBar-background); color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 16px; cursor: pointer; box-shadow: 0 1px 5px rgba(0, 0, 0, .35); }
    .msg-fold-toggle:hover { color: var(--vscode-foreground); border-color: color-mix(in srgb, var(--vscode-charts-blue, #4d6bfe) 45%, var(--vscode-widget-border)); }
    .msg-fold-toggle .fold-label { min-width: 0; overflow: hidden; white-space: nowrap; }
    .message.user .message-images .image-card { width: 96px; height: 96px; flex: 0 0 96px; max-width: none; padding: 0; display: block; border: 0; border-radius: 8px; overflow: hidden; background: var(--vscode-editor-background); }
    .message.user .message-images .image-card img { width: 100%; height: 100%; max-width: none; max-height: none; display: block; object-fit: cover; }
    .message.user .message-images .image-card > span { display: none; }
    .message.user .message-images .image-card-status { width:96px; height:96px; flex:0 0 96px; margin:0; padding:6px; overflow:hidden; border-radius:8px; background:var(--vscode-editor-background); white-space:normal; font-size:11px; }
    .message.user.msg-folded .image-card { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 6px; }
    .message.user.msg-folded .image-card-status { width:40px; height:40px; flex:0 0 40px; border-radius:6px; }
    .message.user.msg-folded .file-card { width:40px; height:40px; flex:0 0 40px; border-radius:6px; padding:3px; gap:0; }
    .message.user.msg-folded .file-card .card-name, .message.user.msg-folded .file-card .card-caption { display:none; }
    .message.user.msg-folded .file-card .card-badge-img { width:26px; height:26px; }
`;
