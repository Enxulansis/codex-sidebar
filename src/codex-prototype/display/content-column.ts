import {normalizeContentMaxWidth} from '../display-settings';
type Anchor={article:HTMLElement;text?:Text;offset?:number;top:number;articleTop:number}|{bottom:true};
/** Explicit width edits only; this does not implement rail/long-history resize recovery. */
export class ContentColumn{
 private value:number|undefined;private frame:number|undefined;private serial=0;private observer:ResizeObserver;private available:number|undefined;
 constructor(private history:HTMLElement){history.addEventListener('wheel',this.cancel,{passive:true});history.addEventListener('pointerdown',this.cancel);history.addEventListener('keydown',this.cancel);const composer=document.getElementById('composer'),column=composer?.parentElement??composer;this.observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(column&&width!==undefined&&width>0&&width!==this.available){this.available=width;column.style.setProperty('--column-available',width+'px');}});this.observer.observe(history);window.addEventListener('pagehide',this.dispose,{once:true});}
 apply(raw=760){const value=normalizeContentMaxWidth(raw);if(value===this.value)return;this.cancel();const anchor=this.capture(),serial=this.serial;this.value=value;document.documentElement.style.setProperty('--content-max',String(value===-1?100000:value)+'px');this.restore(anchor);this.frame=requestAnimationFrame(()=>{this.frame=undefined;if(serial===this.serial)this.restore(anchor);});}
 private capture():Anchor|undefined{
  const h=this.history;if(h.scrollHeight-h.scrollTop-h.clientHeight<40)return{bottom:true};const box=h.getBoundingClientRect(),article=Array.from(h.children).find(e=>e.getBoundingClientRect().bottom>box.top+4) as HTMLElement|undefined;if(!article)return;
  const r=article.getBoundingClientRect(),anchor:Anchor={article,top:r.top-box.top,articleTop:r.top-box.top},walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT);
  // Geometry still works under the settings overlay; caretFromPoint would hit its controls instead.
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   const text=node as Text;if(!text.length||text.parentElement?.closest('.message-actions,.hover-actions,.block-actions,.math-copy'))continue;const range=document.createRange();range.selectNodeContents(text);const whole=range.getBoundingClientRect();if(whole.height<=0||whole.bottom<=box.top+4||whole.top>=box.bottom)continue;
   const rectAt=(offset:number)=>{range.setStart(text,offset);range.setEnd(text,offset+1);return range.getBoundingClientRect();};let low=0,high=text.length-1;while(low<high){const mid=Math.floor((low+high)/2);if(rectAt(mid).bottom>box.top+4)high=mid;else low=mid+1;}const rect=rectAt(low);if(rect.height>0){anchor.text=text;anchor.offset=low;anchor.top=rect.top-box.top;break;}
  }
  return anchor;
 }
 private restore(anchor:Anchor|undefined){if(!anchor)return;const h=this.history;if('bottom'in anchor){h.scrollTop=h.scrollHeight;return;}if(!anchor.article.isConnected)return;let rect:DOMRect|undefined,top=anchor.articleTop;if(anchor.text?.isConnected&&anchor.offset!==undefined){const range=document.createRange();range.setStart(anchor.text,anchor.offset);range.setEnd(anchor.text,Math.min(anchor.text.length,anchor.offset+1));const r=range.getBoundingClientRect();if(r.height>0){rect=r;top=anchor.top;}}rect??=anchor.article.getBoundingClientRect();if(rect.height>0)h.scrollTop+=rect.top-h.getBoundingClientRect().top-top;}
 private cancel=()=>{this.serial++;if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined;};
 reset(){this.cancel();}
 dispose=()=>{this.cancel();this.observer.disconnect();this.history.removeEventListener('wheel',this.cancel);this.history.removeEventListener('pointerdown',this.cancel);this.history.removeEventListener('keydown',this.cancel);window.removeEventListener('pagehide',this.dispose);};
}
