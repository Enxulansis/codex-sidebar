/** DSH 165 layoutTurnRail / railMapC2R / railMapR2C, parameterized with measured public-node geometry. */
import type {RailViewport} from '../scroll-view-store';
export type RailLayout={y:number[];offsets:number[];tail:number;contentH:number;thumbLen:number};
/** Preserve displayed spacing, never the stale body axis (DSH history-merge/drag). */
export function preserveRailSpacing(previous:RailLayout,next:RailLayout):RailLayout{return{...previous,offsets:next.offsets};}
/** The node's public identity survives prefix insertion and layout scaling. */
export function captureRailViewport(ids:readonly string[],y:readonly number[],scrollTop:number):RailViewport|undefined{if(!ids.length||ids.length!==y.length)return;let index=0;for(let i=0;i<y.length;i++)if(y[i]!<=scrollTop)index=i;else break;return{scrollTop:Math.max(0,scrollTop),anchor:{turnId:ids[index]!,offset:scrollTop-y[index]!}};}
export function restoreRailViewport(memo:RailViewport,ids:readonly string[],y:readonly number[],maxScroll:number){const index=memo.anchor?ids.indexOf(memo.anchor.turnId):-1,matched=!memo.anchor||index>=0&&index<y.length,top=matched&&memo.anchor?y[index]!+memo.anchor.offset:memo.scrollTop;return{top:Math.max(0,Math.min(Math.max(0,maxScroll),top)),matched};}
/** Ordinary restore/fresh body intent moves only as far as needed to expose the thumb. */
export function exposeRailThumb(scrollTop:number,thumbTop:number,thumbLength:number,clipHeight:number,maxScroll:number){const next=thumbTop<scrollTop?thumbTop:thumbTop+thumbLength>scrollTop+clipHeight?thumbTop+thumbLength-clipHeight:scrollTop;return Math.max(0,Math.min(Math.max(0,maxScroll),next));}
export function layoutRail(tops:(number|undefined)[],pending:boolean[],clipHeight:number,totalHeight:number,viewportHeight:number,minGap=20):RailLayout{
 const PAD=12,TAIL=76,PITCH=28,MAX_GAP=112,EH_FLOOR=200,n=tops.length,avail=Math.max(80,clipHeight-PAD*2),offsets:number[]=[];
 let last=0;for(let i=0;i<n;i++){const top=tops[i],measured=typeof top==='number'&&Number.isFinite(top)&&top>=last;const value=measured?top:pending[i]?last:last+400;offsets.push(value);last=value;}
 if(!n)return{y:[],offsets,tail:TAIL,contentH:clipHeight,thumbLen:32};
 const heights=offsets.map((value,i)=>Math.max(40,(i+1<n?offsets[i+1]!:totalHeight)-value)),measured=heights.filter((_,i)=>!pending[i]);
 const nominal=measured.length?Math.max(EH_FLOOR,measured.reduce((a,b)=>a+b,0)/measured.length):EH_FLOOR,eh=heights.map((value,i)=>pending[i]?nominal:Math.max(value,EH_FLOOR)),avg=Math.max(1,eh.reduce((a,b)=>a+b,0)/n);
 const gap=(i:number)=>Math.min(MAX_GAP,Math.max(minGap,PITCH*eh[i]!/avg)),gaps=Array.from({length:n-1},(_,i)=>gap(i)),sum=gaps.reduce((a,b)=>a+b,0),tailBase=gap(n-1);
 let scale=1;if(sum+tailBase<=avail){scale=avail/Math.max(1,sum+tailBase);if(sum>0&&tailBase*scale<TAIL)scale=Math.max(1,(avail-TAIL)/Math.max(1,sum));}
 const y:number[]=[];let acc=PAD;for(let i=0;i<n;i++){y.push(acc);if(i<n-1)acc+=gaps[i]!*scale;}
 const tail=Math.max(tailBase*scale,TAIL),contentH=Math.max(clipHeight,acc+tail+PAD),travel=Math.max(1,y[n-1]!+tail-y[0]!);
 return{y,offsets,tail,contentH,thumbLen:Math.max(32,Math.min(72,Math.round(travel*Math.max(0,viewportHeight)/Math.max(1,totalHeight))))};
}
function axis(layout:RailLayout,maxScroll:number){const anchors=layout.offsets.map(value=>Math.max(0,Math.min(maxScroll,value))),from=anchors.findIndex(value=>value>=maxScroll);return{anchors,tail:maxScroll>0&&from>0?{from,start:anchors[from-1]!,span:maxScroll-anchors[from-1]!}:undefined};}
const endY=(layout:RailLayout)=>layout.y.at(-1)!+Math.max(0,layout.tail-layout.thumbLen);
/** DSH 165 updateRailActive uses the same tail axis as the thumb, including clamped last nodes. */
export function railActiveIndex(layout:RailLayout,scrollTop:number,maxScroll:number,visible?:readonly boolean[]){
 let active=0;
 if(layout.offsets.length&&maxScroll>0){const {anchors,tail}=axis(layout,maxScroll),p=Math.max(0,Math.min(maxScroll,scrollTop));
  if(tail&&p>=tail.start){const base=tail.from-1,f=tail.span>0?(p-tail.start)/tail.span:1;active=Math.min(anchors.length-1,base+Math.floor(f*(anchors.length-base)));}
  else for(let i=0;i<anchors.length;i++){if(anchors[i]!<=p+2)active=i;else break;}
 }
 // Public outlines can include unloaded nodes sharing a measured predecessor's axis.
 // Scrolling cannot enter absent bodies: retain the actual rendered predecessor.
 if(!visible||visible[active])return active;for(let i=active-1;i>=0;i--)if(visible[i])return i;
 const first=visible.findIndex(Boolean);return first>=0?first:active;
}
export function contentToRail(layout:RailLayout,scrollTop:number,maxScroll:number){
 if(!layout.y.length)return 0;const {anchors,tail}=axis(layout,maxScroll),p=Math.max(0,Math.min(maxScroll,scrollTop)),end=endY(layout);
 if(tail&&p>=tail.start)return layout.y[tail.from-1]!+(tail.span>0?(p-tail.start)/tail.span:1)*(end-layout.y[tail.from-1]!);
 let k=0;for(let i=0;i<anchors.length;i++){if(anchors[i]!<=p)k=i;else break;}
 if(k<anchors.length-1){const span=anchors[k+1]!-anchors[k]!,f=span>0?Math.max(0,Math.min(1,(p-anchors[k]!)/span)):0;return layout.y[k]!+f*(layout.y[k+1]!-layout.y[k]!);}
 const span=maxScroll-anchors[k]!,f=span>0?Math.max(0,Math.min(1,(p-anchors[k]!)/span)):1;return layout.y[k]!+f*(end-layout.y[k]!);
}
export function railToContent(layout:RailLayout,value:number,maxScroll:number){
 if(!layout.y.length||maxScroll<=0)return 0;const {anchors,tail}=axis(layout,maxScroll),p=Math.max(0,Math.min(layout.y.at(-1)!+layout.tail,value)),end=endY(layout);
 if(tail){const base=layout.y[tail.from-1]!,span=end-base;if(span>0&&p>=base)return tail.start+Math.max(0,Math.min(1,(p-base)/span))*tail.span;}
 if(p<=layout.y[0]!)return 0;let k=0;for(let i=0;i<layout.y.length;i++){if(layout.y[i]!<=p)k=i;else break;}
 if(k<layout.y.length-1&&layout.y[k+1]!>layout.y[k]!){const f=(p-layout.y[k]!)/(layout.y[k+1]!-layout.y[k]!);return anchors[k]!+f*(anchors[k+1]!-anchors[k]!);}
 const f=Math.max(0,Math.min(1,(p-layout.y[k]!)/Math.max(1,end-layout.y[k]!)));return anchors[k]!+f*Math.max(1,maxScroll-anchors[k]!);
}
