import type { Thread } from './protocol/v2/Thread';
import type { ThreadItem } from './protocol/v2/ThreadItem';
import type { Turn } from './protocol/v2/Turn';
import type { Notification } from './rpc';
import {TurnDisplayMetrics} from './turn-display-metrics';
import type {TurnMetricsPersistence} from './turn-metrics-store';
import {TOOL_PROGRESS_CHARS,TOOL_PROGRESS_SUFFIX} from './public-tool-display';
import {isToolRecordType,isTerminalToolRecord} from './public-tool-types';
import {isPublicRecordKind} from './public-record-types';
import {NativeTurnProgress} from './native-turn-progress';
type ProjectedRow={turnId:string;item:ThreadItem;complete:boolean;toolProgress?:string};

export class Projection {
  revision=0;
  readonly metrics:TurnDisplayMetrics;
  readonly turnProgress=new NativeTurnProgress();
  constructor(persistence?:TurnMetricsPersistence,onMetricsError?:(error:unknown)=>void){this.metrics=new TurnDisplayMetrics(undefined,undefined,persistence,onMetricsError);}
  threadId = '';
  turns = new Map<string, Turn>();
  items = new Map<string,ProjectedRow>();
  private pendingDeltas = new Map<string, string>();
  private pendingTools = new Map<string,{turnId:string;output:string}>();
  clear(threadId = ''): void {
    this.revision++;
    this.threadId = threadId; this.turns.clear(); this.items.clear(); this.pendingDeltas.clear();this.pendingTools.clear();this.metrics.clear(threadId);this.turnProgress.clear();
  }
  snapshot(thread: Thread): void {
    this.clear(thread.id);
    for (const turn of thread.turns) this.setTurn(turn);
    this.metrics.reconcile(this.turns);
  }
  /** Prepend public older turns without overwriting a live or already observed row. */
  prependHistory(turns:Turn[],refreshExisting=false):void {
    const older=turns.filter(turn=>!this.turns.has(turn.id)),owned=new Map([...this.items].map(([key,row])=>[key,row.turnId]));
    for(const turn of refreshExisting?turns:older)for(const item of turn.items){if(owned.has(item.id)&&owned.get(item.id)!==turn.id)throw Error('历史消息身份跨回合冲突');owned.set(item.id,turn.id);}
    const rows=older.flatMap(turn=>turn.items.map(item=>[item.id,this.historyRow(turn,item)] as const));
    this.turns=new Map([...older.map(turn=>[turn.id,turn] as const),...this.turns]);this.items=new Map([...rows,...this.items]);
    if(refreshExisting)for(const turn of turns){
      if(older.includes(turn))continue;
      for(const item of turn.items){const old=this.items.get(item.id);if(old&&old.turnId!==turn.id)throw Error('历史消息身份跨回合冲突');}
      this.turns.set(turn.id,turn);
      const prior=[...this.items.values()],next=new Map<string,ProjectedRow>();
      for(const id of this.turns.keys())for(const row of id===turn.id?turn.items.map(item=>this.historyRow(turn,item)):prior.filter(row=>row.turnId===id))next.set(row.item.id,row);
      this.items=next;
    }
    this.metrics.reconcile(this.turns);
  }
  hydrateHistoryTurn(turnId:string,items:ThreadItem[],complete:boolean):void {
    const turn=this.turns.get(turnId);if(!turn||turn.status==='inProgress')throw Error('回合正在运行或已失效');
    for(const item of items){const old=this.items.get(item.id);if(old&&old.turnId!==turnId)throw Error('历史消息身份跨回合冲突');}
    this.turns.set(turnId,{...turn,items,itemsView:complete?'full':'summary'});
    const rows=[...this.items.values()],next=new Map<string,ProjectedRow>();
    for(const id of this.turns.keys())for(const row of id===turnId?items.map(item=>this.historyRow(turn,item)):rows.filter(row=>row.turnId===id))next.set(row.item.id,row);
    this.items=next;
  }
  private historyRow(turn:Turn,item:ThreadItem):ProjectedRow{
    const old=this.items.get(item.id);if(old?.turnId===turn.id&&old.item.type===item.type&&isTerminalToolRecord(old.item)&&!isTerminalToolRecord(item))return old;
    return{turnId:turn.id,item,complete:turn.status!=='inProgress'||isTerminalToolRecord(item)};
  }
  private setTurn(turn: Turn): void {
    if (this.turns.get(turn.id)?.status !== 'inProgress' && this.turns.has(turn.id) && turn.status === 'inProgress') return;
    this.turns.set(turn.id, turn);
    for (const item of turn.items) {const row=this.historyRow(turn,item);this.setItem(turn.id,row.item,row.complete);}
  }
  private setItem(turnId: string, item: ThreadItem, complete: boolean): void {
    if(typeof item?.id!=='string'||!item.id||typeof item.type!=='string'||!item.type||!this.turns.has(turnId))return;
    const old = this.items.get(item.id);
    if(old&&(old.turnId!==turnId||old.item.type!==item.type))return;
    if((isToolRecordType(item.type)||isPublicRecordKind(item.type))&&(!this.turns.has(turnId)||typeof item.id!=='string'||!item.id||item.id.length>256||!complete&&this.turns.get(turnId)?.status!=='inProgress'))return;
    if(old?.item.type===item.type&&isTerminalToolRecord(old.item)&&!isTerminalToolRecord(item))return;
    if (old?.complete && !complete) return;
    if (item.type === 'agentMessage' && !complete) {
      const pending = this.pendingDeltas.get(item.id) ?? '';
      item = {...item, text: old?.item.type === 'agentMessage' ? old.item.text : item.text + pending};
    }
    const pendingTool=this.pendingTools.get(item.id);
    if(!complete&&pendingTool?.turnId===turnId&&item.type==='commandExecution')item={...item,aggregatedOutput:(item.aggregatedOutput??'')+pendingTool.output};
    if(!complete&&old?.turnId===turnId&&old.item.type==='commandExecution'&&item.type==='commandExecution')item={...item,aggregatedOutput:old.item.aggregatedOutput};
    this.pendingTools.delete(item.id);
    this.pendingDeltas.delete(item.id);
    const row:ProjectedRow={turnId,item,complete};if(!complete&&item.type==='mcpToolCall'&&old?.turnId===turnId&&old.item.type==='mcpToolCall'&&old.toolProgress!==undefined)row.toolProgress=old.toolProgress;
    this.items.set(item.id,row);
  }
  apply(n: Notification): void {
    const p = n.params;
    if ('threadId' in p && p.threadId !== this.threadId) return;
    if((n.method==='item/started'||n.method==='item/completed'||n.method==='item/mcpToolCall/progress')&&n.params.threadId!==this.threadId)return;
    this.revision++;
    let acceptsVisibleDelta=true;
    if(n.method==='item/agentMessage/delta'){
      const current=this.items.get(n.params.itemId);
      acceptsVisibleDelta=this.turns.get(n.params.turnId)?.status==='inProgress'&&(!current||(current.turnId===n.params.turnId&&current.item.type==='agentMessage'&&!current.complete));
    }
    switch (n.method) {
      case 'turn/started': this.setTurn(n.params.turn); break;
      case 'turn/completed': {
        this.setTurn(n.params.turn);
        // Completion notifications can omit items. Preserve streamed ones, mark them terminal.
        for (const v of this.items.values()) if (v.turnId === n.params.turn.id) {v.complete = true;delete v.toolProgress;}
        for(const[id,pending]of this.pendingTools)if(pending.turnId===n.params.turn.id)this.pendingTools.delete(id);
        break;
      }
      case 'item/started': this.setItem(n.params.turnId, n.params.item, false); break;
      case 'item/completed': this.setItem(n.params.turnId, n.params.item, true); break;
      case 'item/commandExecution/outputDelta':{
        const {turnId,itemId,delta}=n.params,v=this.items.get(itemId);if(this.turns.get(turnId)?.status!=='inProgress'||v&&(v.turnId!==turnId||v.complete||v.item.type!=='commandExecution'))break;
        if(v&&v.item.type==='commandExecution')v.item={...v.item,aggregatedOutput:(v.item.aggregatedOutput??'')+delta};
        else{const previous=this.pendingTools.get(itemId);this.pendingTools.set(itemId,{turnId,output:(previous?.turnId===turnId?previous.output??'':'')+delta});}break;
      }
      case 'item/fileChange/patchUpdated':{
        const {turnId,itemId,changes}=n.params,v=this.items.get(itemId);if(this.turns.get(turnId)?.status!=='inProgress'||v&&(v.turnId!==turnId||v.complete||v.item.type!=='fileChange'))break;
        // Unknown items cannot supply approval differences. A started/completed snapshot remains authoritative.
        if(v&&v.item.type==='fileChange')v.item={...v.item,changes};break;
      }
      case 'item/mcpToolCall/progress':{
        const {turnId,itemId,message}=n.params,v=this.items.get(itemId);if(typeof message!=='string'||this.turns.get(turnId)?.status!=='inProgress'||!v||v.turnId!==turnId||v.complete||v.item.type!=='mcpToolCall'||v.item.status!=='inProgress')break;
        v.toolProgress=message.length>TOOL_PROGRESS_CHARS?message.slice(0,TOOL_PROGRESS_CHARS-TOOL_PROGRESS_SUFFIX.length)+TOOL_PROGRESS_SUFFIX:message;break;
      }
      case 'item/agentMessage/delta': {
        const v = this.items.get(n.params.itemId);
        const status = this.turns.get(n.params.turnId)?.status;
        if (v?.complete || (status && status !== 'inProgress')) break;
        if (v?.item.type === 'agentMessage') v.item = {...v.item, text: v.item.text + n.params.delta};
        else this.pendingDeltas.set(n.params.itemId, (this.pendingDeltas.get(n.params.itemId) ?? '') + n.params.delta);
        break;
      }
    }
    this.turnProgress.apply(n,this.threadId,this.turns);
    if(acceptsVisibleDelta)this.metrics.observe(n,this.turns);
    if(n.method==='turn/started'||n.method==='turn/completed')this.metrics.reconcile(this.turns);
  }
  activeTurn(): string | undefined { return [...this.turns.values()].find(t => t.status === 'inProgress')?.id; }
}
