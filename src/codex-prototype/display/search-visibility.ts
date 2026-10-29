/** DSH165 webview.ts:13084-13247: observe current DOM; preserve a visible cursor, then result order. */
export type SearchVisibleTarget={key:string;element:HTMLElement};
export function chooseSearchVisible(order:readonly string[],visible:ReadonlySet<string>,cursor=''){return cursor&&order.includes(cursor)&&visible.has(cursor)?cursor:order.find(key=>visible.has(key))??'';}
export class SearchVisibility {
 private observer:IntersectionObserver|undefined;private owner='';private targets:readonly SearchVisibleTarget[]=[];private version=0;private visible=new Set<string>();private dead=false;
 constructor(private root:HTMLElement,private changed:(keys:ReadonlySet<string>,order:readonly string[])=>void){}
 update(owner:string,targets:readonly SearchVisibleTarget[]){
  if(this.dead)return;
  if(owner===this.owner&&targets.length===this.targets.length&&targets.every((v,i)=>v.key===this.targets[i]!.key&&v.element===this.targets[i]!.element))return;
  this.observer?.disconnect();this.observer=undefined;const version=++this.version;this.owner=owner;this.targets=targets;this.visible.clear();this.changed(new Set(this.visible),targets.map(v=>v.key));
  if(!owner||!targets.length||typeof IntersectionObserver!=='function')return;
  const keys=new Map(targets.map(v=>[v.element,v.key]));this.observer=new IntersectionObserver(entries=>{
   if(version!==this.version||owner!==this.owner)return;
   for(const entry of entries){const key=keys.get(entry.target as HTMLElement);if(!key)continue;if(entry.isIntersecting&&entry.target.isConnected&&entry.intersectionRect.height>0&&entry.intersectionRect.width>0)this.visible.add(key);else this.visible.delete(key);}
   for(const target of targets)if(!target.element.isConnected)this.visible.delete(target.key);
   this.changed(new Set(this.visible),targets.map(v=>v.key));
  },{root:this.root,threshold:0});for(const target of targets)this.observer.observe(target.element);
 }
 reset(){this.update('',[]);}
 dispose(){this.dead=true;this.observer?.disconnect();this.observer=undefined;this.version++;this.owner='';this.targets=[];this.visible.clear();}
}
