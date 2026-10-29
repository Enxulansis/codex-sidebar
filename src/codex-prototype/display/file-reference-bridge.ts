import type {PageHost} from '../page-host';
import {fileReferenceId,type FileReference} from '../file-reference';
import type {ReferenceImageSource} from '../reference-image';
type Owner={threadId:string;connectionId:number};
export class FileReferenceBridge{
 private id=0;private epoch=0;private dead=false;private pending=new Map<number,{owner:Owner;turnId:string;itemId:string;referenceId:string;timer:ReturnType<typeof setTimeout>;receiving?:boolean;resolve:(value:string)=>void;reject:(error:Error)=>void}>();
 constructor(private host:PageHost,private owner:()=>Owner,private showImage?:(source:ReferenceImageSource,current:()=>boolean)=>Promise<void>){host.messages.addEventListener('message',this.message);window.addEventListener('pagehide',()=>this.dispose(),{once:true});}
 run(reference:FileReference,turnId:string,itemId:string){if(this.dead)return Promise.reject(Error('文件引用页面已销毁'));return new Promise<string>((resolve,reject)=>{const id=++this.id,owner={...this.owner()},referenceId=fileReferenceId(reference),timer=setTimeout(()=>{this.pending.delete(id);reject(Error('文件打开未收到确认；请先核对编辑器，未自动重试'));},15000);this.pending.set(id,{owner,turnId,itemId,referenceId,timer,resolve,reject});this.host.postMessage({type:'file-reference-open',id,...owner,turnId,itemId,referenceId});});}
 private message=(event:MessageEvent)=>{const m=event.data;if(m?.type!=='file-reference-result')return;const p=this.pending.get(m.id);if(!p||p.receiving||m.threadId!==p.owner.threadId||m.connectionId!==p.owner.connectionId||m.turnId!==p.turnId||m.itemId!==p.itemId||m.referenceId!==p.referenceId)return;clearTimeout(p.timer);const epoch=this.epoch,current=()=>{const now=this.owner();return!this.dead&&epoch===this.epoch&&m.id===this.id&&now.threadId===p.owner.threadId&&now.connectionId===p.owner.connectionId;};
  if(!current()){this.pending.delete(m.id);p.reject(Error('文件引用所属线程或连接已失效'));}
  else if(m.ok===true&&m.result==='image'&&this.showImage){p.receiving=true;void this.showImage(m.image,current).then(()=>{if(!current())throw Error('图片引用显示身份已失效');p.resolve('previewed');},error=>p.reject(error instanceof Error?error:Error('图片预览失败'))).catch(p.reject).finally(()=>{if(this.pending.get(m.id)===p)this.pending.delete(m.id);});}
  else{this.pending.delete(m.id);if(m.ok===true&&(m.result==='opened'||m.result==='delegated'))p.resolve(m.result);else p.reject(Error(m.error||'文件打开失败或未确认'));}
 };
 clear(){this.epoch++;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('文件引用显示身份已失效'));}this.pending.clear();}
 dispose(){this.dead=true;this.clear();this.host.messages.removeEventListener('message',this.message);}
}
