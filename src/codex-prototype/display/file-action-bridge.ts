import type {PageHost} from '../page-host';
import {draftFileId,type DraftFile} from '../draft-store-types';
import type {FileActionKind} from '../file-action-host';
import {FORMULA_EXPORT_TIMEOUT_MS} from '../formula-export-limits';
type Owner={threadId:string;connectionId:number};
type BodyFile={source:'body';turnId:string;itemId:string};
/** File identity only; paths/bytes are resolved from the host's saved draft. */
export class FileActionBridge{
 private id=0;private pending=new Map<number,{owner:Owner;body:BodyFile|undefined;resolve:(r:string)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>|undefined}>();
 constructor(private host:PageHost,private owner:()=>Owner){this.host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',()=>this.dispose(),{once:true});}
 run=(file:DraftFile,kind:FileActionKind,body?:BodyFile)=>new Promise<string>((resolve,reject)=>{const id=++this.id,owner=this.owner(),timer=kind==='save'?undefined:setTimeout(()=>{this.pending.delete(id);reject(Error('文件操作未收到确认'));},FORMULA_EXPORT_TIMEOUT_MS);this.pending.set(id,{owner,body,resolve,reject,timer});this.host.postMessage({type:'file-action',id,...owner,...(body??{}),fileId:draftFileId(file),kind});});
 private message=(e:MessageEvent)=>{const m=e.data;if(m?.type!=='file-action-result')return;const p=this.pending.get(m.id);if(!p||m.threadId!==p.owner.threadId||m.connectionId!==p.owner.connectionId)return;if(p.body?(m.source!=='body'||m.turnId!==p.body.turnId||m.itemId!==p.body.itemId):m.source==='body')return;clearTimeout(p.timer);this.pending.delete(m.id);const now=this.owner();if(now.threadId!==p.owner.threadId||now.connectionId!==p.owner.connectionId){p.reject(Error('文件草稿身份已失效'));return;}if(m.ok===true)p.resolve(m.result);else p.reject(Object.assign(Error(m.error||'文件操作失败'),{invalidFile:m.invalidFile===true}));};
 clear(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('文件草稿身份已失效'));}this.pending.clear();}
 dispose(){this.host.messages.removeEventListener('message',this.message);this.clear();}
}
