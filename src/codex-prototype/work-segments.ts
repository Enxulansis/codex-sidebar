import type {MessagePhase,WorkTurn} from './page-model';
import {hasPublicQuestions,type PublicQuestionRecord} from './public-questions';
export type {WorkTurn} from './page-model';
export type WorkRow={turnId:string;complete:boolean;item:{id:string;type:string;phase?:MessagePhase|null;text?:string;status?:string;questions?:unknown;questionRecord?:PublicQuestionRecord}};
export type WorkSegment={key:string;turnId:string;firstItemId:string;items:string[];members:{turnId:string;itemId:string}[];durationMs:number|null};
export function processCandidate(row:WorkRow){if(['commandExecution','fileChange'].includes(row.item.type))return row.item.status==='completed'||row.item.status==='failed';return row.item.type==='plan'||row.item.type==='agentMessage'&&row.item.phase==='commentary'&&!hasPublicQuestions(row.item);}
/** Only explicitly identified, complete public process chunks. Unknown/partial/final answers stay visible. */
export function workSegments(thread:string,rows:readonly WorkRow[],turns:readonly WorkTurn[]):WorkSegment[]{
 const known=new Map(turns.map(t=>[t.id,t])),out:WorkSegment[]=[];let chunk:WorkRow[]=[];
 const flush=(following?:WorkRow)=>{if(!chunk.length)return;
  const hasVisibleBoundary=following?.item.type==='agentMessage'&&(following.item.phase!=='commentary'||hasPublicQuestions(following.item));
  const assistant=chunk.findLastIndex(row=>row.item.type==='agentMessage'),keeper=hasVisibleBoundary?-1:assistant>=0?assistant:chunk.length-1;
  const process=chunk.filter((_,i)=>i!==keeper);if(process.length){const first=process[0]!,firstItemId=first.item.id,turnIds=[...new Set(process.map(r=>r.turnId))],durations=turnIds.map(id=>known.get(id)?.durationMs);out.push({key:JSON.stringify([thread,first.turnId,firstItemId]),turnId:first.turnId,firstItemId,items:process.map(r=>r.item.id),members:process.map(r=>({turnId:r.turnId,itemId:r.item.id})),durationMs:durations.every((v):v is number=>typeof v==='number')?durations.reduce((sum,v)=>sum+v,0):null});}chunk=[];
 };
 for(const row of rows){if(row.item.type==='reasoning')continue;const turn=known.get(row.turnId),eligible=turn&&turn.itemsView==='full'&&turn.status!=='inProgress'&&row.complete&&processCandidate(row);
  // Public turn IDs describe transport/execution identity, not a new human input.
  if(eligible)chunk.push(row);else flush(row);
 }flush();return out;
}
export function assistantPhaseLabel(phase:MessagePhase|null|undefined,complete:boolean){return phase==='commentary'?'过程说明':phase==='partial_answer'?'阶段答复':phase==='final_answer'?(complete?'最终正文':'答复生成中'):(complete?'回复正文':'流式显示');}
