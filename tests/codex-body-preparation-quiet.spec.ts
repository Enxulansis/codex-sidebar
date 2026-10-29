import{afterEach,expect,it,vi}from'vitest';
import{BodyWindowPrototype}from'../src/codex-prototype/display/body-window-prototype';
import{QUIET_PROGRESS_DELAY_MS}from'../src/codex-prototype/display/progress-delay';
afterEach(()=>vi.useRealTimers());
function fixture(mode='daily'){
 const body:any=Object.create(BodyWindowPrototype.prototype);
 Object.assign(body,{state:{dispatchMode:mode},valid:new Set(),groups:[{id:'unit'}],running:true,settledGeneration:-1,generation:1,paused:false,error:'',progressStarted:undefined,progressTimer:undefined,status:{hidden:false,style:{display:'flex'},title:''},label:{textContent:''},cancel:{hidden:false},resume:{hidden:true}});
 return body;
}
it('keeps routine daily resize preparation hidden beyond the old delay without a progress timer',async()=>{
 vi.useFakeTimers();const body=fixture();body.phase='resizing';body.showProgress();await vi.advanceTimersByTimeAsync(QUIET_PROGRESS_DELAY_MS*3);body.showProgress();
 expect(body.status.hidden).toBe(true);expect(body.status.style.display).toBe('none');expect(body.progressTimer).toBeUndefined();expect(body.running).toBe(true);expect(body.valid.size).toBe(0);
});
it('cancels an earlier experiment progress timer when the same component enters daily mode',async()=>{
 vi.useFakeTimers();const body=fixture('experiment');body.showProgress();expect(body.progressTimer).toBeDefined();body.state.dispatchMode='daily';body.showProgress();await vi.advanceTimersByTimeAsync(QUIET_PROGRESS_DELAY_MS*2);expect(body.status.hidden).toBe(true);expect(body.progressTimer).toBeUndefined();
});
it('shows an actual daily calibration error and recovery control immediately, then quiets the retry',()=>{
 const body=fixture();body.error='真实测量失败';body.running=false;body.showProgress();expect(body.status.hidden).toBe(false);expect(body.label.textContent).toContain('真实测量失败');expect(body.cancel.hidden).toBe(true);expect(body.resume.hidden).toBe(false);
 body.error='';body.running=true;body.showProgress();expect(body.status.hidden).toBe(true);
});
it('preserves a manually paused operation and the experimental delayed progress controls',async()=>{
 vi.useFakeTimers();const paused=fixture();paused.paused=true;paused.running=false;paused.showProgress();expect(paused.status.hidden).toBe(false);expect(paused.resume.hidden).toBe(false);
 const body=fixture('experiment');body.showProgress();expect(body.status.hidden).toBe(true);await vi.advanceTimersByTimeAsync(QUIET_PROGRESS_DELAY_MS);expect(body.status.hidden).toBe(false);expect(body.cancel.hidden).toBe(false);body.valid.add('unit');body.running=false;body.settledGeneration=body.generation;body.showProgress();expect(body.status.hidden).toBe(true);
});
