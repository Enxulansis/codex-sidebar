import type {SearchHit} from './search-query';
export const SEARCH_HIT_LIMIT=500,LOADED_BODY_HITS=60,TOOL_HITS_PER_THREAD=24,LOADED_TOTAL_HITS=LOADED_BODY_HITS+TOOL_HITS_PER_THREAD;
/** DSH's independent tool quota, applied to verified public identities; body/attachment hits take priority. */
export class SearchHitBudget{
 private body:SearchHit[]=[];private tools:SearchHit[]=[];private ids=new Set<string>();private counts=new Map<string,number>();private dropped=false;
 constructor(private bodyLimit:number,private totalLimit=bodyLimit){}
 get bodyCount(){return this.body.length;}get limited(){return this.dropped||this.body.length+this.tools.length>this.totalLimit;}
 add(hit:SearchHit){const key=JSON.stringify([hit.threadId,hit.turnId,hit.itemId]);if(this.ids.has(key))return;
  if(hit.kind==='工具'){const count=this.counts.get(hit.threadId)??0;if(count>=TOOL_HITS_PER_THREAD||this.tools.length>=this.totalLimit){this.dropped=true;return;}this.tools.push(hit);this.counts.set(hit.threadId,count+1);}
  else{if(this.body.length>=this.bodyLimit){this.dropped=true;return;}this.body.push(hit);}this.ids.add(key);
 }
 values(){return[...this.body,...this.tools].slice(0,this.totalLimit);}
 forget(thread:string){this.body=this.body.filter(hit=>hit.threadId!==thread);this.tools=this.tools.filter(hit=>hit.threadId!==thread);this.counts.delete(thread);this.ids=new Set([...this.body,...this.tools].map(hit=>JSON.stringify([hit.threadId,hit.turnId,hit.itemId])));}
}
