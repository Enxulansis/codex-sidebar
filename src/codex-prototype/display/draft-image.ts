import {ImagePreview,safeImageSource,type DisplayImage} from './image-preview';
import {showCopyMenu,closeStaleMathMenu,showFormulaToast,clearDisplayToast} from './dsh-math-export';
import {imageExportFeedback} from '../image-export-name';
import type {AnimationPreviewSource} from './animation-preview';
import {ANIMATION_INPUT_NOTICE} from '../image-formats';
type Kind='name'|'original'|'png'|'save';
type DraftImageView={threadId:string;connectionId:number;image:DisplayImage;path:string;error:string;note?:string;originalName?:string|undefined;format:'original'|'png';animation?:AnimationPreviewSource|undefined};
/** Original 165 fitFrameBadges: hide trailing badges until +m fits on one line. */
function fitFrameBadges(chip:HTMLElement){const more=chip.querySelector<HTMLElement>('.frame-badge-more');if(!more)return;const frames=Array.from(chip.querySelectorAll<HTMLElement>('.frame-badge:not(.frame-badge-more)'));for(const badge of frames)badge.hidden=false;more.hidden=true;if(chip.scrollWidth<=chip.clientWidth)return;let shown=frames.length;more.hidden=false;const sync=()=>{more.textContent='+'+String(frames.length-shown);};sync();while(shown>0&&chip.scrollWidth>chip.clientWidth){shown--;frames[shown]!.hidden=true;sync();}}
/** Original 165 attachment chip: thumbnail preview, filename and separate remove. */
export class DraftImageChip {
 private template:HTMLElement;private container:HTMLElement;private chips=new Map<string,{root:HTMLElement;refresh:()=>void;dispose:()=>void}>();
  constructor(private all:()=>DraftImageView[],private preview:ImagePreview,private removeImage:(token:string)=>void,private failed:(token:string)=>void,private exporting:(kind:Kind,token:string)=>Promise<string>,private pickFrames?:(token:string)=>void){
  this.template=document.getElementById('draft-attachment')!;for(const node of this.template.querySelectorAll('[id]'))(node as HTMLElement).dataset.chipPart=node.id;this.container=this.template.parentElement!;this.refresh();
 }
  private current(){const keys=new Set<string>();return this.all().filter(v=>{const origin=v.animation?.origin;if(!origin)return true;const key=JSON.stringify([v.threadId,v.connectionId,origin.groupId,origin.sha256]);if(keys.has(key))return false;keys.add(key);return true;});}
  private identity(s:DraftImageView){if(s.animation?.isCurrent)return s.animation.isCurrent;return ()=>{const n=this.current().find(v=>v.image.id===s.image.id);return !!n&&n.threadId===s.threadId&&n.connectionId===s.connectionId&&n.image.src===s.image.src&&n.path===s.path&&!n.error;};}
 private key(s:DraftImageView){return JSON.stringify([s.threadId,s.connectionId,s.animation?['animation',s.animation.origin.groupId,s.animation.origin.sha256]:['image',s.image.id]]);}
 refresh(){const views=this.current();for(const [key,chip] of this.chips)if(!views.some(v=>this.key(v)===key)){chip.dispose();this.chips.delete(key);}
  for(const [index,view] of views.entries()){const key=this.key(view);let chip=this.chips.get(key);if(!chip){chip=this.create(key);this.chips.set(key,chip);}chip.refresh();const position=this.container.children[index+1];if(position!==chip.root)this.container.insertBefore(chip.root,position??null);const nodes=[chip.root,...chip.root.querySelectorAll('[data-chip-part]')];for(const node of nodes){const part=node===chip.root?'draft-attachment':(node as HTMLElement).dataset.chipPart!,id=index===0?part:'';if(node.id!==id)node.id=id;}}
  this.template.hidden=true;this.template.id=views.length?'':'draft-attachment';for(const node of this.template.querySelectorAll('[data-chip-part]'))node.id=views.length?'':(node as HTMLElement).dataset.chipPart!;
  this.preview.closeIfStale();closeStaleMathMenu();
 }
  private create(key:string){const root=this.template.cloneNode(true) as HTMLElement;root.hidden=false;const thumbnail=root.querySelector('img')!,open=root.querySelector('button')!,label=root.querySelector('span')!,remove=root.querySelectorAll('button')[1]!;for(const node of root.querySelectorAll('[id]')){(node as HTMLElement).dataset.chipPart=node.id;node.removeAttribute('id');}root.removeAttribute('id');let signature:(string|number|boolean|undefined)[]|undefined,decoded=false;const current=()=>this.current().find(v=>this.key(v)===key);
  thumbnail.draggable=false;thumbnail.onload=()=>{const s=current();if(s&&thumbnail.currentSrc===s.image.src&&!s.error){decoded=true;open.disabled=false;}};thumbnail.onerror=()=>{const s=current();if(s&&thumbnail.currentSrc===s.image.src)this.failed(s.image.id);};
   open.onclick=()=>{const s=current();if(!decoded||!s)return;const gallery=this.current().filter(s=>safeImageSource(s.image.src)&&!s.error).map(s=>({image:s.image,isCurrent:this.identity(s),onError:()=>this.failed(s.image.id),...(s.animation?{animation:s.animation}:{})}));const entry=gallery.find(v=>v.image.id===s.image.id);if(entry&&entry.isCurrent())this.preview.open(entry.image,entry.isCurrent,entry.onError,gallery);};
   remove.onclick=e=>{e.stopPropagation();const s=current();if(s)this.removeImage(s.image.id);};root.oncontextmenu=e=>{const s=current();if(!s)return;e.preventDefault();e.stopPropagation();const identity=this.identity(s),valid=()=>current()?.image.id===s.image.id&&identity();if(!decoded||!valid())return;clearDisplayToast();const option=(kind:Kind,label:string)=>({label,run:async()=>{try{const result=await this.exporting(kind,s.image.id);if(valid()){const feedback=imageExportFeedback(s.image.name,s.image.src?.startsWith('data:image/png;')?'png':'jpg',kind,result,s.originalName);if(feedback)showFormulaToast(feedback);}}catch(error){if(valid())showFormulaToast(error instanceof Error?error.message:'图片操作失败，请重试',true);}}});const original=option('original','复制原格式'),png=option('png','复制 PNG');showCopyMenu(e,valid,[...(s.animation&&this.pickFrames?[{label:'选择发送帧',run:async()=>this.pickFrames!(s.image.id)}]:[]),option('name','复制文件名'),...(s.format==='png'?[png,original]:[original,png]),option('save','另存为…')]);};
   const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(()=>fitFrameBadges(root));observer?.observe(root);let original:HTMLImageElement|undefined;
   // Compare presentation values directly; serializing the view copies the full
   // base64 preview on every state refresh even when no chip needs repainting.
   return {root,refresh:()=>{const s=current();if(!s)return;const frames=s.animation?.selected?.()??[],next=[s.threadId,s.connectionId,s.image.id,s.image.name,s.image.src,s.path,s.error,s.note,s.originalName,s.format,!!s.animation,...frames];if(signature?.length===next.length&&next.every((value,index)=>value===signature![index]))return;signature=next;root.dataset.imageToken=s.image.id;root.title=s.error||[s.note,s.path,frames.length?'已选帧：'+frames.map(i=>i+1).join('、'):s.animation?ANIMATION_INPUT_NOTICE:''].filter(Boolean).join('\n');label.textContent=s.image.name;open.title=s.error||(s.animation?'点击预览原动图；右键选择发送帧':'点击预览发送副本');open.setAttribute('aria-label','预览 '+s.image.name);thumbnail.alt=s.image.name;const src=safeImageSource(s.image.src);if(thumbnail.getAttribute('src')!==src&&!original){decoded=false;if(src)thumbnail.src=src;else thumbnail.removeAttribute('src');}thumbnail.hidden=!src||!!s.error;open.disabled=!src||!!s.error||!decoded;
    const sentFrames=frames;for(const badge of root.querySelectorAll('.frame-badge'))badge.remove();for(const index of sentFrames){const badge=document.createElement('span');badge.className='frame-badge';badge.textContent='第 '+String(index+1)+' 帧';root.insertBefore(badge,remove);}if(sentFrames.length){const more=document.createElement('span');more.className='frame-badge frame-badge-more';more.hidden=true;root.insertBefore(more,remove);fitFrameBadges(root);}
    if(s.animation&&!original){const currentSource=this.identity(s),loader=original=new Image();void s.animation.load().then(value=>{if(root.isConnected&&currentSource()){loader.onload=()=>{if(root.isConnected&&currentSource()){decoded=true;open.disabled=false;thumbnail.src=value.src;}};loader.src=value.src;}}).catch(()=>{});}
   },dispose:()=>{observer?.disconnect();if(original){original.onload=original.onerror=null;original.removeAttribute('src');}thumbnail.onload=thumbnail.onerror=null;thumbnail.removeAttribute('src');root.remove();}};
 }
}
/** webview.ts 463–464,731,737–748; button wrapper only adds keyboard access. */
export const DRAFT_IMAGE_STYLE=`
 #composer .draft-zone { max-height:min(45vh,340px); overflow-y:auto; scrollbar-width:thin; }
 #composer .attachments { display:flex; flex-wrap:wrap; gap:5px; padding:8px 10px 0; }
 #composer .attachment-chip:not([hidden]) { min-width:0; max-width:100%; display:flex; align-items:center; gap:5px; padding:3px 5px 3px 3px; box-sizing:border-box; border:1px solid var(--vscode-widget-border); border-radius:6px; color:var(--vscode-descriptionForeground); background:var(--vscode-editor-background); }
 #composer .attachment-chip:hover { border-color:color-mix(in srgb,var(--vscode-charts-blue,#4d6bfe) 45%,var(--vscode-widget-border)); }
 #composer .attachment-chip span { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
 #composer .attachment-chip #attachment { padding:0; }
 #composer .attachments:not(:has([data-image-token])) { padding:0; }
 #composer .attachment-chip button:first-child { padding:0; border:0; border-radius:6px; flex:0 0 32px; width:32px; height:32px; background:transparent; }
 #composer .attach-thumb { width:32px; height:32px; margin:0; border-radius:6px; object-fit:cover; background:var(--vscode-editor-background); display:block; }
 #composer .attach-thumb[hidden] { display:none; }
 #composer .attachment-chip .attachment-remove { box-sizing:border-box; flex:0 0 18px; width:18px; height:18px; padding:2px 0; border:0; border-radius:4px; background:transparent; display:inline-flex; align-items:center; justify-content:center; font-size:13px; line-height:1; }
 #composer .attachment-remove:hover { background:var(--vscode-toolbar-hoverBackground); }
`;
