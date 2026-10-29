import {it,expect,vi} from 'vitest';
import {TurnRail} from '../src/codex-prototype/display/turn-rail';
import {RailMergeThumb} from '../src/codex-prototype/display/rail-materialization';

// Exercise the public restore/input/capture boundary with zero geometry. The
// real DOM/lifecycle wiring is covered by the isolated production-page host.
function controller(){const rail=Object.create(TurnRail.prototype) as TurnRail;Object.assign(rail,{state:{threadId:'a',connectionId:1},history:{dispatchEvent:vi.fn()},clip:{clientHeight:0,scrollTop:0},rail:{hidden:true},tip:{hidden:true},tipMutedUntil:0,layoutIds:[],layout:{y:[]},columnTween:{cancel:vi.fn()},thumbMotion:new RailMergeThumb(()=>{},()=>0),resizeFreeze:{release:vi.fn()},schedule:vi.fn(),holdReveal:vi.fn()});return rail;}
const owner={threadId:'a',connectionId:1},saved={scrollTop:500,anchor:{turnId:'missing',offset:8}};
it('body input cancels an unmeasurable pending anchor and its cached fallback before new nodes arrive',()=>{const rail=controller();expect(rail.restoreViewport(saved,owner,true)).toBe(true);expect(rail.viewport(owner)).toEqual(saved);rail.bodyInput(owner);expect(rail.manual(owner)).toBe(false);expect(rail.viewport(owner)).toBeUndefined();Object.assign(rail,{clip:{clientHeight:300,scrollTop:25},rail:{hidden:false},layoutIds:['current'],layout:{y:[12]}});expect(rail.viewport(owner)).toEqual({scrollTop:25,anchor:{turnId:'current',offset:13}});});
it('an outgoing owner cannot clear the saved current viewport or change its mode',()=>{const rail=controller();rail.restoreViewport(saved,owner,true);rail.bodyInput({threadId:'b',connectionId:2});expect(rail.manual(owner)).toBe(true);expect(rail.viewport(owner)).toEqual(saved);});
it('search centering keeps the located turn but cannot revive a target cancelled by user input',()=>{
 const rail=controller() as any,target={...owner,turnId:'turn-15',top:100,extent:1000};Object.assign(rail.history,{scrollTop:100,scrollHeight:1500,clientHeight:500});rail.sticky=target;
 rail.preserveLocatedTarget(()=>{rail.history.scrollTop=250;});expect(rail.sticky).toBe(target);expect(target.top).toBe(250);
 rail.preserveLocatedTarget(()=>{rail.bodyInput(owner);rail.history.scrollTop=300;});expect(rail.sticky).toBeUndefined();
 rail.sticky={...target,threadId:'old'};rail.preserveLocatedTarget(()=>{rail.history.scrollTop=400;});expect(rail.sticky.top).toBe(250);
});
it('legacy missing mode conservatively preserves exact manual geometry while explicit false is ordinary',()=>{const rail=controller();rail.restoreViewport(saved,owner);expect(rail.manual(owner)).toBe(true);rail.restoreViewport(saved,owner,false);expect(rail.manual(owner)).toBe(false);expect(rail.viewport(owner)).toEqual(saved);});
