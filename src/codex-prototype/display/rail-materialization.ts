/** DSH history-merge: keep spacing while public reads and subsequent layout settle. */
export const RAIL_MERGE_SETTLE_MS=1200,RAIL_MERGE_QUIET_MS=900,RAIL_MERGE_MAX_MS=60_000;
/** Original linear rail thumb glide; materialization settlement also covers small high-refresh jumps. */
export function railMergeThumbPosition(from:number,to:number,elapsedMs:number){const duration=Math.max(260,Math.abs(to-from)/1.2),progress=Math.max(0,Math.min(1,elapsedMs/duration));return{top:from+(to-from)*progress,done:progress>=1};}
/** A visual-only glide; real input and owner changes cancel it without touching body position. */
export class RailMergeThumb {
 private glide:{from:number;to:number;at:number}|undefined;private frame:number|undefined;
 constructor(private show:(top:number)=>void,private read:()=>number){}
 set(top:number,animate=false){const shown=this.read(),glide=this.glide;if(glide){if(Math.abs(top-glide.to)>=1){glide.from=shown;glide.to=top;glide.at=performance.now();}return;}if(animate&&Number.isFinite(shown)&&Math.abs(top-shown)>0.01){this.glide={from:shown,to:top,at:performance.now()};this.frame=requestAnimationFrame(this.step);return;}this.show(top);}
 cancel(){if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined;this.glide=undefined;}
 private step=(now:number)=>{this.frame=undefined;const glide=this.glide;if(!glide)return;const value=railMergeThumbPosition(glide.from,glide.to,now-glide.at);this.show(value.top);if(value.done)this.glide=undefined;else this.frame=requestAnimationFrame(this.step);};
}
export class RailMaterialization {
 private reading=false;private active=false;private dead=false;private timer:ReturnType<typeof setTimeout>|undefined;private limit:ReturnType<typeof setTimeout>|undefined;
 constructor(private settle:()=>void){}
 get held(){return this.active;}
 observe(loading:boolean,hasLayout:boolean){
  if(this.dead)return;const started=loading&&!this.reading,finished=!loading&&this.reading;this.reading=loading;
  if(started&&hasLayout&&!this.active){this.active=true;this.limit=setTimeout(()=>this.release(),RAIL_MERGE_MAX_MS);}
  if(!this.active)return;
  if(loading){clearTimeout(this.timer);this.timer=undefined;}else if(finished)this.arm(RAIL_MERGE_SETTLE_MS);
 }
 changed(){if(this.active&&!this.reading)this.arm(RAIL_MERGE_QUIET_MS);}
 private arm(ms:number){clearTimeout(this.timer);this.timer=setTimeout(()=>this.release(),ms);}
 release(){clearTimeout(this.timer);clearTimeout(this.limit);this.timer=this.limit=undefined;if(!this.active)return;this.active=false;if(!this.dead)this.settle();}
 reset(){this.reading=false;this.release();}
 dispose(){this.dead=true;this.reset();}
}
