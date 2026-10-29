import {describe,it,expect} from 'vitest';
import {setImmediate as nextTask} from 'node:timers/promises';
import {codexPageContent} from '../src/codex-prototype/codex-page-state';
import type {Session} from '../src/codex-prototype/session';
const session=(count:number)=>({projection:{items:new Map(Array.from({length:count/4},(_,n)=>['row-'+n,{turnId:'turn',complete:true,item:{type:'userMessage',id:'row-'+n,content:[{type:'text',text:'before'},...Array.from({length:4},(_,i)=>({type:'localImage',path:'image-'+(n*4+i)+'.png'})),{type:'text',text:'after'}]}}])),turns:new Map([['turn',{id:'turn',status:'completed',itemsView:'full'}]]),metrics:{forTurn:()=>undefined}},approvals:new Map(),userInputs:new Map(),revertReason:()=> 'fixture does not expose revert',forkReason:()=>''})as unknown as Session;
describe('bounded whole-projection image verification',()=>{
 it.each([32,128,512])('checks all %i images with a shared limit across messages, preserving input order and identity',async count=>{
  let active=0,peak=0,calls=0;const content=await codexPageContent(session(count),'thread',async(path,id)=>{active++;peak=Math.max(peak,active);calls++;try{await nextTask();return{id,name:path,src:'data:image/png;base64,aQ=='};}finally{active--;}});
  expect(calls).toBe(count);expect(peak).toBeLessThanOrEqual(4);expect(active).toBe(0);
  expect(content.items).toHaveLength(count/4);
  for(const [rowIndex,row]of content.items.entries()){expect(row.item.type).toBe('userMessage');if(row.item.type!=='userMessage')throw Error('wrong row');expect(row.item.content[0]).toEqual({type:'text',text:'before'});expect(row.item.content.at(-1)).toEqual({type:'text',text:'after'});for(let image=0;image<4;image++)expect(row.item.content[image+1]).toMatchObject({type:'localImage',path:'image-'+(rowIndex*4+image)+'.png',displayImage:{id:JSON.stringify(['thread','turn','row-'+rowIndex,image+1])}});}
 });
 it('rechecks every source on the next projection and preserves unavailable results in their original slots',async()=>{
  let generation=0,calls=0;const active=session(32),check=async(path:string,id:string)=>{calls++;await nextTask();return path==='image-3.png'&&generation?{id,name:'图片不可用',error:'changed source'}:{id,name:path,src:'data:image/png;base64,'+(generation?'Yg==':'YQ==')};};
  const first=await codexPageContent(active,'thread',check);generation++;const second=await codexPageContent(active,'thread',check);expect(calls).toBe(64);expect(JSON.stringify(first)).toContain('YQ==');expect(JSON.stringify(second)).not.toContain('YQ==');const row=second.items[0]!.item;if(row.type!=='userMessage')throw Error('wrong row');expect(row.content[4]).toMatchObject({type:'localImage',path:'image-3.png',displayImage:{error:'changed source'}});expect(second.items).toHaveLength(first.items.length);
 });
 it('releases queued slots when a checker rejects and leaves later projections usable',async()=>{
  let active=0,peak=0,calls=0;const pending=codexPageContent(session(32),'thread',async(path,id)=>{active++;peak=Math.max(peak,active);calls++;try{await nextTask();if(path==='image-0.png')throw Error('synthetic check failure');return{id,name:path};}finally{active--;}});
  await expect(pending).rejects.toThrow('synthetic check failure');for(let i=0;i<40&&calls<32;i++)await nextTask();while(active)await nextTask();expect(calls).toBe(32);expect(peak).toBeLessThanOrEqual(4);
  const next=await codexPageContent(session(32),'thread',async(path,id)=>({id,name:path}));expect(next.items).toHaveLength(8);
 });
});
