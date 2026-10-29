/** DSH165 webview.ts:13793-13888: center once, then correct only offscreen drift; input wins. */
export const SEARCH_LANDING_MS=4500,SEARCH_LANDING_FIRST_MS=120,SEARCH_LANDING_TICK_MS=200,SEARCH_LANDING_EDGE_PX=12;
export type SearchLandingRect=Pick<DOMRectReadOnly,'top'|'bottom'|'height'>;
export type SearchLandingTarget={match?:SearchLandingRect|undefined;fallback?:SearchLandingRect|undefined};
const measurable=(r:SearchLandingRect)=>[r.top,r.bottom,r.height].every(Number.isFinite)&&r.height>0&&r.bottom>r.top;
export function searchCenterTop(scrollTop:number,viewport:SearchLandingRect,target:SearchLandingRect){if(!Number.isFinite(scrollTop)||scrollTop<0||!measurable(viewport)||!measurable(target))return;return scrollTop+target.top-viewport.top-(viewport.height-target.height)/2;}
export function searchMatchOutside(viewport:SearchLandingRect,target:SearchLandingRect){return measurable(viewport)&&measurable(target)&&(target.bottom<viewport.top+SEARCH_LANDING_EDGE_PX||target.top>viewport.bottom-SEARCH_LANDING_EDGE_PX);}
export class SearchLanding {
 private timer:ReturnType<typeof setTimeout>|undefined;private version=0;private dead=false;
 get settling(){return this.timer!==undefined;}
 constructor(private history:HTMLElement,private seek:(top:number)=>void){history.addEventListener('wheel',this.cancel,{passive:true});history.addEventListener('pointerdown',this.cancel,{passive:true});history.addEventListener('navigation-input',this.cancel);document.addEventListener('keydown',this.cancel,{passive:true});document.addEventListener('visibilitychange',this.visibility);window.addEventListener('blur',this.cancel);}
 private viewport(){return this.history.clientWidth>0&&this.history.clientHeight>0?this.history.getBoundingClientRect():undefined;}
 private center(viewport:SearchLandingRect,target:SearchLandingRect){const top=searchCenterTop(this.history.scrollTop,viewport,target);if(top!==undefined)this.seek(top);}
 start(resolve:()=>SearchLandingTarget|undefined){
  this.cancel();if(this.dead)return;const version=this.version,deadline=performance.now()+SEARCH_LANDING_MS,viewport=this.viewport(),target=resolve();if(!viewport||!target)return;
  const initial=target.match&&measurable(target.match)?target.match:target.fallback;if(initial)this.center(viewport,initial);
  const tick=()=>{this.timer=undefined;if(this.dead||version!==this.version)return;const remaining=deadline-performance.now();if(remaining<=0){this.cancel();return;}const viewport=this.viewport(),fresh=resolve();if(!viewport||!fresh){this.cancel();return;}if(fresh.match&&searchMatchOutside(viewport,fresh.match))this.center(viewport,fresh.match);if(version===this.version)this.timer=setTimeout(tick,Math.min(SEARCH_LANDING_TICK_MS,remaining));};
  this.timer=setTimeout(tick,SEARCH_LANDING_FIRST_MS);
 }
 cancel=()=>{this.version++;clearTimeout(this.timer);this.timer=undefined;};
 private visibility=()=>{if(document.hidden)this.cancel();};
 dispose(){if(this.dead)return;this.dead=true;this.cancel();this.history.removeEventListener('wheel',this.cancel);this.history.removeEventListener('pointerdown',this.cancel);this.history.removeEventListener('navigation-input',this.cancel);document.removeEventListener('keydown',this.cancel);document.removeEventListener('visibilitychange',this.visibility);window.removeEventListener('blur',this.cancel);}
}
