import type {Session} from './session';
import type {DisplaySettings} from './display-settings';

export type TaskNoticeKind='completed'|'failed'|'approval'|'question';
export type TaskNotice={threadId:string;turnId:string;kind:TaskNoticeKind;token?:string};
type NoticeActions={
 current:()=>boolean;
 usable:(threadId:string)=>boolean;
 foreground:(threadId:string)=>boolean;
 preference:()=>DisplaySettings['taskNotifications'];
 unread:(threadId:string,current:()=>boolean)=>Promise<unknown>;
 show:(notice:TaskNotice)=>PromiseLike<boolean>;
 reveal:(threadId:string,current:()=>boolean)=>Promise<unknown>;
 error:(error:unknown)=>void;
};
const MAX_NOTICE_KEYS=512;

/** Only accepted live Session events; restoring history never creates a completion notice. */
export class TaskNotifications {
 private dead=false;
 private seen=new Set<string>();
 private archived=new Set<string>();
 constructor(private session:Session,private actions:NoticeActions){
  session.on('change',this.sync);session.on('queue-terminal',this.terminal);session.on('evidence',this.evidence);
 }
 private valid(notice:TaskNotice){
  if(this.dead||!this.actions.current()||!this.session.isConnected||this.archived.has(notice.threadId)||!this.actions.usable(notice.threadId))return false;
  if(notice.kind==='approval')return [...this.session.approvals.values()].some(value=>value.params.threadId===notice.threadId&&value.params.turnId===notice.turnId&&value.callbackToken===notice.token);
  if(notice.kind==='question')return [...this.session.userInputs.values()].some(value=>value.params.threadId===notice.threadId&&value.params.turnId===notice.turnId&&value.callbackToken===notice.token&&value.status==='pending');
  return true;
 }
 private evidence=(value:{method:string;params?:{threadId?:unknown}})=>{
  const id=value.params?.threadId;if(typeof id!=='string')return;
  if(value.method==='thread/archived'&&this.actions.usable(id))this.archived.add(id);
  else if(value.method==='thread/unarchived')this.archived.delete(id);
 };
 private sync=()=>{
  for(const value of this.session.approvals.values())this.enqueue({threadId:value.params.threadId,turnId:value.params.turnId,kind:'approval',token:value.callbackToken});
  for(const value of this.session.userInputs.values())if(value.status==='pending')this.enqueue({threadId:value.params.threadId,turnId:value.params.turnId,kind:'question',token:value.callbackToken});
 };
 private terminal=(value:{threadId:string;turnId:string;status:string;canceled:boolean})=>{
  if(value.canceled||!['completed','failed'].includes(value.status))return;
  this.enqueue({threadId:value.threadId,turnId:value.turnId,kind:value.status as 'completed'|'failed'});
 };
 private enqueue(notice:TaskNotice){
  if(!this.valid(notice))return;
  // A terminal result wins over duplicate or contradictory deliveries for that turn.
  const key=JSON.stringify([notice.threadId,notice.turnId,notice.token??'terminal']);
  if(this.seen.has(key))return;this.seen.add(key);
  if(this.seen.size>MAX_NOTICE_KEYS)this.seen.delete(this.seen.values().next().value!);
  void this.deliver(notice).catch(error=>{if(!this.dead&&this.actions.current())this.actions.error(error);});
 }
 private async deliver(notice:TaskNotice){
  if(!this.valid(notice)||this.actions.foreground(notice.threadId))return;
  const current=()=>this.valid(notice);
  // Disabling popups still leaves the local sidebar unread indicator available.
  try{await this.actions.unread(notice.threadId,()=>current()&&!this.actions.foreground(notice.threadId));}
  catch(error){if(current()&&!this.actions.foreground(notice.threadId))this.actions.error(error);}
  if(!current()||this.actions.foreground(notice.threadId))return;
  const preference=this.actions.preference();
  if(preference==='off'||preference==='attention'&&notice.kind==='completed')return;
  if(await this.actions.show(notice)&&current())await this.actions.reveal(notice.threadId,current);
 }
 dispose(){if(this.dead)return;this.dead=true;this.session.off('change',this.sync);this.session.off('queue-terminal',this.terminal);this.session.off('evidence',this.evidence);this.seen.clear();this.archived.clear();}
}
