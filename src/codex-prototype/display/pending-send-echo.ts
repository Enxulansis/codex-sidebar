import {isPageItem,type PageRow} from '../page-model';
import {messageHead} from './message-layout';
import {messageFileCards} from './message-files';
import type {DraftFile} from '../draft-store-types';
import type {DisplaySettings} from '../display-settings';
import type {UserFoldState} from '../user-fold-store';
import {UserMessageFolds,userFoldConfig} from './user-message-fold';

/** Local pending display only; it never enters public history, search or the rail. */
export class PendingSendEcho{
 private article:HTMLElement|undefined;private key='';private status:HTMLElement|undefined;
 private folds:UserMessageFolds|undefined;private settings:Partial<DisplaySettings>={};private signature='';private content:{text:string;media:HTMLElement[]}|undefined;
 constructor(private history:HTMLElement,private quiet:()=>boolean=()=>false,private fold=false,private promote?:(row:PageRow,state:UserFoldState)=>void){}
 configure(settings:Partial<DisplaySettings>){const signature=JSON.stringify(userFoldConfig(settings));this.settings=settings;if(signature!==this.signature){this.signature=signature;if(this.article)this.paintBody();}}
 private paintBody(){
  const article=this.article,content=this.content;if(!article||!content)return;this.folds?.dispose();this.folds=undefined;article.querySelector?.(':scope > .msg-row')?.remove();
  if(this.fold){this.folds=new UserMessageFolds(()=>this.history,{get:()=>undefined,save:async()=>{}});this.folds.configure(this.settings);this.folds.bind(article,content.text,content.media,['local-send',this.key,'pending'],()=>this.article===article&&article.isConnected);}
  else{const row=document.createElement('div'),body=document.createElement('div'),text=document.createElement('div');row.className='msg-row';body.className='message-body';text.className='msg-text';text.textContent=content.text;body.append(text,...content.media);row.append(body);article.append(row);}
  if(this.status)article.append(this.status);
 }
  begin(key:string,text:string,images:{name:string;src?:string}[],files:DraftFile[]){
  this.clear();this.key=key;const article=document.createElement('article');article.className='message user pending-send';article.dataset.pendingSendKey=key;
  article.append(messageHead('user'));const media:HTMLElement[]=[];
  for(const image of images){const card=document.createElement('div');card.className='image-card';if(image.src){const img=document.createElement('img');img.src=image.src;img.alt=image.name;card.append(img);}else card.textContent=image.name;media.push(card);}
  if(files.length)media.push(messageFileCards(files,()=>false,async()=>'',true));
  this.status=document.createElement('div');this.status.className='message-meta';this.status.setAttribute('role','status');this.article=article;this.content={text,media};this.paintBody();this.setStatus('准备发送…');this.attach();
 }
 attach(){if(this.article)this.history.append(this.article);}
  setStatus(text:string,important=false){if(this.status){this.status.textContent=this.quiet()&&!important?'':text;this.status.hidden=!this.status.textContent;}}
 observe(rows:PageRow[]){if(!this.key)return;const matches=rows.filter(row=>isPageItem(row.item,'userMessage')&&row.item.clientId===this.key);if(matches.length===1){const manual=this.article?.querySelector?.('.msg-text')?.getAttribute('data-manual');if(manual)this.promote?.(matches[0]!,this.article!.classList.contains('msg-folded')?'folded':'expanded');this.clear();}}
  settle(accepted:boolean,unknown:boolean,keepFailed=false){if(unknown)this.setStatus('发送结果未确认，草稿保留。',true);else if(accepted)this.setStatus('已受理，等待回显…');else if(keepFailed)this.setStatus('发送失败，草稿已保留。',true);else this.clear();}
 clear(expectedKey?:string){if(expectedKey!==undefined&&this.key!==expectedKey)return;this.folds?.dispose();this.folds=undefined;this.article?.remove();this.article=undefined;this.content=undefined;this.status=undefined;this.key='';}
}
