import {describe,it,expect} from 'vitest';import {RailScrollOrigin} from '../src/codex-prototype/display/rail-scroll-origin';
describe('actual rail scroll position and extent identify self echoes and geometry clamps',()=>{
 it('compares against clamped readback rather than an unachievable requested position',()=>{const origin=new RailScrollOrigin();origin.wrote(200,200);expect(origin.classify(200,200)).toBe('self');expect(origin.classify(200,200)).toBe('self');});
 it('a new real position immediately after a write remains input without a time window',()=>{const origin=new RailScrollOrigin();origin.wrote(200,400);expect(origin.classify(180,400)).toBe('input');expect(origin.classify(180,400)).toBe('self');expect(origin.classify(160,400)).toBe('input');});
 it('repeated delayed echoes do not turn a known actual position into new input',()=>{const origin=new RailScrollOrigin();origin.wrote(42,400);for(let i=0;i<100;i++)expect(origin.classify(42,400)).toBe('self');});
 it.each([0,200])('an extent change clamped to boundary %s is geometry rather than a user selection',top=>{const origin=new RailScrollOrigin();origin.wrote(500,900);expect(origin.classify(top,200)).toBe('clamp');expect(origin.classify(top,200)).toBe('self');});
 it('an extent change with a new interior position still preserves real input',()=>{const origin=new RailScrollOrigin();origin.wrote(500,900);expect(origin.classify(120,200)).toBe('input');});
 it('a real movement following a geometry clamp is never swallowed',()=>{const origin=new RailScrollOrigin();origin.wrote(500,900);expect(origin.classify(200,200)).toBe('clamp');expect(origin.classify(170,200)).toBe('input');});
 it('unchanged position during extent growth establishes the new baseline before later input',()=>{const origin=new RailScrollOrigin();origin.wrote(100,400);expect(origin.classify(100,900)).toBe('self');expect(origin.classify(110,900)).toBe('input');});
 it('a new owner write replaces the previous owner baseline',()=>{const origin=new RailScrollOrigin();origin.wrote(500,900);origin.wrote(0,0);expect(origin.classify(0,0)).toBe('self');expect(origin.classify(20,100)).toBe('input');});
});
