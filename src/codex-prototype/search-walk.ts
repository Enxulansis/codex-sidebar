import type {SearchHit} from './search-query';
export const searchHitKey=(hit:Pick<SearchHit,'threadId'|'turnId'|'itemId'>)=>JSON.stringify([hit.threadId,hit.turnId,hit.itemId]);
/** The panel and keyboard share one grouping; late results cannot split a session's walk. */
export function groupedSearchHits(hits:readonly SearchHit[],origin?:string,order:'recent'|'oldest'='recent'):SearchHit[]{
 const groups=new Map<string,SearchHit[]>();for(const hit of hits){const group=groups.get(hit.threadId)??[];group.push(hit);groups.set(hit.threadId,group);}
 // DSH165 byTime uses an absent-time sort sentinel without claiming a timestamp.
 for(const group of groups.values())group.sort((a,b)=>order==='oldest'?(a.timeMs??0)-(b.timeMs??0):(b.timeMs??0)-(a.timeMs??0));
 const first=origin?groups.get(origin):undefined;if(origin)groups.delete(origin);return[...first??[],...[...groups.values()].flat()];
}
export type SearchWalkCursor={key:string;occurrence:number};
/** Only current, enabled result rows participate; no ordinal survives a replaced result table. */
export function stepSearchWalk(hits:readonly SearchHit[],selected:string,cursor:SearchWalkCursor|undefined,reverse=false){
  const rows=hits.filter(hit=>!hit.archived&&Number.isSafeInteger(hit.total)&&hit.total>0);if(!rows.length)return;
 const index=rows.findIndex(hit=>searchHitKey(hit)===selected),direction=reverse?-1:1;
 if(index<0)return{hit:rows[0]!,occurrence:0,wrapped:false};
 const hit=rows[index]!;
 if(!cursor||cursor.key!==selected||!Number.isSafeInteger(cursor.occurrence)||cursor.occurrence<0)return{hit,occurrence:0,wrapped:false};
 const occurrence=Math.min(cursor.occurrence,hit.total-1)+direction;
 if(occurrence>=0&&occurrence<hit.total)return{hit,occurrence,wrapped:false};
 const next=index+direction,target=rows[(next+rows.length)%rows.length]!;
 return{hit:target,occurrence:reverse?target.total-1:0,wrapped:next<0||next>=rows.length};
}
