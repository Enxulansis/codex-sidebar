/** DSH165 railTweenStep: one replaceable target, exponential wheel convergence. */
const DEFAULT_TAU_SECONDS=.18;
export class RailColumnTween{
 private target:number|undefined;private direction=0;private frame:number|undefined;private last=0;
 constructor(private read:()=>number,private maximum:()=>number,private write:(top:number)=>void,private settled:()=>void,private reduced:()=>boolean){}
 by(delta:number){
  const direction=Math.sign(delta),base=this.target!==undefined&&direction===this.direction?this.target:this.read();
  this.target=Math.max(0,Math.min(this.maximum(),base+delta));this.direction=direction;
  if(this.reduced()){const top=this.target;this.cancel();this.write(top);this.settled();return;}
  if(this.frame===undefined){this.last=performance.now();this.frame=requestAnimationFrame(this.step);}
 }
 cancel(){if(this.frame!==undefined)cancelAnimationFrame(this.frame);this.frame=undefined;this.target=undefined;this.direction=0;}
 private step=(now:number)=>{
  this.frame=undefined;if(this.target===undefined)return;this.target=Math.max(0,Math.min(this.maximum(),this.target));
  const current=this.read(),diff=this.target-current,dt=Math.min(500,Math.max(8,now-this.last))/1000;this.last=now;
  let next=current+diff*(1-Math.exp(-dt/DEFAULT_TAU_SECONDS));if(Math.abs(next-current)<1)next=current+Math.sign(diff);
  if(this.reduced()||Math.abs(diff)<=1){next=this.target;this.write(next);this.cancel();this.settled();return;}
  this.write(next);this.frame=requestAnimationFrame(this.step);
 };
}
