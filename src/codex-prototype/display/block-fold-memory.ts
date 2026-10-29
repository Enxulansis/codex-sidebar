import type {PageHost} from '../page-host';
/** Only block-view memory crosses this channel; no execution, resources or RPC. */
import {showFormulaToast} from './dsh-math-export';
type Owner={threadId:string;connectionId:number};
const BLOCK_MEMORY_CAP=2000;
export class BlockFoldMemory {
 private keys=new Set<string>();private confirmed=new Map<string,boolean>();private latest=new Map<string,number>();
 private id=0;private enabled=true;private identity='';private local=new Set<string>();private read=false;private dead=false;
 private version=0;get revision(){return this.version;}
 private pending=new Map<number,{key:string;folded:boolean;owner:Owner;resolve:()=>void;reject:()=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private host:PageHost,private owner:()=>Owner,private loaded:()=>void){
  this.host.messages.addEventListener('message',this.onMessage);window.addEventListener('pagehide',()=>this.dispose(),{once:true});host.postMessage({type:'block-fold-read'});
 }
 configure(enabled:boolean){const identity=JSON.stringify(this.owner());if(identity!==this.identity||enabled!==this.enabled)this.local.clear();this.identity=identity;this.enabled=enabled;}
 has=(key:string)=>(this.enabled?this.keys:this.local).has(key);
 private apply(key:string,folded:boolean){let changed=this.keys.has(key)!==folded;this.keys.delete(key);if(folded)this.keys.add(key);while(this.keys.size>BLOCK_MEMORY_CAP){this.keys.delete(this.keys.values().next().value!);changed=true;}if(changed)this.version++;}
 save=(key:string,folded:boolean)=>new Promise<void>((resolve,reject)=>{
  if(this.dead){reject();return;}
  if(!this.enabled){this.local.delete(key);if(folded)this.local.add(key);while(this.local.size>BLOCK_MEMORY_CAP)this.local.delete(this.local.values().next().value!);resolve();return;}
  const id=++this.id,owner=this.owner();this.apply(key,folded);this.latest.set(key,id);
  const timer=setTimeout(()=>this.finish(id,false,true),5000);this.pending.set(id,{key,folded,owner,resolve,reject,timer});
  this.host.postMessage({type:'block-fold-save',id,key,folded,...owner});
 });
 private isCurrent(owner:Owner){const now=this.owner();return now.threadId===owner.threadId&&now.connectionId===owner.connectionId;}
 private finish(id:number,ok:boolean,unknown=false){
  const p=this.pending.get(id);if(!p)return;clearTimeout(p.timer);this.pending.delete(id);
  if(ok){this.confirmed.delete(p.key);this.confirmed.set(p.key,p.folded);while(this.confirmed.size>BLOCK_MEMORY_CAP)this.confirmed.delete(this.confirmed.keys().next().value!);}
  if(this.latest.get(p.key)===id){
   this.latest.delete(p.key);
   if(!ok){this.apply(p.key,this.confirmed.get(p.key)===true);if(!this.dead&&this.enabled&&this.isCurrent(p.owner)){this.loaded();showFormulaToast(unknown?'折叠状态保存未确认，请正常 Reload 后核对':'折叠状态保存失败，请重试',true);}}
  }
  if(ok)p.resolve();else p.reject();
 }
 private onMessage=(e:MessageEvent)=>{
  const m=e.data;if(this.dead)return;
  if(m?.type==='block-folds'){
   if(!this.read&&Array.isArray(m.keys)){
    this.read=true;const saved=new Set<string>(m.keys.filter((v:unknown)=>typeof v==='string').slice(-BLOCK_MEMORY_CAP));
    for(const key of saved)if(!this.confirmed.has(key))this.confirmed.set(key,true);
    for(const[key,folded]of this.confirmed)if(!this.latest.has(key))this.apply(key,folded);
    while(this.confirmed.size>BLOCK_MEMORY_CAP)this.confirmed.delete(this.confirmed.keys().next().value!);this.loaded();
   }return;
  }
  if(m?.type!=='block-fold-saved')return;const p=this.pending.get(m.id);
  if(p&&m.key===p.key&&m.folded===p.folded)this.finish(m.id,m.ok===true);
 };
 dispose(){this.dead=true;this.host.messages.removeEventListener('message',this.onMessage);for(const id of [...this.pending.keys()])this.finish(id,false);}
}
