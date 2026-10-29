import {describe,it,expect,vi} from 'vitest';
import {RailViewStore,RAIL_VIEW_KEY,RAIL_VIEW_RECORDS,RAIL_VIEW_THREADS,handleRailView} from '../src/codex-prototype/rail-view-store';
import {RailViewMemory} from '../src/codex-prototype/display/rail-view-memory';
import type {PageHost} from '../src/codex-prototype/page-host';
vi.mock('../src/codex-prototype/display/dsh-math-export',()=>({showFormulaToast:vi.fn()}));
function memory(initial?:unknown){let raw=initial;return{get:<T>(_key:string,fallback:T)=>(raw??fallback) as T,update:vi.fn(async(_key:string,value:unknown)=>{raw=structuredClone(value);}),value:()=>raw};}
describe('real-ID navigation metadata',()=>{
 it('keeps stars, notes and navigation dropping independent across threads and reload',async()=>{
  const io=memory(),store=new RailViewStore(io);await store.change('a',{action:'star',turnId:'one',value:true},()=>true);await store.change('a',{action:'note',turnId:'one',value:'  原标注  '},()=>true);await store.change('a',{action:'drop',turnId:'one',value:'merged'},()=>true);await store.change('b',{action:'note',turnId:'one',value:'B 独立标注'},()=>true);
  await store.change('a',{action:'star',turnId:'one',value:false},()=>true);expect(await new RailViewStore(io).load('a')).toEqual([{turnId:'one',starred:false,note:'原标注',drop:'merged'}]);await store.change('a',{action:'restore'},()=>true);expect(await store.load('a')).toEqual([{turnId:'one',starred:false,note:'原标注'}]);expect(await store.load('b')).toEqual([{turnId:'one',starred:false,note:'B 独立标注'}]);expect(io.update.mock.calls.every(([key])=>key===RAIL_VIEW_KEY)).toBe(true);
 });
 it('preserves corrupt metadata without replacing it or claiming an empty record',async()=>{
  const raw=[{threadId:'a',records:[{turnId:'one',starred:true,note:0}]}],io=memory(raw),store=new RailViewStore(io);await expect(store.load('a')).rejects.toThrow('原记录保留');await expect(store.change('a',{action:'restore'},()=>true)).rejects.toThrow('原记录保留');expect(io.value()).toEqual(raw);expect(io.update).not.toHaveBeenCalled();
 });
 it('rejects capacity growth without silently deleting another bookmark or session',async()=>{
  const records=Array.from({length:RAIL_VIEW_RECORDS},(_,i)=>({turnId:'t'+i,starred:true,note:''})),io=memory([{threadId:'a',records}]),store=new RailViewStore(io);await expect(store.change('a',{action:'note',turnId:'new',value:'new'},()=>true)).rejects.toThrow('200');expect(await store.load('a')).toEqual(records);await store.change('a',{action:'note',turnId:'t0',value:'updated'},()=>true);expect(await store.load('a')).toHaveLength(RAIL_VIEW_RECORDS);
  const threads=Array.from({length:RAIL_VIEW_THREADS},(_,i)=>({threadId:'thread'+i,records:[{turnId:'one',starred:true,note:''}]})),otherIO=memory(threads),other=new RailViewStore(otherIO);await expect(other.change('new',{action:'star',turnId:'one',value:true},()=>true)).rejects.toThrow('32');expect(otherIO.value()).toEqual(threads);
 });
 it('serializes operations, checks a queued page again and does not publish a failed write as confirmed',async()=>{
  const io=memory(),store=new RailViewStore(io);let release!:()=>void,live=true;io.update.mockImplementationOnce(()=>new Promise<void>(r=>release=r));const first=store.change('a',{action:'star',turnId:'one',value:true},()=>true);await Promise.resolve();const old=store.change('a',{action:'note',turnId:'one',value:'stale'},()=>live);live=false;release();await first;await expect(old).rejects.toThrow('视图已失效');io.update.mockRejectedValueOnce(Error('disk'));await expect(store.change('a',{action:'note',turnId:'one',value:'failed'},()=>true)).rejects.toThrow('disk');expect(await store.load('a')).toEqual([{turnId:'one',starred:true,note:''}]);
 });
 it('forgets only acknowledged deleted thread metadata and prevents late writes from reviving it',async()=>{
  const store=new RailViewStore(memory());for(const id of ['a','b'])await store.change(id,{action:'note',turnId:'one',value:id},()=>true);await store.forget('a');await expect(store.change('a',{action:'star',turnId:'late',value:true},()=>true)).rejects.toThrow('身份已失效');expect(await store.load('b')).toEqual([{turnId:'one',starred:false,note:'b'}]);
 });
 it('serializes a deletion behind an already writing update and rejects both in-flight and queued revival',async()=>{
  const io=memory([{threadId:'b',records:[{turnId:'one',starred:true,note:'B'}]}]),store=new RailViewStore(io);let release!:()=>void;io.update.mockImplementationOnce(()=>new Promise<void>(r=>release=r));const first=store.change('a',{action:'note',turnId:'one',value:'pending'},()=>true);await Promise.resolve();const late=store.change('a',{action:'star',turnId:'two',value:true},()=>true),deletion=store.forget('a'),firstFailure=expect(first).rejects.toThrow('身份已失效'),lateFailure=expect(late).rejects.toThrow('身份已失效');release();await Promise.all([firstFailure,lateFailure,deletion]);expect(await new RailViewStore(io).load('a')).toEqual([]);expect(await store.load('b')).toEqual([{turnId:'one',starred:true,note:'B'}]);
 });
 it('binds host mutations to document, connection, selected thread and the verified outline',async()=>{
  const io=memory(),store=new RailViewStore(io),post=vi.fn(),owner={threadId:'a',connectionId:2,turnIds:['one']},message={type:'rail-view-change',id:1,threadId:'a',connectionId:2,change:{action:'note',turnId:'one',value:'confirmed'}};
  for(const mutation of [{threadId:'b'},{connectionId:1},{change:{action:'note',turnId:'foreign',value:'bad'}}])await handleRailView(store,{...message,...mutation},post,()=>owner,()=>true);expect(io.update).not.toHaveBeenCalled();expect(post.mock.calls.every(([reply])=>!reply.ok)).toBe(true);post.mockClear();await handleRailView(store,message,post,()=>owner,()=>false);expect(post).not.toHaveBeenCalled();await handleRailView(store,message,post,()=>owner,()=>true);expect(post).toHaveBeenCalledWith(expect.objectContaining({id:1,ok:true,threadId:'a',connectionId:2,records:[{turnId:'one',starred:false,note:'confirmed'}]}));
 });
 it('waits for an accepted update when a new page rereads an unknown receipt',async()=>{
  const io=memory(),store=new RailViewStore(io);let release!:()=>void;io.update.mockImplementationOnce(()=>new Promise<void>(r=>release=r));const pending=store.change('a',{action:'note',turnId:'one',value:'saved'},()=>true);await Promise.resolve();const read=store.load('a');release();await pending;expect(await read).toEqual([{turnId:'one',starred:false,note:'saved'}]);
 });
 it('blocks malformed success receipts until a verified read and ignores a previous owner reply',()=>{
  const page=new EventTarget(),messages=new EventTarget(),postMessage=vi.fn();vi.stubGlobal('window',page);try{
   const view=new RailViewMemory({postMessage,messages} as PageHost,()=>{}),reply=(body:object)=>messages.dispatchEvent(new MessageEvent('message',{data:{type:'rail-view-result',threadId:'a',connectionId:1,...body}}));view.configure({threadId:'a',connectionId:1});reply({id:1,ok:true,records:[]});expect(view.editable).toBe(true);view.change({action:'note',turnId:'one',value:'A'});reply({id:2,ok:true,records:{invalid:true}});expect(view.blocked).toBe(true);view.change({action:'star',turnId:'one',value:true});expect(postMessage).toHaveBeenCalledTimes(2);view.read();reply({id:3,ok:true,records:[{turnId:'one',starred:false,note:'A'}]});expect(view.editable).toBe(true);view.configure({threadId:'b',connectionId:2});reply({id:3,ok:true,records:[{turnId:'one',starred:true,note:'late A'}]});expect(view.get('one')).toBeUndefined();reply({id:4,threadId:'b',connectionId:2,ok:true,records:[]});expect(view.editable).toBe(true);page.dispatchEvent(new Event('pagehide'));
  }finally{vi.unstubAllGlobals();}
 });
});
