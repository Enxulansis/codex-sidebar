import {describe,it,expect,vi} from 'vitest';
import {SearchHistoryStore,SEARCH_HISTORY_KEY,handleSearchHistory} from '../src/codex-prototype/search-history-store';
function memory(initial?:unknown){let raw=initial;return{get:<T>(_key:string,fallback:T)=>(raw??fallback) as T,update:vi.fn(async(_key:string,value:unknown)=>{raw=structuredClone(value);}),value:()=>raw};}
describe('workspace-local original search history',()=>{
 it('deduplicates, trims and retains newest ten without modifying other storage',async()=>{
  const io=memory(),store=new SearchHistoryStore(io);for(let i=0;i<12;i++)await store.change('add','q'+i,()=>true);await store.change('add',' q5 ',()=>true);expect(store.read()).toEqual(['q5','q11','q10','q9','q8','q7','q6','q4','q3','q2']);expect(io.update.mock.calls.every(([key])=>key===SEARCH_HISTORY_KEY)).toBe(true);
  await store.change('remove','q9',()=>true);expect(new SearchHistoryStore(io).read()).not.toContain('q9');await store.change('clear','',()=>true);expect(store.read()).toEqual([]);
 });
 it('preserves malformed original data and makes failures explicit',async()=>{
  const raw={queries:['old']},io=memory(raw),store=new SearchHistoryStore(io),post=vi.fn();expect(()=>store.read()).toThrow('原记录保留');await handleSearchHistory(store,{type:'search-history',id:1,action:'add',query:'new'},post,()=>true);expect(io.value()).toEqual(raw);expect(io.update).not.toHaveBeenCalled();expect(post).toHaveBeenCalledWith(expect.objectContaining({id:1,ok:false}));
 });
 it('serializes writes and waits for the committed value when rechecking an unknown receipt',async()=>{
  const io=memory(),store=new SearchHistoryStore(io);let release!:()=>void;io.update.mockImplementationOnce(()=>new Promise<void>(r=>release=r));const first=store.change('add','first',()=>true);await Promise.resolve();const read=store.load(),next=store.change('add','second',()=>true);release();await first;expect(await read).toEqual(['first']);await next;expect(store.read()).toEqual(['second','first']);
 });
 it('rejects invalidated queued writes and suppresses replies to an old document',async()=>{
  const io=memory(),store=new SearchHistoryStore(io),post=vi.fn();let live=true,release!:()=>void;io.update.mockImplementationOnce(()=>new Promise<void>(r=>release=r));const first=handleSearchHistory(store,{type:'search-history',id:1,action:'add',query:'accepted'},post,()=>live);await Promise.resolve();const next=store.change('add','stale',()=>live);live=false;release();await first;await expect(next).rejects.toThrow('页面已失效');expect(post).not.toHaveBeenCalled();expect(store.read()).toEqual(['accepted']);
 });
 it('keeps prior memory after a storage rejection and allows a confirmed retry',async()=>{
  const io=memory(['old']),store=new SearchHistoryStore(io);io.update.mockRejectedValueOnce(Error('disk'));await expect(store.change('add','new',()=>true)).rejects.toThrow('disk');expect(await store.load()).toEqual(['old']);await store.change('add','new',()=>true);expect(store.read()).toEqual(['new','old']);
 });
});
