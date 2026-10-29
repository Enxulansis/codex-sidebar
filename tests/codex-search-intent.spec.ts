import {afterEach,describe,expect,it,vi} from 'vitest';
import {SearchPanel} from '../src/codex-prototype/display/search-panel';
import type {SearchHit} from '../src/codex-prototype/search-query';
import {searchHitKey} from '../src/codex-prototype/search-walk';
const hit=(threadId:string,itemId:string):SearchHit=>({threadId,itemId,turnId:'turn',title:threadId,kind:'正文',snippet:'needle',total:1,incomplete:false});
function fixture(){
 const selects:{id:string;current:()=>boolean;resolve:(value:boolean)=>void;reject:(error:Error)=>void}[]=[];
 const panel:any=Object.assign(Object.create(SearchPanel.prototype),{
  state:{threadId:'a',connectionId:1,copySettings:{searchReturnPillSeconds:12},sessionCatalog:{sessions:[],recycle:[]}},origin:{threadId:'a',title:'Origin'},raw:'needle',openState:true,navigationVersion:0,
  landing:{cancel:vi.fn()},results:{hidden:false},info:{textContent:''},pill:{hidden:true},returnButton:{textContent:''},remember:vi.fn(),markVisible:vi.fn(),render:vi.fn(),
  callbacks:{select:vi.fn((id:string,current:()=>boolean)=>new Promise<boolean>((resolve,reject)=>selects.push({id,current,resolve,reject}))),navigate:vi.fn(()=>true),cancelNavigation:vi.fn()},
 });return{panel,selects};
}
afterEach(()=>{vi.useRealTimers();});
describe('a new enabled local search target owns pending navigation',()=>{
 it.each(['resolve','reject'] as const)('supersedes an unresolved cross-thread selection and ignores its late %s',async outcome=>{
  vi.useFakeTimers();const f=fixture(),remote=hit('b','remote'),local=hit('a','local'),old=f.panel.activate(remote);expect(f.selects[0].current()).toBe(true);
  const latest=f.panel.activate(local);expect(f.selects[0].current()).toBe(false);expect(f.selects.map(value=>value.id)).toEqual(['b','a']);expect(f.panel.callbacks.navigate).not.toHaveBeenCalled();f.selects[1].resolve(true);await latest;expect(f.panel.pendingHit).toBeUndefined();expect(f.panel.callbacks.navigate).toHaveBeenCalledExactlyOnceWith(local,expect.any(Object));
  expect(f.panel.returnTicket.pending).toBe(f.panel.activeHit);expect(f.panel.activeHit.hit).toBe(local);
  if(outcome==='resolve')f.selects[0].resolve(false);else f.selects[0].reject(Error('late failure'));await old;expect(f.panel.info.textContent).toBe('');expect(f.panel.activeHit.hit).toBe(local);
 });
 it('keeps disabled foreign or archived clicks from replacing the existing pending target',async()=>{
  vi.useFakeTimers();const f=fixture(),remote=hit('b','remote'),old=f.panel.activate(remote);await f.panel.activate(hit('c','other'));await f.panel.activate({...hit('a','archived'),archived:true});expect(f.panel.pendingHit).toBe(remote);expect(f.selects).toHaveLength(1);expect(f.panel.callbacks.navigate).not.toHaveBeenCalled();f.selects[0].resolve(true);await old;
 });
 it('lets keyboard walking choose the same enabled local result while a foreign target is pending',()=>{
  const f=fixture(),remote=hit('b','remote'),local=hit('a','local');f.panel.pendingHit=remote;f.panel.activeHit={hit:remote,query:'needle',occurrence:0,located:false};f.panel.keyboardKey=searchHitKey(remote);f.panel.model=()=>({hits:[remote,local]});f.panel.hits={querySelectorAll:()=>[{dataset:{searchHit:searchHitKey(local)}}]};expect(f.panel.nextSearchHit(false)).toMatchObject({hit:local,occurrence:0});
 });
});
