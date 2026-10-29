import {AnimatedImage} from './animated-image';
import type {mountDshStaticPreview} from './dsh-static-preview';
import {showFormulaToast} from './dsh-math-export';
import type {ImageOriginSource} from '../image-export-host';
import type {ImageOriginInfo} from '../image-formats';
export type AnimationPreviewSource={origin:ImageOriginInfo;load:()=>Promise<ImageOriginSource>;isCurrent?:()=>boolean;initialFrame?:number;selected?:()=>number[];toggle?:(index:number)=>Promise<void>;returnPicker?:()=>void};
type Active={source:AnimationPreviewSource;codec:AnimatedImage;controller:AbortController;current:()=>boolean;canvas:HTMLCanvasElement;index:number;duration:number;playing:boolean;timer:ReturnType<typeof setTimeout>|undefined;sequence:number;selecting:boolean};
/** Original playback row lives in the same preview bar as static geometry/hints. */
export class AnimationPreview {
 private active:Active|undefined;private opening:{controller:AbortController;source:AnimationPreviewSource;current:()=>boolean}|undefined;
 private controls:HTMLElement;private play:HTMLButtonElement;private previous:HTMLButtonElement;private next:HTMLButtonElement;private label:HTMLElement;private selectWrap:HTMLLabelElement;private select:HTMLInputElement;
 constructor(private preview:ReturnType<typeof mountDshStaticPreview>,private autoplay:()=>boolean,private stale:()=>void){
  const controls=document.createElement('div');controls.className='preview-controls hidden';controls.hidden=true;
  const button=(text:string)=>{const value=document.createElement('button');value.type='button';value.className='preview-action preview-action-text';value.textContent=text;controls.append(value);return value;};
  this.play=button('播放');this.previous=button('上一帧');this.next=button('下一帧');this.label=document.createElement('span');this.label.className='preview-frame-label';controls.append(this.label);this.selectWrap=document.createElement('label');this.selectWrap.className='preview-select';this.select=document.createElement('input');this.select.type='checkbox';this.selectWrap.append(this.select,document.createTextNode(' 选择发送'));controls.append(this.selectWrap);preview.overlay.querySelector('.preview-bar')!.prepend(controls);this.controls=controls;
  this.play.onclick=()=>{const active=this.active;if(!active||active.selecting)return;if(active.playing)this.stop(active);else{active.playing=true;this.schedule(active);}this.refresh();};this.previous.onclick=()=>this.step(-1);this.next.onclick=()=>this.step(1);
  this.select.onchange=()=>{const active=this.active;if(!active?.source.toggle||!active.current()||active.selecting)return;this.stop(active);active.selecting=true;this.refresh();void active.source.toggle(active.index).catch(error=>{if(this.active===active&&active.current())showFormulaToast(error instanceof Error?error.message:'选帧失败',true);}).finally(()=>{if(this.active===active){active.selecting=false;this.refresh();}});};
 }
 get isActive(){return !!this.active;}
 get isOpening(){return !!this.opening;}
 cancelOpening(){this.opening?.controller.abort();this.opening=undefined;}
 async open(source:AnimationPreviewSource,current:()=>boolean,ready:()=>void,valid:()=>boolean){
  this.opening?.controller.abort();const controller=new AbortController(),opening={controller,source,current};this.opening=opening;let codec:AnimatedImage|undefined,canvas:HTMLCanvasElement|undefined;
  try{const original=await source.load();if(!valid()||controller.signal.aborted)throw Error('动图来源已失效');if(original.info.sha256!==source.origin.sha256||!original.info.animated)throw Error('动图来源与显示摘要不一致');codec=await AnimatedImage.open(source.origin.name,original.src,controller.signal);if(source.origin.frameCount!==undefined&&codec.count!==source.origin.frameCount)throw Error('动图帧数与来源记录不一致');const frame=await codec.frame(source.initialFrame??0);canvas=frame.canvas;if(!valid()||controller.signal.aborted)throw Error('动图来源已失效');
   const old=this.active,active:Active={source,codec,controller,current,canvas,index:frame.index,duration:frame.durationMs,playing:false,timer:undefined,sequence:0,selecting:false};this.active=active;this.opening=undefined;if(old)this.dispose(old);this.refresh();this.preview.show(canvas);ready();if(source.initialFrame===undefined&&this.autoplay()){active.playing=true;this.schedule(active);this.refresh();}
  }catch(error){controller.abort();codec?.close();if(canvas)canvas.width=canvas.height=0;if(this.opening===opening)this.opening=undefined;throw error;}
 }
 private stop(active:Active){active.playing=false;active.sequence++;clearTimeout(active.timer);active.timer=undefined;}
 private schedule(active:Active){clearTimeout(active.timer);active.timer=setTimeout(()=>{active.timer=undefined;if(this.active!==active)return;if(!active.current()){this.stale();return;}void this.frame(active,active.index+1);},Math.min(2147483647,Math.max(30,active.duration)));}
 private async frame(active:Active,index:number){
  const sequence=++active.sequence;let canvas:HTMLCanvasElement|undefined;try{const frame=await active.codec.frame(((index%active.codec.count)+active.codec.count)%active.codec.count);canvas=frame.canvas;if(this.active!==active||sequence!==active.sequence||!active.current()){canvas.width=canvas.height=0;return;}const old=active.canvas;active.canvas=canvas;active.index=frame.index;active.duration=frame.durationMs;this.preview.show(canvas,false);old.width=old.height=0;this.refresh();if(active.playing)this.schedule(active);
  }catch(error){if(canvas)canvas.width=canvas.height=0;if(this.active===active&&sequence===active.sequence){this.stop(active);this.refresh();if(active.current())showFormulaToast(error instanceof Error?error.message:'动图帧无法解码',true);}}
 }
 step(delta:number){const active=this.active;if(!active||active.selecting)return;if(!active.current()){this.stale();return;}this.stop(active);void this.frame(active,active.index+delta);this.refresh();}
 refresh(){const active=this.active;this.controls.hidden=!active;this.controls.classList.toggle('hidden',!active);if(!active)return;this.play.textContent=active.playing?'停止':'播放';this.label.textContent='第 '+String(active.index+1)+' / '+String(active.codec.count)+' 帧';this.selectWrap.hidden=!active.source.toggle;this.select.checked=active.source.selected?.().includes(active.index)??false;for(const button of [this.play,this.previous,this.next])button.disabled=active.selecting;this.select.disabled=active.selecting;this.preview.overlay.dataset.frameIndex=String(active.index);this.preview.overlay.dataset.frameCount=String(active.codec.count);this.preview.overlay.dataset.playing=String(active.playing);const hint=this.preview.overlay.querySelector('.preview-hint-text');if(hint)hint.textContent='左键拖动 · 滚轮缩放 · 右键/ESC 退出 · ←/→ 翻帧'+(active.source.toggle?' · 勾选「选择发送」把该帧作为图片':'');}
 private dispose(active:Active){this.stop(active);active.controller.abort();active.codec.close();active.canvas.width=active.canvas.height=0;}
 close(manual=false){const active=this.active,opening=this.opening;this.active=this.opening=undefined;opening?.controller.abort();if(active)this.dispose(active);this.controls.hidden=true;this.controls.classList.add('hidden');for(const key of ['frameIndex','frameCount','playing'])delete this.preview.overlay.dataset[key];return manual&&(active?.current()||opening?.current())?(active?.source.returnPicker??opening?.source.returnPicker):undefined;}
}
