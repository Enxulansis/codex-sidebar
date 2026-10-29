import {afterEach,describe,expect,it,vi} from 'vitest';
import {SessionBar} from '../src/codex-prototype/display/session-bar';
function fixture(){
 const input={},outside={},tab={isConnected:true,focus:vi.fn()},doc={activeElement:input};vi.stubGlobal('document',doc);
 const bar:any=Object.assign(Object.create(SessionBar.prototype),{rename:{hidden:false,contains:(node:unknown)=>node===input},renameId:'b',nodes:new Map([['b',tab]])});return{bar,input,outside,tab,doc};
}
afterEach(()=>vi.unstubAllGlobals());
describe('closing the rename popup releases keyboard focus',()=>{
 it('returns focus from the closed editor to its originating tab',()=>{const f=fixture();f.bar.closeRename();expect(f.bar.rename.hidden).toBe(true);expect(f.bar.renameId).toBe('');expect(f.tab.focus).toHaveBeenCalledExactlyOnceWith({preventScroll:true});});
 it('does not steal focus from a newly selected outside control',()=>{const f=fixture();f.doc.activeElement=f.outside;f.bar.closeRename();expect(f.tab.focus).not.toHaveBeenCalled();});
 it('does not focus a removed tab or re-focus an already closed popup',()=>{const f=fixture();f.tab.isConnected=false;f.bar.closeRename();expect(f.tab.focus).not.toHaveBeenCalled();f.tab.isConnected=true;f.bar.closeRename();expect(f.tab.focus).not.toHaveBeenCalled();});
});
