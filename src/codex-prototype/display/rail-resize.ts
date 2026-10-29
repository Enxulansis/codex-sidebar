/** DSH 165's 900ms resize correction window, released by explicit user takeover. */
export const RAIL_RESIZE_SETTLE_MS=900;
export class RailResizeFreeze {
 private width:number|undefined;private height:number|undefined;private timer:ReturnType<typeof setTimeout>|undefined;private frozen=false;private dead=false;
 constructor(private hold:()=>void,private settle:()=>void){}
 get held(){return this.frozen;}
 observe(width:number,height:number,hasLayout:boolean){
  if(this.dead)return;
  if(width<=0||height<=0){this.reset();return;}
  const changed=this.width!==undefined&&(this.width!==width||this.height!==height);this.width=width;this.height=height;
  if(!changed||!hasLayout)return;
  if(!this.frozen){this.frozen=true;this.hold();}
  clearTimeout(this.timer);this.timer=setTimeout(()=>this.release(),RAIL_RESIZE_SETTLE_MS);
 }
 release(){clearTimeout(this.timer);this.timer=undefined;if(!this.frozen)return;this.frozen=false;if(!this.dead)this.settle();}
 reset(){this.release();this.width=this.height=undefined;}
 dispose(){this.dead=true;this.release();this.width=this.height=undefined;}
}
