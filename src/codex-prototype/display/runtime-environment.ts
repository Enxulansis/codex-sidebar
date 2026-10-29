import type {PageHost} from '../page-host';
import {validRuntimeEnvironment,type RuntimeEnvironment} from '../runtime-environment';
export type EnvironmentReadState={phase:'idle'|'loading'|'ready'|'unavailable';value?:RuntimeEnvironment};
/** Independent of preference saves: a metadata reply cannot resolve an unknown save. */
export class RuntimeEnvironmentRead {
 private sequence=0;private pending:{id:number;timer:ReturnType<typeof setTimeout>}|undefined;private dead=false;
 state:EnvironmentReadState={phase:'idle'};
 constructor(private host:PageHost,private changed:()=>void){host.messages.addEventListener('message',this.onMessage);}
 refresh(){
  if(this.dead)return;this.cancel();const id=++this.sequence;
  this.state={phase:'loading'};this.changed();
  const timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.pending=undefined;this.state={phase:'unavailable'};this.changed();},5000);
  this.pending={id,timer};this.host.postMessage({type:'environment-read',id});
 }
 private onMessage=(event:MessageEvent)=>{
  const m=event.data;if(this.dead||m?.type!=='environment-result'||!this.pending||m.id!==this.pending.id)return;
  this.cancel();this.state=m.ok===true&&validRuntimeEnvironment(m.value)?{phase:'ready',value:m.value}:{phase:'unavailable'};this.changed();
 };
 private cancel(){clearTimeout(this.pending?.timer);this.pending=undefined;}
 close(){this.cancel();this.state={phase:'idle'};}
 dispose(){this.dead=true;this.cancel();this.host.messages.removeEventListener('message',this.onMessage);}
}
