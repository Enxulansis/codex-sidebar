import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {buildSync} from 'esbuild';
import {Store,StoreLockedError} from '../src/codex-prototype/storage';
import {DailySessionStore} from '../src/codex-prototype/daily-session-store';

const roots:string[]=[],children:ChildProcess[]=[];
afterEach(async()=>{for(const child of children.splice(0))if(child.exitCode===null&&child.signalCode===null){const exit=once(child,'exit');child.kill();await exit;}for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(daily:boolean){
 const root=mkdtempSync(join(tmpdir(),'codex-lock-fault-'));roots.push(root);
 const store=daily?new DailySessionStore(join(root,'daily'),root):new Store(join(root,'ledger.json'));
 store.own('ours');const id=store.reserve('ours','preserve');store.record(id,{status:'requestFailedOrDisconnected'});store.pending({threadId:'ours',turnId:'unknown',kind:'command'});
 const entry=join(root,'store.cjs');buildSync({entryPoints:[resolve('src/codex-prototype/storage.ts')],bundle:true,platform:'node',format:'cjs',outfile:entry});
 return{root,store,id,entry,before:readFileSync(store.path)};
}
function start(f:ReturnType<typeof fixture>,body:string){
 const child=spawn(process.execPath,['-e',`const {Store}=require(process.argv[1]);const fs=require('node:fs');const store=new Store(process.argv[2]);store.update(data=>{process.send('locked');${body}});`,f.entry,f.store.path],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
 children.push(child);return child;
}
describe.each([false,true])('isolated abnormal ledger locks (daily=%s)',daily=>{
 it('refuses a live writer and retains every byte, then permits one write after normal release',async()=>{
  const f=fixture(daily),signal=join(f.root,'release');
  const child=start(f,`while(!fs.existsSync(${JSON.stringify(signal)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);`);
  await once(child,'message');expect(()=>f.store.reserve('ours','blocked')).toThrow(StoreLockedError);expect(readFileSync(f.store.path)).toEqual(f.before);
  const exit=once(child,'exit');writeFileSync(signal,'release');expect((await exit)[0]).toBe(0);expect(existsSync(f.store.path+'.lock')).toBe(false);
  f.store.reserve('ours','allowed');expect(f.store.read().attempts).toHaveLength(2);expect(f.store.read().pendingApprovals).toHaveLength(1);
 });
 it('forced termination leaves a blocking lock without resetting selected, pending or unknown reservations',async()=>{
  const f=fixture(daily),child=start(f,'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);');
  await once(child,'message');const exit=once(child,'exit');child.kill();await exit;
  const lock=f.store.path+'.lock',lockBytes=readFileSync(lock);
  expect(()=>f.store.record(f.id,{status:'completed'})).toThrow('上次异常退出留下了锁');
  expect(()=>f.store.reserve('ours','blocked')).toThrow('本次未写入、未重建记录');
  expect(readFileSync(lock)).toEqual(lockBytes);expect(readFileSync(f.store.path)).toEqual(f.before);
  expect(f.store.read()).toMatchObject({selected:'ours',attempts:[{id:f.id,status:'requestFailedOrDisconnected'}],pendingApprovals:[{turnId:'unknown'}]});
  // Test-owned offline repair only: the child has exited, and no production repair API runs.
  renameSync(lock,lock+'.quarantine');f.store.reserve('ours','explicit-after-offline-check');
  expect(existsSync(lock+'.quarantine')).toBe(true);expect(f.store.read().attempts).toHaveLength(2);
 });
 it('an interrupted temporary write is preserved and never replayed into the ledger automatically',async()=>{
  const f=fixture(daily),child=start(f,"data.attempts=[];fs.writeFileSync(store.path+'.next',JSON.stringify(data));process.exit(51);");
  expect((await once(child,'exit'))[0]).toBe(51);
  const next=readFileSync(f.store.path+'.next');expect(()=>f.store.reserve('ours','blocked')).toThrow(StoreLockedError);
  expect(readFileSync(f.store.path)).toEqual(f.before);expect(readFileSync(f.store.path+'.next')).toEqual(next);
  expect(f.store.read().attempts).toHaveLength(1);
 });
 it('a normal exception releases only its own lock and leaves the old record intact',()=>{
  const f=fixture(daily);expect(()=>f.store.update(()=>{throw Error('injected');})).toThrow('injected');
  expect(existsSync(f.store.path+'.lock')).toBe(false);expect(readFileSync(f.store.path)).toEqual(f.before);
 });
});
