import {afterEach,expect,it,vi} from 'vitest';
import {TurnRail} from '../src/codex-prototype/display/turn-rail';

// Minimal DOM only: real controller, message listener, buttons and timers.
// Geometry is intentionally absent; package-page checks cover actual layout.
class Element extends EventTarget{
 hidden=false;textContent='';style={visibility:'',removeProperty:vi.fn(),setProperty:vi.fn()};
 classList={add:vi.fn(),remove:vi.fn(),contains:()=>false,toggle:vi.fn()};
 children:Element[]=[];dataset={};clientWidth=0;clientHeight=0;scrollTop=0;
 onclick?:()=>void;
 append(...elements:Element[]){this.children.push(...elements);}before(){}setAttribute(){}
 querySelectorAll(){return [];}contains(){return false;}click(){this.onclick?.();}
}
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();});
function fixture(){
 vi.useFakeTimers();const page=new EventTarget(),doc=Object.assign(new EventTarget(),{body:new Element(),createElement:()=>new Element()}),messages=new EventTarget(),posts:any[]=[];
 vi.stubGlobal('window',page);vi.stubGlobal('document',doc);vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',vi.fn());
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});vi.stubGlobal('MutationObserver',class{observe(){}disconnect(){}takeRecords(){return [];}});
 const rail=new TurnRail({messages,postMessage:m=>posts.push(m)},new Element() as any,()=>false,()=>{});
 // Keep unrelated node rendering out of this navigation protocol fixture.
 Object.assign(rail,{renderNodes:vi.fn(),configure:vi.fn()});
 const state:any={threadId:'a',connectionId:1,ready:true,contentReady:true,dispatchMode:'daily',history:{generation:1,loading:false,loadingTurn:''}};
 const send=(data:any)=>messages.dispatchEvent(new MessageEvent('message',{data})),publish=()=>send({type:'state',state:structuredClone(state)});
 publish();const internals=rail as any,cancelled=vi.fn();
 const start=(reading=true)=>rail.locate({turnId:'target',itemId:'item',label:'',loaded:false,status:'completed'},reading?{purpose:'reading',onCancelled:cancelled}:undefined);
 const requests=()=>posts.filter(p=>p.type==='navigate');
 const waiting=(extra={})=>send({...requests().at(-1),type:'navigation-result',status:'waiting',...extra});
 return{rail,state,publish,start,requests,waiting,send,cancelled,notice:internals.notice as Element,resume:internals.resume as Element,cancel:internals.cancel as Element};
}
it.each([true,false])('exposes explicit recovery at the automatic wait limit (reading=%s)',reading=>{
 const f=fixture();f.start(reading);for(let i=0;i<25;i++)f.waiting();
 expect(f.requests()).toHaveLength(25);expect(f.notice.hidden).toBe(false);expect(f.resume.hidden).toBe(false);expect(f.cancel.hidden).toBe(false);
 vi.advanceTimersByTime(60000);expect(f.requests()).toHaveLength(25);
});
it('exposes recovery when the final wait arrives during loading and a later state releases it',()=>{
 const f=fixture();f.start();for(let i=0;i<24;i++)f.waiting();f.state.history.loading=true;f.publish();f.waiting();
 f.state.history.loading=false;f.publish();expect(f.requests()).toHaveLength(25);expect(f.notice.hidden).toBe(false);expect(f.resume.hidden).toBe(false);
});
it('keeps explicit continuation bounded and cancel ignores late receipts',()=>{
 const f=fixture();f.start();for(let i=0;i<25;i++)f.waiting();f.resume.click();expect(f.requests()).toHaveLength(26);f.waiting();
 expect(f.notice.hidden).toBe(false);expect(f.resume.hidden).toBe(false);f.cancel.click();f.waiting();f.publish();vi.advanceTimersByTime(60000);
 expect(f.cancelled).toHaveBeenCalledOnce();expect(f.notice.hidden).toBe(true);expect(f.requests()).toHaveLength(26);
});
it('ignores foreign and superseded wait acknowledgements without consuming the current deadline',()=>{
 const f=fixture();f.start();const old={...f.requests().at(-1)};f.waiting();
 for(const extra of[{id:old.id},{threadId:'other'},{connectionId:2}])f.waiting(extra);
 expect(f.requests()).toHaveLength(2);expect(f.notice.hidden).toBe(true);vi.advanceTimersByTime(30000);
 expect(f.notice.hidden).toBe(false);expect(f.resume.hidden).toBe(false);
});
it('restores the explicit recovery controls when a manual continuation times out',()=>{
 const f=fixture();f.start();for(let i=0;i<25;i++)f.waiting();f.resume.click();
 expect(f.resume.hidden).toBe(true);vi.advanceTimersByTime(30000);
 expect(f.notice.hidden).toBe(false);expect(f.resume.hidden).toBe(false);expect(f.requests()).toHaveLength(26);
});
