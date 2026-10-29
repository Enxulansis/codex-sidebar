import {afterEach,describe,expect,it,vi} from 'vitest';
import {RailViewMemory} from '../src/codex-prototype/display/rail-view-memory';
import {RAIL_VIEW_RECORDS,type RailRecord} from '../src/codex-prototype/rail-view-store';
import type {PageHost} from '../src/codex-prototype/page-host';
vi.mock('../src/codex-prototype/display/dsh-math-export',()=>({showFormulaToast:vi.fn()}));
const pages:EventTarget[]=[];
afterEach(()=>{for(const page of pages.splice(0))page.dispatchEvent(new Event('pagehide'));vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
function fixture(){
 const page=new EventTarget(),messages=new EventTarget(),posts:any[]=[];pages.push(page);vi.stubGlobal('window',page);
 const view=new RailViewMemory({messages,postMessage:m=>posts.push(m)} as PageHost,()=>{});
 const reply=(records:unknown,patch:object={})=>{const request=posts.at(-1);messages.dispatchEvent(new MessageEvent('message',{data:{type:'rail-view-result',id:request.id,threadId:request.threadId,connectionId:request.connectionId,ok:true,records,...patch}}));};
 view.configure({threadId:'a',connectionId:1});return{page,view,posts,reply};
}
const mark=(turnId:string,note=turnId,drop?:RailRecord['drop']):RailRecord=>({turnId,starred:true,note,...(drop?{drop}:{})});
describe('confirmed navigation snapshots',()=>{
 it('replaces the full bounded snapshot, removes absent metadata and does not retain receipt objects',()=>{
  const f=fixture(),records=Array.from({length:RAIL_VIEW_RECORDS},(_,i)=>mark('t'+i,'note '+i,i%2?'hidden':undefined));f.reply(records);
  expect(f.view.dropped).toBe(100);for(const record of records)expect(f.view.get(record.turnId)).toEqual(record);
  records[0]!.note='mutated outside';expect(f.view.get('t0')?.note).toBe('note 0');
  f.view.read();f.reply([mark('t0','replacement','merged')]);expect(f.view.get('t0')?.note).toBe('replacement');expect(f.view.get('t199')).toBeUndefined();expect(f.view.dropped).toBe(1);
  f.view.read();f.reply([]);expect(f.view.get('t0')).toBeUndefined();expect(f.view.dropped).toBe(0);
 });
 it('keeps confirmed records after rejected changes and malformed success, then replaces only on verified read',()=>{
  const f=fixture();f.reply([mark('one','confirmed','hidden')]);f.view.change({action:'note',turnId:'one',value:'rejected'});f.reply([], {ok:false,error:'disk'});
  expect(f.view.editable).toBe(true);expect(f.view.get('one')?.note).toBe('confirmed');expect(f.view.dropped).toBe(1);
  f.view.change({action:'star',turnId:'one',value:false});f.reply([mark('one'),mark('one')]);expect(f.view.blocked).toBe(true);expect(f.view.get('one')?.note).toBe('confirmed');
  const count=f.posts.length;f.view.change({action:'restore'});expect(f.posts).toHaveLength(count);f.view.read();f.reply([]);expect(f.view.editable).toBe(true);expect(f.view.get('one')).toBeUndefined();expect(f.view.dropped).toBe(0);
 });
 it('ignores timed-out and superseded replies while a fresh read reconciles the confirmed state',()=>{
  vi.useFakeTimers();const f=fixture();f.reply([mark('one','before')]);f.view.change({action:'note',turnId:'one',value:'unknown'});const old={...f.posts.at(-1)};
  vi.advanceTimersByTime(5001);expect(f.view.blocked).toBe(true);expect(f.view.get('one')?.note).toBe('before');f.reply([mark('one','late')],{id:old.id});expect(f.view.get('one')?.note).toBe('before');
  f.view.read();f.reply([mark('one','late')],{id:old.id});expect(f.view.editable).toBe(false);f.reply([mark('one','reconciled')]);expect(f.view.editable).toBe(true);expect(f.view.get('one')?.note).toBe('reconciled');
 });
 it('clears matching turn IDs across thread and connection changes, and ignores detached-page replies',()=>{
  const f=fixture();f.reply([mark('same','A','hidden')]);f.view.read();const old={...f.posts.at(-1)};f.view.configure({threadId:'b',connectionId:1});expect(f.view.get('same')).toBeUndefined();expect(f.view.dropped).toBe(0);
  f.reply([mark('same','late A')],{id:old.id,threadId:'a'});expect(f.view.get('same')).toBeUndefined();f.reply([mark('same','B')]);expect(f.view.get('same')?.note).toBe('B');
  f.view.configure({threadId:'b',connectionId:2});expect(f.view.get('same')).toBeUndefined();f.reply([mark('same','old connection')],{connectionId:1});expect(f.view.get('same')).toBeUndefined();
  f.page.dispatchEvent(new Event('pagehide'));f.reply([mark('same','disposed')]);expect(f.view.get('same')).toBeUndefined();
 });
 it('does not rescan all confirmed identities for each lookup on a dense public node table',()=>{
  const f=fixture(),clone=structuredClone;let identities=0;
  vi.stubGlobal('structuredClone',(value:unknown)=>{const result=clone(value);if(Array.isArray(result))for(const record of result){const id=record.turnId;Object.defineProperty(record,'turnId',{enumerable:true,get(){identities++;return id;}});}return result;});
  f.reply(Array.from({length:RAIL_VIEW_RECORDS},(_,i)=>mark('t'+(1000-RAIL_VIEW_RECORDS+i))));identities=0;
  let found=0;for(let pass=0;pass<4;pass++)for(let i=0;i<1000;i++)found+=Number(!!f.view.get('t'+i));
  expect(found).toBe(4*RAIL_VIEW_RECORDS);expect(identities).toBeLessThanOrEqual(4000);
 });
 it('rejects oversized receipts without replacing a confirmed snapshot',()=>{
  const f=fixture();f.reply([mark('one','confirmed')]);f.view.read();f.reply(Array.from({length:RAIL_VIEW_RECORDS+1},(_,i)=>mark('t'+i)));
  expect(f.view.blocked).toBe(true);expect(f.view.get('one')?.note).toBe('confirmed');expect(f.view.get('t0')).toBeUndefined();f.view.read();f.reply([]);expect(f.view.editable).toBe(true);expect(f.view.get('one')).toBeUndefined();
 });
 it('recovers failed and timed-out reads without accepting a superseded read',()=>{
  vi.useFakeTimers();const f=fixture();f.reply([], {ok:false,error:'read failed'});expect(f.view.ready).toBe(false);expect(f.view.blocked).toBe(true);
  f.view.read();const timedOut=f.posts.at(-1).id;vi.advanceTimersByTime(5001);f.reply([mark('one','late timeout')],{id:timedOut});expect(f.view.get('one')).toBeUndefined();
  f.view.read();const superseded=f.posts.at(-1).id;f.view.read();f.reply([mark('one','old read')],{id:superseded});expect(f.view.get('one')).toBeUndefined();f.reply([mark('one','fresh read')]);expect(f.view.editable).toBe(true);expect(f.view.get('one')?.note).toBe('fresh read');
 });
});
