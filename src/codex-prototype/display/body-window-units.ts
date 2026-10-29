import type {PageState,PageRow} from '../page-model';
import {workSegments,type WorkSegment} from '../work-segments';
// The old 48-unit overscan reflowed 192 rich rows on every sash movement,
// although the viewport displayed only a few. Logical history is unchanged.
export const MAX_CALIBRATION_ROWS=128,MAX_UNIT_ROWS=MAX_CALIBRATION_ROWS/2,MAX_BODY_ROWS=192,MAX_BODY_UNITS=12;
export const rowIdentity=(turnId:string,itemId:string)=>JSON.stringify([turnId,itemId]);
export type BodyUnit={id:string;rows:PageRow[];logical:PageRow[];revision:number;fold:string;turn:unknown};
export function bodyWindowUnits(state:PageState,folded:(key:string)=>boolean){
 const source=state.items.filter(row=>row.item.type!=='reasoning'),segments=state.copySettings?.workSegments===false?[]:workSegments(state.threadId,source,state.turns??[]),byItem=new Map<string,WorkSegment>();
 for(const segment of segments)for(const member of segment.members)byItem.set(rowIdentity(member.turnId,member.itemId),segment);
 const sourceById=new Map(source.map(row=>[rowIdentity(row.turnId,row.item.id),row])),starts=new Map(segments.filter(s=>folded(s.key)).map(s=>[rowIdentity(s.turnId,s.firstItemId),s])),unitRows:Omit<BodyUnit,'revision'|'fold'|'turn'>[]=[],consumed=new Set<string>();let pack:PageRow[]=[],logical:PageRow[]=[];
 const flush=()=>{if(!pack.length)return;const first=pack[0]!;unitRows.push({id:rowIdentity(first.turnId,first.item.id),rows:pack,logical});pack=[];logical=[];};
 for(const row of source){const key=rowIdentity(row.turnId,row.item.id);if(consumed.has(key))continue;const segment=starts.get(key);
  const atom=segment?segment.members.map(m=>sourceById.get(rowIdentity(m.turnId,m.itemId))!).filter(Boolean):[row];
  for(const member of atom)consumed.add(rowIdentity(member.turnId,member.item.id));
  const rendered=atom.length>MAX_UNIT_ROWS?[row]:atom,crossTurn=atom.some(r=>r.turnId!==row.turnId);
  if(pack.length&&(crossTurn||pack[0]!.turnId!==row.turnId||pack.length+rendered.length>MAX_UNIT_ROWS))flush();
  pack.push(...rendered);logical.push(...atom);if(crossTurn)flush();
 }
 flush();return{units:unitRows,segments:byItem};
}
