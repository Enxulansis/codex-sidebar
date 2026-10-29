import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Store} from './storage';
import {hasAcceptanceBatch,openAcceptanceBatch} from './acceptance-batch';
export const DISPLAY_BATCH = {id:'online-display-2026-10-12',limit:2} as const;
/** Import ownership/tombstones, never import, reset or write the old twelve attempts. */
export function displayBatch(run:string,workspace?:string) {
  if(hasAcceptanceBatch(run))return openAcceptanceBatch(run,workspace);
  const baseline=readFileSync(join(run,'ledger.json'));
  const data=JSON.parse(baseline.toString('utf8'));
  if(!Array.isArray(data.attempts)||data.attempts.length!==12||!Array.isArray(data.threads))throw Error('旧12次账本核对失败；禁止开启新批次');
  const baselineSha256=createHash('sha256').update(baseline).digest('hex');
  const store=new Store(join(run,DISPLAY_BATCH.id,'ledger.json'),DISPLAY_BATCH.limit,data.attempts.map((a:{threadId:string})=>a.threadId));
  if(!existsSync(store.path))store.update(next=>{Object.assign(next,{threads:[...data.threads],...(data.selected?{selected:data.selected}:{}),pendingApprovals:data.pendingApprovals??[],invalidatedApprovals:data.invalidatedApprovals??[],batch:{...DISPLAY_BATCH,baselineSha256}});});
  const batch=(store.read() as any).batch;
  if(batch?.id!==DISPLAY_BATCH.id||batch?.limit!==DISPLAY_BATCH.limit||batch?.baselineSha256!==baselineSha256)throw Error('本批账本或旧账本身份不匹配；停止调用');
  return{store,oldUsed:data.attempts.length as number,baselineSha256,batchId:DISPLAY_BATCH.id,independentBatch:false as const};
}
