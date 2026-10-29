import {afterEach,describe,expect,it,vi} from 'vitest';
import {SessionBar} from '../src/codex-prototype/display/session-bar';
import {showCopyMenu,closeStaleMathMenu} from '../src/codex-prototype/display/dsh-math-export';

vi.mock('../src/codex-prototype/display/dsh-math-export',()=>({showCopyMenu:vi.fn(),closeStaleMathMenu:vi.fn()}));
function fixture(){
 const bar:any=Object.assign(Object.create(SessionBar.prototype),{
  state:{connectionId:7,threadId:'active',ready:true,busy:false,operating:false,dispatchMode:'daily',sessionCatalog:{sessions:[{id:'active',title:'Current'},{id:'other',title:'Other'}]}},
  pending:0,sequence:0,nodes:new Map(['active','other'].map(id=>[id,{isConnected:true,focus:vi.fn()}])),
  host:{postMessage:vi.fn()},notice:{textContent:''},input:{value:'',focus:vi.fn(),select:vi.fn()},rename:{hidden:true},
 });
 bar.closeRename=vi.fn();bar.closeDelete=vi.fn();bar.closeRecycle=vi.fn();bar.syncRename=vi.fn();bar.render=vi.fn();
 return bar;
}
afterEach(()=>{vi.clearAllMocks();vi.useRealTimers();});
const menu=()=>vi.mocked(showCopyMenu).mock.calls.at(-1)!;
describe('session tab context actions use the existing native management path',()=>{
 it('offers rename, unread and archive on the clicked inactive tab without selecting it or exposing permanent deletion',async()=>{
  const bar=fixture();bar.openMenu('other',{});const [,valid,entries,canRun,focus]=menu();
  expect(entries.map(e=>e.label)).toEqual(['重命名…','标记为未读','归档（移入回收站）']);expect(valid()).toBe(true);expect(canRun!()).toBe(true);
  await entries[0]!.run();expect(bar.renameId).toBe('other');expect(bar.input.value).toBe('Other');expect(bar.input.select).toHaveBeenCalledOnce();
  expect(bar.state.threadId).toBe('active');expect(bar.host.postMessage).not.toHaveBeenCalled();focus!();expect(bar.nodes.get('other').focus).toHaveBeenCalledWith({preventScroll:true});
 });
 it('archives exactly the clicked tab, using the existing request identity and pending guard',async()=>{
  vi.useFakeTimers();const bar=fixture();bar.openMenu('other',{});await menu()[2][2]!.run();
  expect(bar.host.postMessage).toHaveBeenCalledExactlyOnceWith({type:'thread-manage',id:1,threadId:'other',action:'archive',connectionId:7});
  expect(bar.pending).toBe(1);expect(bar.state.threadId).toBe('active');expect(bar.notice.textContent).toBe('');expect(menu()[1]()).toBe(false);
 });
 it.each([{ready:false},{threadManagementAvailable:false},{busy:true},{operating:true},{offlinePreview:true}])('rejects unavailable management %j',change=>{
  const bar=fixture();Object.assign(bar.state,change);bar.openMenu('other',{});expect(showCopyMenu).not.toHaveBeenCalled();bar.openRename('other');expect(bar.input.focus).not.toHaveBeenCalled();
 });
 it('rejects pending, missing, removed and already detached targets',()=>{
  const bar=fixture();bar.pending=1;bar.openMenu('other',{});bar.pending=0;bar.state.sessionCatalog.sessions[1].pending='archive';bar.openMenu('other',{});
  bar.state.sessionCatalog.sessions[1].pending=undefined;bar.nodes.get('other').isConnected=false;bar.openMenu('other',{});bar.openMenu('absent',{});expect(showCopyMenu).not.toHaveBeenCalled();
 });
 it.each(['connection','removed','pending','busy','offline'])('invalidates an open menu after %s changes',kind=>{
  const bar=fixture();bar.openMenu('other',{});const valid=menu()[1];expect(valid()).toBe(true);
  if(kind==='connection')bar.state.connectionId++;if(kind==='removed')bar.state.sessionCatalog.sessions.pop();if(kind==='pending')bar.state.sessionCatalog.sessions[1].pending='archive';if(kind==='busy')bar.state.busy=true;if(kind==='offline')bar.state.offlinePreview=true;
  expect(valid()).toBe(false);expect(menu()[3]!()).toBe(false);
 });
 it('keeps the menu valid through unrelated selection/title updates and rereads the latest rename value',async()=>{
  const bar=fixture();bar.openMenu('other',{});bar.state.threadId='other';bar.state.sessionCatalog.sessions[1].title='Latest '.repeat(20);expect(menu()[1]()).toBe(true);
  await menu()[2][0]!.run();expect(bar.input.value).toBe(bar.state.sessionCatalog.sessions[1].title.slice(0,80));expect(closeStaleMathMenu).not.toHaveBeenCalled();
 });
});
