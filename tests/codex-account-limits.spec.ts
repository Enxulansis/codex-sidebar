import {afterEach,describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {accountLimitsSnapshot,validAccountLimitsSnapshot} from '../src/codex-prototype/account-limits';
import {AccountLimitsHost} from '../src/codex-prototype/account-limits-host';
import {AccountLimitsCache} from '../src/codex-prototype/account-limits-cache';
import {Rpc,type Transport} from '../src/codex-prototype/rpc';

const quota={ordinaryUsageAllowed:true,rateLimits:{limitId:'codex',primary:{usedPercent:62,windowDurationMins:10080,resetsAt:1793082811},secondary:null},rateLimitsByLimitId:null,accountId:'not-for-page',credits:{balance:'not-for-page'}};
const stamp=1792640842000;
function hostFixture(){
 let finish:(value:unknown)=>void=()=>{};
 const request=vi.fn(()=>new Promise(resolve=>{finish=resolve;})),rpc={request} as unknown as Transport;
 const cache=new AccountLimitsCache(rpc,()=>true,()=>{});let owner={rpc,cache,threadId:'owned',connectionId:7,ready:true},current=true;
 const host=new AccountLimitsHost(()=>owner,()=>current),post=vi.fn(),message={type:'account-limits-read',id:1,threadId:'owned',connectionId:7};
 return{host,post,message,request,finish:(value:unknown)=>finish(value),setOwner:(value:typeof owner)=>{owner=value;},owner,expire:()=>{current=false;}};
}
const live:Rpc[]=[];
afterEach(async()=>{vi.useRealTimers();for(const rpc of live.splice(0))await rpc.dispose();});
describe('account quota read boundaries',()=>{
 it('copies public quota fields without account IDs, billing, reset actions or inferred model quotas',()=>{
  const value=accountLimitsSnapshot(quota,stamp);expect(value).toEqual({readAt:stamp,ordinaryUsageAllowed:true,buckets:[{id:'codex',name:'codex',primary:{usedPercent:62,windowDurationMins:10080,resetsAt:1793082811},secondary:null}]});
  expect(JSON.stringify(value)).not.toContain('not-for-page');expect(validAccountLimitsSnapshot(value)).toBe(true);
 });
 it('prefers all actual named buckets to the legacy mirror without silently dropping malformed buckets',()=>{
  const value=accountLimitsSnapshot({...quota,rateLimitsByLimitId:{first:{...quota.rateLimits,limitName:'First'},second:{limitId:'second',primary:null,secondary:{usedPercent:101,windowDurationMins:null,resetsAt:null}}}},stamp);
  expect(value.buckets.map(b=>b.id)).toEqual(['first','second']);expect(value.buckets[1]?.secondary?.usedPercent).toBe(101);
  expect(()=>accountLimitsSnapshot({...quota,rateLimitsByLimitId:{first:quota.rateLimits,second:false}},stamp)).toThrow('窗口');
 });
 it('keeps unavailable windows, duration, reset and ordinary-allowed status unknown rather than zero or true',()=>{
  const value=accountLimitsSnapshot({rateLimits:{primary:null,secondary:{usedPercent:0}}},stamp);expect(value.ordinaryUsageAllowed).toBeNull();expect(value.buckets[0]).toEqual({id:'account',name:'账户',primary:null,secondary:{usedPercent:0,windowDurationMins:null,resetsAt:null}});
 });
 it.each([null,-1,NaN,Infinity,'62'])('rejects an invalid used percentage %s rather than inventing availability',usedPercent=>{expect(()=>accountLimitsSnapshot({...quota,rateLimits:{primary:{usedPercent}}},stamp)).toThrow('百分比');});
 it('rejects invalid timestamps and malformed client-side snapshots',()=>{
  expect(()=>accountLimitsSnapshot(quota,NaN)).toThrow();expect(()=>accountLimitsSnapshot({...quota,rateLimits:{primary:{usedPercent:1,resetsAt:8640000000001}}},stamp)).toThrow();
  expect(validAccountLimitsSnapshot({readAt:stamp,ordinaryUsageAllowed:null,buckets:[{id:'x',name:'x',secondary:null}]})).toBe(false);
 });
 it('does not query on construction; one explicit request uses no fallback exposure or reset-credit details',async()=>{
  const f=hostFixture();expect(f.request).not.toHaveBeenCalled();const work=f.host.handle(f.message,f.post);await Promise.resolve();expect(f.request).toHaveBeenCalledExactlyOnceWith('account/rateLimits/read',{supportsLunaReserve:false,excludeResetCreditDetails:true});f.finish(quota);await work;
  expect(f.post.mock.calls[0]?.[0]).toMatchObject({type:'account-limits-result',id:1,threadId:'owned',connectionId:7,ok:true,accountLimits:{snapshot:{ordinaryUsageAllowed:true}}});
 });
 it('rejects foreign/stale ownership and duplicate requests before transport',async()=>{
  const f=hostFixture();await f.host.handle({...f.message,threadId:'foreign'},f.post);expect(f.request).not.toHaveBeenCalled();await f.host.handle(f.message,f.post);expect(f.request).not.toHaveBeenCalled();
  await f.host.handle({...f.message,type:'account/rateLimitResetCredit/consume',id:2},f.post);expect(f.request).not.toHaveBeenCalled();
 });
 it.each(['thread','connection','page'] as const)('discards a slow reply after the %s lease changes',async change=>{
  const f=hostFixture(),work=f.host.handle(f.message,f.post);await Promise.resolve();if(change==='page')f.expire();else f.setOwner({...f.owner,...(change==='thread'?{threadId:'other'}:{connectionId:8})});f.finish(quota);await work;expect(f.post).not.toHaveBeenCalled();
 });
 it('shares one pending read and reports malformed results without forwarding raw payloads',async()=>{
  const f=hostFixture(),work=f.host.handle(f.message,f.post),second=f.host.handle({...f.message,id:2},f.post);await Promise.resolve();expect(f.request).toHaveBeenCalledTimes(1);f.finish({accountId:'private'});await Promise.all([work,second]);expect(f.post.mock.calls.map(([m])=>[m.id,m.ok])).toEqual([[1,false],[2,false]]);expect(JSON.stringify(f.post.mock.calls)).not.toContain('private');
 });
 it('expires only a quota request, ignores its late reply and keeps the same transport usable',async()=>{
  vi.useFakeTimers();const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null as number|null,kill:vi.fn(function(){child.exitCode=0;child.emit('exit',0);return true;})}),calls:any[]=[];
  child.stdin.on('data',bytes=>calls.push(JSON.parse(String(bytes))));const rpc=new Rpc(child as unknown as ChildProcessWithoutNullStreams,1000);live.push(rpc);const disconnect=vi.fn();rpc.on('disconnect',disconnect);
  const read=rpc.request('account/rateLimits/read',{supportsLunaReserve:false}),rejection=expect(read).rejects.toThrow('聊天连接保留');await vi.advanceTimersByTimeAsync(1000);await rejection;expect(child.kill).not.toHaveBeenCalled();expect(disconnect).not.toHaveBeenCalled();
  child.stdout.write(JSON.stringify({id:calls[0].id,result:quota})+'\n');const next=rpc.request('model/list',{});child.stdout.write(JSON.stringify({id:calls[1].id,result:{data:[],nextCursor:null}})+'\n');await expect(next).resolves.toEqual({data:[],nextCursor:null});expect(disconnect).not.toHaveBeenCalled();
 });
});
describe('connection quota background cache',()=>{
 it('preloads once, polls after 60 seconds, shares manual reads and releases timers',async()=>{
  vi.useFakeTimers();const request=vi.fn().mockResolvedValue(quota),cache=new AccountLimitsCache({request} as unknown as Transport,()=>true,vi.fn());
  expect(request).not.toHaveBeenCalled();cache.start();const a=cache.refresh(),b=cache.refresh();expect(a).toBe(b);await a;expect(request).toHaveBeenCalledTimes(1);expect(cache.view.snapshot?.buckets).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(59_999);expect(request).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(2);cache.dispose();await vi.advanceTimersByTimeAsync(300_000);expect(request).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
 });
 it('retains the last successful timestamp through failure and backs off repeated failures',async()=>{
  vi.useFakeTimers();const request=vi.fn().mockResolvedValueOnce(quota).mockRejectedValue(Error('offline')),cache=new AccountLimitsCache({request} as unknown as Transport,()=>true,()=>{});cache.start();await cache.refresh();const old=cache.view.snapshot;
  await vi.advanceTimersByTimeAsync(60_000);expect(cache.view.snapshot).toBe(old);expect(cache.view.error).toBe('offline');await vi.advanceTimersByTimeAsync(60_000);expect(request).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(119_999);expect(request).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(4);cache.dispose();
 });
 it('account changes clear the cache and reject an old in-flight snapshot before one new read',async()=>{
  vi.useFakeTimers();const finishes:((v:unknown)=>void)[]=[];const request=vi.fn(()=>new Promise(r=>finishes.push(r))),cache=new AccountLimitsCache({request} as unknown as Transport,()=>true,()=>{});cache.start();await Promise.resolve();const old=cache.refresh();cache.invalidateAccount();expect(cache.view.snapshot).toBeUndefined();expect(request).toHaveBeenCalledTimes(1);finishes[0]!({...quota,rateLimits:{primary:{usedPercent:99}}});await old;const fresh=cache.refresh();expect(request).toHaveBeenCalledTimes(2);expect(cache.view.snapshot).toBeUndefined();finishes[1]!(quota);await fresh;expect(request).toHaveBeenCalledTimes(2);expect(cache.view.snapshot?.buckets[0]?.primary?.usedPercent).toBe(62);cache.dispose();
 });
 it('clears an already cached account immediately while its replacement read is pending',async()=>{
  vi.useFakeTimers();let finish!:(value:unknown)=>void;const request=vi.fn().mockResolvedValueOnce(quota).mockImplementation(()=>new Promise(resolve=>finish=resolve)),cache=new AccountLimitsCache({request} as unknown as Transport,()=>true,()=>{});cache.start();await cache.refresh();expect(cache.view.snapshot).toBeDefined();const revision=cache.view.revision;cache.invalidateAccount();expect(cache.view.snapshot).toBeUndefined();expect(cache.view.pending).toBe(true);expect(cache.view.revision).toBeGreaterThan(revision);await Promise.resolve();expect(request).toHaveBeenCalledTimes(2);const pending=cache.refresh();finish(quota);await pending;expect(cache.view.snapshot).toBeDefined();cache.dispose();
 });
 it('a disconnect or disposal cannot accept a late snapshot or schedule another read',async()=>{
  vi.useFakeTimers();let finish!:(v:unknown)=>void,connected=true;const request=vi.fn(()=>new Promise(r=>finish=r)),cache=new AccountLimitsCache({request} as unknown as Transport,()=>connected,()=>{});cache.start();await Promise.resolve();const work=cache.refresh();connected=false;cache.dispose();finish(quota);await work;await vi.advanceTimersByTimeAsync(300_000);expect(request).toHaveBeenCalledTimes(1);expect(cache.view.snapshot).toBeUndefined();expect(vi.getTimerCount()).toBe(0);
 });
 it('thread and page changes share the connection cache, while a new connection starts empty',async()=>{
  const f=hostFixture();const first=f.host.handle(f.message,f.post);await Promise.resolve();f.setOwner({...f.owner,threadId:'other'});f.finish(quota);await first;expect(f.post).not.toHaveBeenCalled();expect(f.owner.cache.view.snapshot?.buckets).toHaveLength(1);
  const next=new AccountLimitsCache(f.owner.rpc,()=>true,()=>{});expect(next.view.snapshot).toBeUndefined();next.dispose();f.owner.cache.dispose();
 });
});
