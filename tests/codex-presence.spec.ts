import {describe,it,expect} from 'vitest';
import {showCodexWelcome,tabActivity,nextCodexAnimation} from '../src/codex-prototype/display/codex-presence';
import type {PageState} from '../src/codex-prototype/page-model';
const empty=()=>({dispatchMode:'daily',ready:true,threadId:'a',connectionId:1,busy:false,items:[],turns:[],approvals:[],history:{complete:true,loading:false,error:'',hasMore:false,loadedTurns:0}}as unknown as PageState);
it('offers four bounded animation variants and excludes the previous variant',()=>{const variants=['turn','rock','spring','orbit'];expect([0,.25,.5,.75].map(value=>nextCodexAnimation('',()=>value))).toEqual(variants);for(const previous of variants)for(const value of [0,.34,.67,.999,1]){const next=nextCodexAnimation(previous,()=>value);expect(variants).toContain(next);expect(next).not.toBe(previous);}});
describe('Codex tab activity uses only the current public lifecycle',()=>{
 it('only shows the current running thread, without persisting a decorative state',()=>{const s=empty();s.busy=true;expect(tabActivity(s,'a')).toEqual({mode:'working',label:'正在处理'});expect(tabActivity(s,'b')).toEqual({mode:'idle',label:''});s.busy=false;expect(tabActivity(s,'a').mode).toBe('idle');});
 it.each([{ready:false},{needsRecovery:true},{busy:false}])('hides stale processing on %j',patch=>{expect(tabActivity({...empty(),busy:true,...patch},'a').mode).toBe('idle');});
 it('distinguishes a real approval, answer, and stop from generation',()=>{expect(tabActivity({...empty(),busy:true,approvals:[{}as any]},'a').mode).toBe('waiting');expect(tabActivity({...empty(),busy:true,userInputs:[{status:'pending'}as any]},'a').mode).toBe('waiting');expect(tabActivity({...empty(),busy:true,status:'正在停止'},'a').mode).toBe('stopping');});
});
describe('the centered welcome is limited to a confirmed empty conversation',()=>{
 it('shows a confirmed empty thread and a connected local new-chat draft',()=>{expect(showCodexWelcome(empty())).toBe(true);expect(showCodexWelcome({...empty(),threadId:'codex-local-draft',history:undefined}as any)).toBe(true);});
 it.each([{ready:false},{connecting:true},{busy:true},{operating:true},{needsRecovery:true},{error:'failure'},{offlinePreview:true},{dispatchMode:'experiment'},{dispatchMode:'connection-only'},{items:[{item:{type:'agentMessage'}}]},{turns:[{id:'old'}]},{approvals:[{}]},{userInputs:[{}]}])('does not cover history, work, recovery or failures %j',patch=>expect(showCodexWelcome({...empty(),...patch}as any)).toBe(false));
 it('stays hidden while a local send is prepared or awaiting its echo',()=>expect(showCodexWelcome(empty(),true)).toBe(false));
 it.each([{complete:false},{loading:true},{error:'cannot read'},{hasMore:true},{loadedTurns:1}])('never mistakes missing or paginated history for new chat %j',patch=>{const s=empty();expect(showCodexWelcome({...s,history:{...s.history!,...patch}})).toBe(false);});
});
