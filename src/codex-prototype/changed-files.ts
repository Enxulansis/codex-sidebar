import type {PageRow,WorkTurn} from './page-model';
import {isPageItem} from './page-model';
export const CHANGED_FILES_FOLD_KEY='codexPrototype.changedFileFolds.v1';
export type PatchStats={additions:number;deletions:number};
export type ChangedSource={itemId:string;path:string;movePath:string|null;diff:string;kind:string};
export type ChangedFile={path:string;movePath:string|null;sources:ChangedSource[];stats:PatchStats|null};
export type ChangedGroup={turnId:string;files:ChangedFile[]};
/** Count only structurally complete unified hunks. Opaque/binary/partial patches are unknown. */
export function publicPatchStats(diff:string):PatchStats|null{
 if(typeof diff!=='string'||diff.length>2_000_000)return null;
 let old=0,next=0,hunks=0,additions=0,deletions=0,lines=0,body=false;
 const metadata=/^(?:diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to )/;
 for(const line of diff.split(/\r?\n/)){
  if(++lines>50_000)return null;
  const h=/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?:.*)$/.exec(line);
  if(h){if(old||next)return null;old=h[1]===undefined?1:Number(h[1]);next=h[2]===undefined?1:Number(h[2]);if(!Number.isSafeInteger(old)||!Number.isSafeInteger(next)||old===0&&next===0)return null;hunks++;body=true;continue;}
  if(line==='\\ No newline at end of file'&&body)continue;
  if(old||next){if(line[0]==='+'){next--;additions++;}else if(line[0]==='-'){old--;deletions++;}else if(line[0]===' '){old--;next--;}else return null;if(old<0||next<0)return null;continue;}
  if(line===''||metadata.test(line)){body=false;continue;}return null;
 }
 return hunks>0&&old===0&&next===0?{additions,deletions}:null;
}
/** Literal public path pairs, per turn; totals are cumulative patch lines, never a net workspace diff. */
export function changedFiles(rows:readonly PageRow[],turns:readonly WorkTurn[]=[]){
 const groups=new Map<string,Map<string,ChangedFile>>(),seen=new Set<string>();let excluded=0;
 for(const row of rows){if(!isPageItem(row.item,'fileChange'))continue;const item=row.item,key=JSON.stringify([row.turnId,item.id]);if(seen.has(key))continue;seen.add(key);
  if(item.status!=='completed'||!Array.isArray(item.changes)){excluded++;continue;}
  for(const change of item.changes){if(!change||typeof change.path!=='string'||!change.path||typeof change.diff!=='string'||!change.kind||!['add','delete','update'].includes(change.kind.type)){excluded++;continue;}
   const movePath=change.kind.type==='update'&&typeof change.kind.move_path==='string'&&change.kind.move_path?change.kind.move_path:null,fileKey=JSON.stringify([change.path,movePath]);
   let files=groups.get(row.turnId);if(!files){files=new Map();groups.set(row.turnId,files);}let file=files.get(fileKey);const stats=publicPatchStats(change.diff);
   if(!file){file={path:change.path,movePath,sources:[],stats:stats&&{...stats}};files.set(fileKey,file);}else file.stats=file.stats&&stats?{additions:file.stats.additions+stats.additions,deletions:file.stats.deletions+stats.deletions}:null;
   file.sources.push({itemId:item.id,path:change.path,movePath,diff:change.diff,kind:change.kind.type});
  }
 }
 const order=new Map(turns.map((turn,index)=>[turn.id,index]));const result:ChangedGroup[]=[...groups].map(([turnId,files])=>({turnId,files:[...files.values()]}));
 result.sort((a,b)=>(order.get(b.turnId)??-1)-(order.get(a.turnId)??-1));return {groups:result,excluded};
}
/** Original DSH165 djb2 fold fingerprint; length-delimited inputs avoid ambiguous path concatenation. */
export function changedFilesFoldKey(thread:string,groups:readonly ChangedGroup[]){let hash=5381;for(const group of groups)for(const value of [group.turnId,...group.files.flatMap(file=>[file.path,file.movePath??''])]){const text=value.length+':'+value;for(let i=0;i<text.length;i++)hash=((hash*33)^text.charCodeAt(i))>>>0;}return JSON.stringify([thread,'changed-files','cf:'+hash.toString(36)]);}
