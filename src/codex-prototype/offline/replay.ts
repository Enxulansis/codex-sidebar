// Display-only, allowlisted public event shapes. No RPC IDs, approvals, credentials or file paths.
export type DisplayEvent =
  | {method:'item/started';params:{threadId:string;turnId:string;itemId:string;role:'assistant'|'user';text:string;images?:string[]}}
  | {method:'item/agentMessage/delta';params:{threadId:string;turnId:string;itemId:string;delta:string}}
  | {method:'item/completed';params:{threadId:string;turnId:string;itemId:string;text:string}};
export type DisplayMessage = {threadId:string;turnId:string;itemId:string;role:'assistant'|'user';text:string;images:string[];complete:boolean};
export class Replay {
  threadId='';
  readonly messages=new Map<string,DisplayMessage>();
  select(threadId:string) { this.threadId=threadId; this.messages.clear(); }
  apply(event:DisplayEvent):void {
    const p=event.params; if(p.threadId!==this.threadId)return;
    const key=JSON.stringify([p.threadId,p.turnId,p.itemId]); const previous=this.messages.get(key);
    if(event.method==='item/started') {
      if(previous)return;
      this.messages.set(key,{...event.params,images:event.params.images??[],complete:false});
    } else if(event.method==='item/agentMessage/delta') {
      if(previous?.role==='assistant'&&!previous.complete)previous.text+=event.params.delta;
    } else if(event.method==='item/completed' && previous) {
      previous.text=event.params.text;previous.complete=true;
    }
  }
}
