import type {PageHost} from '../page-host';
import {showFormulaToast} from './dsh-math-export';
type Owner={threadId:string;connectionId:number};
const CAP=2000;
/** Narrow tool-card view memory. It never grants execution or approval. */
export class ToolExpansionMemory{
 private keys=new Set<string>();private confirmed=new Map<string,boolean>();private latest=new Map<string,number>();private local=new Map<string,boolean>();
 private id=0;private enabled=true;private identity='';private loadedOnce=false;private dead=false;
 private pending=new Map<number,{key:string;expanded:boolean;owner:Owner;resolve:()=>void;reject:()=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private host:PageHost,private owner:()=>Owner,private changed:(key?:string)=>void){this.host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',()=>this.dispose(),{once:true});host.postMessage({type:'tool-expansion-read'});}
 configure(enabled:boolean){const identity=JSON.stringify(this.owner());if(identity!==this.identity||enabled!==this.enabled)this.local.clear();this.identity=identity;this.enabled=enabled;}
 has=(key:string)=>this.enabled?this.keys.has(key):this.local.get(key)===true;
 private apply(key:string,expanded:boolean){this.keys.delete(key);if(expanded)this.keys.add(key);while(this.keys.size>CAP)this.keys.delete(this.keys.values().next().value!);}
 save=(key:string,expanded:boolean)=>new Promise<void>((resolve,reject)=>{
  if(this.dead){reject();return;}
  if(!this.enabled){this.local.delete(key);this.local.set(key,expanded);while(this.local.size>CAP)this.local.delete(this.local.keys().next().value!);resolve();return;}
  const id=++this.id,owner=this.owner();this.apply(key,expanded);this.latest.set(key,id);const timer=setTimeout(()=>this.finish(id,false,true),5000);
  this.pending.set(id,{key,expanded,owner,resolve,reject,timer});this.host.postMessage({type:'tool-expansion-save',id,key,expanded,...owner});
 });
 private finish(id:number,ok:boolean,unknown=false){const p=this.pending.get(id);if(!p)return;clearTimeout(p.timer);this.pending.delete(id);
  if(ok){this.confirmed.delete(p.key);this.confirmed.set(p.key,p.expanded);while(this.confirmed.size>CAP)this.confirmed.delete(this.confirmed.keys().next().value!);}
  if(this.latest.get(p.key)===id){this.latest.delete(p.key);if(!ok){this.apply(p.key,this.confirmed.get(p.key)===true);const now=this.owner();if(!this.dead&&this.enabled&&now.threadId===p.owner.threadId&&now.connectionId===p.owner.connectionId){this.changed(p.key);showFormulaToast(unknown?'工具卡展开保存未确认，请正常 Reload 后核对':'工具卡展开保存失败，请重试',true);}}}
  if(ok)p.resolve();else p.reject();
 }
 private message=(e:MessageEvent)=>{const m=e.data;if(this.dead)return;
  if(m?.type==='tool-expansions'){if(!this.loadedOnce&&Array.isArray(m.keys)){this.loadedOnce=true;for(const key of m.keys.filter((v:unknown)=>typeof v==='string').slice(-CAP))if(!this.confirmed.has(key))this.confirmed.set(key,true);for(const[key,value]of this.confirmed)if(!this.latest.has(key))this.apply(key,value);while(this.confirmed.size>CAP)this.confirmed.delete(this.confirmed.keys().next().value!);this.changed();}return;}
  if(m?.type==='tool-expansion-saved'){const p=this.pending.get(m.id);if(p&&m.key===p.key&&m.expanded===p.expanded)this.finish(m.id,m.ok===true);}
 };
 dispose(){this.dead=true;this.host.messages.removeEventListener('message',this.message);for(const id of [...this.pending.keys()])this.finish(id,false);}
}
