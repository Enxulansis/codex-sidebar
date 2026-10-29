import type {PageHost} from '../page-host';
import {validScrollMemo,SCROLL_VIEW_CAP,type ScrollMemo} from '../scroll-view-store';
export class ScrollViewMemory{
 private thread='';private connection=0;private sequence=0;private enabled=true;
 private slots=new Map<string,{memo?:ScrollMemo;loaded:boolean;verified:boolean;revision:number;notice:string}>();
 private pending=new Map<number,{thread:string;connection:number;revision:number;kind:string;timer:ReturnType<typeof setTimeout>}>();
 readonly viewId=crypto.randomUUID();
 constructor(private host:PageHost,private changed:()=>void){this.host.messages.addEventListener('message',this.message);}
 private slot(thread=this.thread){let s=this.slots.get(thread);if(!s){s={loaded:false,verified:false,revision:0,notice:''};this.slots.set(thread,s);}return s;}
 get ready(){return !this.thread||this.slot().loaded;}
 get memo(){return this.thread?this.slot().memo:undefined;}
 get notice(){return this.thread?this.slot().notice:'';}
 configure(enabled:boolean){this.enabled=enabled;}
 select(thread:string,connection:number){if(thread===this.thread&&connection===this.connection)return;this.flush();for(const[id,p]of this.pending)if(p.kind==='scroll-view-read'){clearTimeout(p.timer);this.pending.delete(id);}this.thread=thread;this.connection=connection;if(thread){const s=this.slot();this.slots.delete(thread);this.slots.set(thread,s);this.request('scroll-view-read');}for(const old of this.slots.keys()){if(this.slots.size<=SCROLL_VIEW_CAP)break;if(old===thread)continue;this.slots.delete(old);for(const[id,p]of this.pending)if(p.thread===old){clearTimeout(p.timer);this.pending.delete(id);}}}
 capture(value:ScrollMemo){if(!this.thread)return;const s=this.slot();s.memo=structuredClone(value);s.revision++;}
 flush(){if(this.enabled&&this.thread&&this.slot().verified&&this.slot().memo)this.request('scroll-view-save');}
 private request(kind:string){const thread=this.thread,connection=this.connection,s=this.slot(),revision=s.revision,id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);if(this.thread!==thread||this.connection!==connection||kind==='scroll-view-save'&&revision!==s.revision)return;s.notice='阅读位置保存或恢复未确认；当前阅读不受影响，请正常 Reload 后核对。';if(kind==='scroll-view-read')s.loaded=true;this.changed();},5000);this.pending.set(id,{thread,connection,revision,kind,timer});this.host.postMessage({type:kind,id,viewId:this.viewId,threadId:thread,connectionId:connection,...(kind==='scroll-view-save'?{value:s.memo}:{})});}
 private message=(e:MessageEvent)=>{const m=e.data;if(m?.type!=='scroll-view-result'||m.viewId!==this.viewId)return;const p=this.pending.get(m.id);if(!p||m.threadId!==p.thread||m.connectionId!==p.connection)return;clearTimeout(p.timer);this.pending.delete(m.id);if(this.thread!==p.thread||this.connection!==p.connection)return;const s=this.slot(p.thread);if(p.kind==='scroll-view-save'&&p.revision!==s.revision)return;if(p.kind==='scroll-view-read'){s.loaded=true;s.verified=m.ok===true&&(m.value===undefined||validScrollMemo(m.value));if(s.verified&&p.revision===s.revision)s.memo=m.value;}s.notice=m.ok&&s.verified?'':m.error||'阅读位置保存或读取失败，当前阅读不受影响；未覆盖原位置。';this.changed();};
 dispose(){for(const p of this.pending.values())clearTimeout(p.timer);this.pending.clear();this.host.messages.removeEventListener('message',this.message);}
}
