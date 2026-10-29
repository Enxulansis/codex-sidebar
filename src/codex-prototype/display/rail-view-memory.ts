import type {PageHost} from '../page-host';
import {validRailRecords,type RailRecord,type RailChange} from '../rail-view-store';
import {showFormulaToast} from './dsh-math-export';
type Owner={threadId:string;connectionId:number};
/** One confirmed snapshot per selected thread; unknown receipts require an explicit reread. */
export class RailViewMemory{
  private owner?:Owner;private records=new Map<string,RailRecord>();private sequence=0;private pending:{id:number;action:'read'|'change';timer:ReturnType<typeof setTimeout>}|undefined;ready=false;blocked=false;
 constructor(private host:PageHost,private changed:()=>void){host.messages.addEventListener('message',this.receive);window.addEventListener('pagehide',this.dispose,{once:true});}
  configure(owner:Owner){if(this.owner?.threadId===owner.threadId&&this.owner?.connectionId===owner.connectionId)return;clearTimeout(this.pending?.timer);this.pending=undefined;this.owner={...owner};this.records.clear();this.ready=false;this.blocked=false;if(owner.threadId)this.read();}
  get(turnId:string){return this.records.get(turnId);}
  get dropped(){return [...this.records.values()].filter(v=>v.drop).length;}
 get editable(){return this.ready&&!this.blocked&&!this.pending;}
 read(){if(this.pending?.action==='change')return;this.request('read');}
 change(change:RailChange){if(!this.editable)return;this.request('change',change);}
 private request(action:'read'|'change',change?:RailChange){if(!this.owner?.threadId)return;clearTimeout(this.pending?.timer);const id=++this.sequence,timer=setTimeout(()=>{if(this.pending?.id!==id)return;this.pending=undefined;this.blocked=true;showFormulaToast('导航记忆保存/读取未确认，请从节点右键菜单重新读取核对',true);this.changed();},5000);this.pending={id,action,timer};this.host.postMessage({type:'rail-view-'+action,id,...this.owner,...(change?{change}:{})});this.changed();}
  private receive=(event:MessageEvent)=>{const m=event.data,p=this.pending;if(m?.type!=='rail-view-result'||!p||m.id!==p.id||m.threadId!==this.owner?.threadId||m.connectionId!==this.owner?.connectionId)return;clearTimeout(p.timer);this.pending=undefined;if(m.ok&&validRailRecords(m.records)){this.records=new Map(structuredClone(m.records).map((record:RailRecord)=>[record.turnId,record]));this.ready=true;this.blocked=false;}else{if(p.action==='read'||m.ok)this.blocked=true;showFormulaToast(m.ok?'导航记忆回执格式未核对，请重新读取后再修改':m.error||'导航记忆保存失败，保留已确认值',true);}this.changed();};
 private dispose=()=>{clearTimeout(this.pending?.timer);this.host.messages.removeEventListener('message',this.receive);};
}
