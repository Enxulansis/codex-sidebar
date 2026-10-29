import type {PageHost} from '../page-host';
import {showFormulaToast} from './dsh-math-export';import type {UserFoldState} from '../user-fold-store';
type Owner={threadId:string;connectionId:number};const CAP=2000;
export class WorkFoldMemory{
 private records=new Map<string,UserFoldState>();private confirmed=new Map<string,UserFoldState>();private local=new Map<string,UserFoldState>();private latest=new Map<string,number>();
 private sequence=0;private enabled=true;private identity='';private dead=false;private read=false;private readId=0;private readSequence=0;private confirmedIds=new Map<string,number>();
 private pending=new Map<number,{key:string;state:UserFoldState;owner:Owner;resolve:()=>void;reject:()=>void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private host:PageHost,private owner:()=>Owner,private changed:()=>void,private channel='work',private label='过程'){this.host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',()=>this.dispose(),{once:true});this.identity=JSON.stringify(owner());this.requestRead();}
 private requestRead(){this.read=false;this.readSequence=this.sequence;for(const key of this.confirmedIds.keys())if(!this.confirmed.has(key))this.confirmedIds.delete(key);this.host.postMessage({type:this.channel+'-fold-read',readId:++this.readId});}
 configure(enabled:boolean){const identity=JSON.stringify(this.owner());if(identity!==this.identity||enabled!==this.enabled){this.local.clear();for(const p of this.pending.values()){clearTimeout(p.timer);p.reject();}this.pending.clear();this.latest.clear();this.records=new Map(this.confirmed);this.identity=identity;this.enabled=enabled;if(enabled)this.requestRead();}this.enabled=enabled;}
 get=(key:string)=>(this.enabled?this.records:this.local).get(key);
 save=(key:string,state:UserFoldState)=>new Promise<void>((resolve,reject)=>{if(this.dead){reject();return;}if(!this.enabled){this.local.delete(key);this.local.set(key,state);while(this.local.size>CAP)this.local.delete(this.local.keys().next().value!);resolve();return;}
  const id=++this.sequence,owner=this.owner();this.records.delete(key);this.records.set(key,state);this.latest.set(key,id);while(this.records.size>CAP)this.records.delete(this.records.keys().next().value!);
  const timer=setTimeout(()=>this.finish(id,false,true),5000);this.pending.set(id,{key,state,owner,resolve,reject,timer});this.host.postMessage({type:this.channel+'-fold-save',id,key,state,...owner});
 });
 private finish(id:number,ok:boolean,unknown=false){const p=this.pending.get(id);if(!p)return;clearTimeout(p.timer);this.pending.delete(id);
  if(ok&&id>(this.confirmedIds.get(p.key)??0)){this.confirmedIds.set(p.key,id);this.confirmed.delete(p.key);this.confirmed.set(p.key,p.state);while(this.confirmed.size>CAP){const key=this.confirmed.keys().next().value!;this.confirmed.delete(key);this.confirmedIds.delete(key);}}
  if(this.latest.get(p.key)===id){this.latest.delete(p.key);if(!ok){const previous=this.confirmed.get(p.key);if(previous)this.records.set(p.key,previous);else this.records.delete(p.key);const owner=this.owner();if(!this.dead&&this.enabled&&owner.threadId===p.owner.threadId&&owner.connectionId===p.owner.connectionId){this.changed();showFormulaToast(this.label+(unknown?'折叠保存未确认，请正常 Reload 后核对':'折叠保存失败，请重试'),true);}}}
  if(ok)p.resolve();else p.reject();
 }
 private message=(e:MessageEvent)=>{const m=e.data;if(this.dead)return;if(m?.type===this.channel+'-folds'){if(m.readId===this.readId&&!this.read&&Array.isArray(m.records)){this.read=true;const snapshot=new Map<string,UserFoldState>(m.records.slice(-CAP).filter((r:any)=>Array.isArray(r)&&typeof r[0]==='string'&&['folded','expanded'].includes(r[1])));for(const[key,id]of this.confirmedIds)if(id>this.readSequence)snapshot.set(key,this.confirmed.get(key)!);this.confirmed=snapshot;for(const key of this.records.keys())if(!this.latest.has(key)&&!snapshot.has(key))this.records.delete(key);for(const[key,value]of snapshot)if(!this.latest.has(key))this.records.set(key,value);while(this.records.size>CAP)this.records.delete(this.records.keys().next().value!);while(this.confirmed.size>CAP){const key=this.confirmed.keys().next().value!;this.confirmed.delete(key);this.confirmedIds.delete(key);}this.changed();}return;}
  if(m?.type===this.channel+'-fold-saved'){const p=this.pending.get(m.id),owner=this.owner();if(p&&m.key===p.key&&m.state===p.state&&m.threadId===p.owner.threadId&&m.connectionId===p.owner.connectionId&&owner.threadId===p.owner.threadId&&owner.connectionId===p.owner.connectionId)this.finish(m.id,m.ok===true);}
 };
 dispose(){this.dead=true;this.host.messages.removeEventListener('message',this.message);for(const id of [...this.pending.keys()])this.finish(id,false);}
}
