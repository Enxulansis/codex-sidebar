/** Codex resource/identity adapter around the DSH 0.1.165 static preview. */
import {mountDshStaticPreview,type PreviewLimits} from './dsh-static-preview';
import {showCopyMenu,showFormulaToast} from './dsh-math-export';
import {imageExportFeedback} from '../image-export-name';
import {normalizeDisplaySettings,type DisplaySettings} from '../display-settings';
import {AnimationPreview,type AnimationPreviewSource} from './animation-preview';
import {IMAGE_DECODE_PIXELS,imageDimensions,type ImageOriginInfo} from '../image-formats';
import type {ReferenceImageSource} from '../reference-image';
import {checkedReferenceImage} from './reference-image';
import {verifyStaticAnimationContainer} from './animated-image';
import {prepareImage} from './image-conversion';
export function previewLimits(value?:Partial<DisplaySettings>){const s=normalizeDisplaySettings(value);return {minScale:s.previewMinScale,maxScale:s.previewMaxScale};}
export type DisplayImage = {id: string; name: string; src?: string|undefined;originHint?:ImageOriginInfo;originUnavailable?:string;originalInput?:boolean};
export type PreviewEntry = {image:DisplayImage;isCurrent:()=>boolean;onError:()=>void;animation?:AnimationPreviewSource;onReady?:()=>void;onFailure?:(error:unknown)=>void};
const cardEntries=new WeakMap<HTMLElement,PreviewEntry>();
type FocusImageOrigin={threadId:string;turnId:string;itemId:string;imageId:string;index:number;isCurrent:()=>boolean};
const canReturnFocus=(element:HTMLElement|undefined)=>!!element?.isConnected&&!element.matches(':disabled')&&element.getClientRects().length>0;
const originalAnimations=new WeakMap<HTMLElement,AnimationPreviewSource>();
/** Original animation is an explicit source preview; the normal card/gallery stays on actual input PNGs. */
export function bindOriginalAnimation(card:HTMLElement,source:AnimationPreviewSource){originalAnimations.set(card,source);}
/** Original messageGalleryOf: only direct siblings in this image strip. */
function messageGalleryOf(card:HTMLElement):PreviewEntry[]{
  const entries:PreviewEntry[]=[];
  for(const sibling of Array.from(card.parentElement?.children??[])){
    const entry=cardEntries.get(sibling as HTMLElement);
    if(entry&&!(sibling as HTMLButtonElement).disabled&&safeImageSource(entry.image.src)&&entry.isCurrent())entries.push(entry);
  }
  return entries;
}
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024; // Preserve the prototype's PNG/JPEG input bound.
export function safeImageSource(src: string | undefined): string | undefined {
  if (!src || src.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 + 23 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) return;
  const body = src.slice(src.indexOf(',') + 1), padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0;
  if (body.length % 4 || body.length * 3 / 4 - padding > MAX_PREVIEW_BYTES) return;
  return src;
}
export class ImagePreview {
  private image: HTMLImageElement | undefined;
  private loading: HTMLImageElement | undefined;
  private sourceIsCurrent: (() => boolean) | undefined;
  private gallery:PreviewEntry[]=[];
  private failed=new Set<PreviewEntry>();
  private current:PreviewEntry|undefined;
  private selected:PreviewEntry|undefined;
  private token = 0;
  private preview: ReturnType<typeof mountDshStaticPreview>;
  private animation:AnimationPreview|undefined;
  private referencePreparation:AbortController|undefined;
  private referenceSources=new WeakMap<DisplayImage,string>();
  private referenceCaption:HTMLElement|undefined;
  private focusOrigin:WeakRef<HTMLElement>|undefined;
  private focusImageOrigin:FocusImageOrigin|undefined;
  readonly overlay: HTMLDivElement;
  constructor(settings: () => PreviewLimits | undefined = () => undefined,private autoplay:()=>boolean=()=>true) {
    this.preview=mountDshStaticPreview(rightClick=>this.close(rightClick,true),settings,delta=>this.step(delta));
    this.overlay=this.preview.overlay;
    window.addEventListener('keydown',event=>{if(event.key==='Escape'&&(this.loading||this.animation?.isOpening)){event.preventDefault();this.close(undefined,true);}});
  }
  openAnimation(image:DisplayImage,animation:AnimationPreviewSource,isCurrent:()=>boolean,onError:()=>void,transition:Pick<PreviewEntry,'onReady'|'onFailure'>={}){this.open(image,isCurrent,onError,[{image,animation,isCurrent,onError,...transition}]);}
  /** Explicit current-disk snapshot; no import, send, sidecar or export authority. */
  async openReference(source:ReferenceImageSource,isCurrent:()=>boolean):Promise<void>{
    this.close();this.rememberFocus();const controller=new AbortController();this.referencePreparation=controller;
    const current=()=>this.referencePreparation===controller&&!controller.signal.aborted&&isCurrent(),timer=setTimeout(()=>controller.abort(),25000);
    try{
      const checked=await checkedReferenceImage(source,current);let src=checked.src,note='';
      if(['image/svg+xml','image/tiff'].includes(checked.info.mime)){const prepared=await prepareImage(source.name,src,controller.signal);src=`data:${prepared.mime};base64,${prepared.base64}`;note=' · 转换预览副本'+(prepared.note?'：'+prepared.note.replaceAll('发送副本','预览副本'):'');}
      else{const size=imageDimensions(checked.bytes,checked.info.mime);if(!size||size.width*size.height>IMAGE_DECODE_PIXELS)throw Error('图片尺寸未知或超过16M像素预览上限，未全量展开');if(!checked.info.animated)await verifyStaticAnimationContainer(checked.bytes,checked.info.mime,controller.signal);}
      if(!current())throw Error('图片引用所属页面或线程已失效');
      const image:DisplayImage={id:'file-reference:'+source.sha256,name:source.name,src},caption=document.createElement('div');caption.className='preview-reference-source';caption.textContent=source.name+' · 当前磁盘快照，原文件未改动'+note;caption.style.cssText='max-width:100%;overflow-wrap:anywhere;text-align:center;color:var(--vscode-descriptionForeground);font-size:11px';this.referenceCaption=caption;this.overlay.querySelector('.preview-bar')!.append(caption);this.referenceSources.set(image,src);
      const info:ImageOriginInfo={name:source.name,mime:source.mime,size:source.size,sha256:source.sha256,animated:source.animated,transformation:'animation'};
      await new Promise<void>((resolve,reject)=>{const abort=()=>reject(Error('图片引用预览已取消或超时'));controller.signal.addEventListener('abort',abort,{once:true});const done=()=>{controller.signal.removeEventListener('abort',abort);if(!current())reject(Error('图片引用显示身份已失效'));else{this.overlay.dataset.referenceSha256=source.sha256;resolve();}},failed=(error:unknown)=>{controller.signal.removeEventListener('abort',abort);reject(error instanceof Error?error:Error('图片引用无法解码'));},entry:PreviewEntry={image,isCurrent:current,onError:()=>failed(Error('图片引用无法解码')),onFailure:failed,onReady:done,...(source.animated?{animation:{origin:info,load:async()=>({src:checked.src,info})}}:{})};this.gallery=[entry];this.load(entry);});
    }catch(error){if(this.referencePreparation===controller)this.close();throw error;}finally{clearTimeout(timer);}
  }
  open(image: DisplayImage, isCurrent: () => boolean, onError: () => void,gallery:PreviewEntry[]=[]): void {
    this.close();
    this.rememberFocus();
    const entry=gallery.find(v=>v.image===image)??{image,isCurrent,onError};
    this.gallery=gallery.length?gallery.slice():[entry];
    if(!this.gallery.includes(entry))this.gallery.push(entry);
    this.load(entry);
  }
  private rememberFocus(){
    const active=document.activeElement;this.focusOrigin=active instanceof HTMLElement&&active!==document.body&&!this.overlay.contains(active)?new WeakRef(active):undefined;
    const card=active instanceof HTMLElement?active.closest<HTMLElement>('.image-card'):null,row=card?.closest<HTMLElement>('article[data-thread-id][data-turn-id][data-item-id]'),entry=card?cardEntries.get(card):undefined;
    this.focusImageOrigin=card&&row&&entry?{threadId:row.dataset.threadId!,turnId:row.dataset.turnId!,itemId:row.dataset.itemId!,imageId:entry.image.id,index:Array.from(row.querySelectorAll('.image-card')).indexOf(card),isCurrent:entry.isCurrent}:undefined;
  }
  private currentImageFocusOrigin(){
    const origin=this.focusImageOrigin;if(!origin?.isCurrent())return;
    const row=Array.from(document.getElementById('history')?.children??[]).find(element=>{const data=(element as HTMLElement).dataset;return data.threadId===origin.threadId&&data.turnId===origin.turnId&&data.itemId===origin.itemId;});
    const card=row?.querySelectorAll<HTMLElement>('.image-card')[origin.index];
    return card?.dataset.imageId===origin.imageId&&cardEntries.get(card)?.isCurrent()?card:undefined;
  }
  private sourceOf(image:DisplayImage){return this.referenceSources.get(image)??safeImageSource(image.src);}
  private liveGallery(){return this.gallery.filter(e=>!this.failed.has(e)&&!!this.sourceOf(e.image)&&e.isCurrent());}
  private updatePosition(){const entries=this.liveGallery(),index=entries.indexOf(this.current!);this.preview.galleryPosition(Math.max(0,index),entries.length);if(this.animation?.isActive)this.animation.refresh();}
  private release(img:HTMLImageElement|undefined){if(img){img.onload=img.onerror=null;img.removeAttribute('src');}}
  private load(entry:PreviewEntry){
    const src=this.sourceOf(entry.image);
    const current=entry.isCurrent();
    if(!src||!current){if(!src&&current){entry.onError();entry.onFailure?.(Error('图片预览来源不可用'));}if(!this.current)this.close();return;}
    this.release(this.loading);this.loading=undefined;
    this.selected=entry;this.sourceIsCurrent=entry.isCurrent;
    this.animation?.cancelOpening();
    if(entry.animation){const token=++this.token,animation=this.animation??=new AnimationPreview(this.preview,this.autoplay,()=>this.close());void animation.open(entry.animation,entry.isCurrent,()=>{this.release(this.image);this.image=undefined;this.current=this.selected=entry;this.overlay.dataset.imageId=entry.image.id;this.overlay.dataset.name=entry.image.name;this.updatePosition();this.overlay.tabIndex=-1;this.overlay.focus();entry.onReady?.();},()=>token===this.token&&entry.isCurrent()).catch(error=>{if(token!==this.token)return;if(entry.onFailure)entry.onFailure(error);else if(entry.isCurrent())showFormulaToast(error instanceof Error?error.message:'动图无法解码',true);if(!this.current)this.close();});return;}
    const token=++this.token,img=new Image();this.loading=img;
    img.onload = () => {
      if (token !== this.token) return;
      if (!entry.isCurrent()) { this.close(); return; }
      img.onload=img.onerror=null;
      const old=this.image;
      this.animation?.close();
      this.loading=undefined;this.image=img;this.current=this.selected=entry;
      this.overlay.dataset.imageId=entry.image.id;this.overlay.dataset.name=entry.image.name;
      this.updatePosition();
      this.preview.show(img); this.overlay.tabIndex = -1; this.overlay.focus();entry.onReady?.();
      this.release(old);
    };
    img.onerror = () => {
      if(token!==this.token)return;
      this.loading=undefined;this.release(img);this.failed.add(entry);
      const valid=entry.isCurrent();
      if(valid)entry.onError();
      if(this.current?.isCurrent()){
        this.selected=this.current;this.sourceIsCurrent=this.current.isCurrent;this.updatePosition();
        if(valid)showFormulaToast('图片无法解码，已跳过',true);
      }else this.close();
    };
    img.src = src;
  }
  private step(delta:number){
    if(this.animation?.isActive){this.animation.step(delta);return;}
    const entries=this.liveGallery();if(entries.length<2)return;
    const index=entries.indexOf(this.selected??this.current!),next=(Math.max(0,index)+delta+entries.length)%entries.length;
    this.load(entries[next]!);
  }
  // Rendering may replace cards while keeping the same source. Do not close a
  // valid preview for that; only release a removed/replaced source or owner.
  closeIfStale():void { if((this.current&&!this.current.isCurrent())||(this.sourceIsCurrent&&!this.sourceIsCurrent()))this.close();else if(this.current)this.updatePosition(); }
  applyLimits(){this.preview.applyLimits();}
  close(rightClick?: boolean,manual=false): void {
    const active=document.activeElement,returnAllowed=manual&&(this.overlay.contains(active)||active===document.body);let returnFocus=returnAllowed?this.focusOrigin?.deref():undefined;
    if(returnAllowed&&!canReturnFocus(returnFocus))returnFocus=this.currentImageFocusOrigin();this.focusOrigin=undefined;this.focusImageOrigin=undefined;
    const reference=this.referencePreparation;this.referencePreparation=undefined;reference?.abort();this.referenceCaption?.remove();this.referenceCaption=undefined;delete this.overlay.dataset.referenceSha256;
    const returnPicker=this.animation?.close(manual);
    this.token++; this.preview.close(rightClick);
    for (const img of [this.loading, this.image])this.release(img);
    this.loading = this.image = undefined;this.sourceIsCurrent=undefined; delete this.overlay.dataset.imageId; delete this.overlay.dataset.name;
    this.current=this.selected=undefined;this.gallery=[];this.failed.clear();this.preview.galleryPosition(0,0);
    if(returnPicker)queueMicrotask(returnPicker);
    else if(returnFocus&&canReturnFocus(returnFocus))returnFocus.focus({preventScroll:true});
  }
}
export function imageCard(image: DisplayImage, preview: ImagePreview, isCurrent: () => boolean,exporting?:{format:'original'|'png';run:(kind:'name'|'original'|'png'|'save')=>Promise<string>}): HTMLElement {
  const card = document.createElement('button'); card.type='button'; card.className='image-card'; card.dataset.imageId=image.id;
  if(image.originUnavailable)card.title=image.originUnavailable;else if(image.originHint?.animated)card.title=image.originalInput?'已向Codex提交原动图；多帧理解未保证，右键可预览原动图':'实际发送的静态PNG；右键可预览原动图';
  const name=document.createElement('span'); name.textContent=image.name; card.append(name);
  const missing=()=>{if(!isCurrent())return;card.classList.add('missing-image');card.replaceChildren(document.createTextNode(image.name+' · 图片缺失或无法解码'));card.disabled=true;};
  const src=safeImageSource(image.src); if (!src) { missing(); return card; }
  const img=document.createElement('img'); img.alt=image.name; img.onload=()=>{if(isCurrent())card.dataset.decoded='true';}; img.onerror=missing; img.src=src; card.prepend(img);
  cardEntries.set(card,{image,isCurrent,onError:missing});
  card.onclick=()=>{if(isCurrent()&&card.isConnected)preview.open(image,isCurrent,missing,messageGalleryOf(card));};
  if(exporting)card.addEventListener('contextmenu',e=>{if(!isCurrent()||!card.isConnected||card.dataset.decoded!=='true')return;e.preventDefault();e.stopPropagation();const valid=()=>isCurrent()&&card.isConnected&&!card.disabled,option=(kind:'name'|'original'|'png'|'save',label:string)=>({label,run:async()=>{try{const result=await exporting.run(kind),feedback=imageExportFeedback(image.name,src.startsWith('data:image/png;')?'png':'jpg',kind,result,image.originHint?.name);if(valid()&&feedback)showFormulaToast(feedback);}catch(error){if(valid())showFormulaToast(error instanceof Error?error.message:'图片操作失败，请重试',true);}}}),original=option('original','复制原格式'),png=option('png','复制 PNG'),animation=originalAnimations.get(card);showCopyMenu(e,valid,[...(animation?[{label:'预览原动图',run:async()=>{if(valid())preview.openAnimation(image,animation,isCurrent,()=>{});}}]:[]),option('name','复制文件名'),...(exporting.format==='png'?[png,original]:[original,png]),option('save','另存为…')]);});
  return card;
}
