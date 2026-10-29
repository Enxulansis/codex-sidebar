import {describe,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {Rpc,RpcRequestRejected} from '../src/codex-prototype/rpc';

function fixture(allowModelDispatch=true){
 const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),stdin:new PassThrough(),exitCode:null as number|null,signalCode:null as NodeJS.Signals|null,kill:vi.fn(()=>true)});
 child.kill.mockImplementation(()=>{child.exitCode=0;child.emit('exit',0);return true;});
 return{child,rpc:new Rpc(child as never,1000,allowModelDispatch)};
}
describe('owned RPC fails closed but always completes disconnect cleanup',()=>{
 it('connection-only transport blocks manual compaction before writing anything to its child',async()=>{
  const {child,rpc}=fixture(false),write=vi.spyOn(child.stdin,'write');
  try{await expect(rpc.request('thread/compact/start',{threadId:'synthetic'})).rejects.toBeInstanceOf(RpcRequestRejected);expect(write).not.toHaveBeenCalled();}finally{await rpc.dispose();}
 });
 it('preserves once and listener snapshots while clearing all pending request timers',async()=>{
  vi.useFakeTimers();const {child,rpc}=fixture(),later=vi.fn(),added=vi.fn(),once=vi.fn(()=>{rpc.off('disconnect',later);rpc.on('disconnect',added);throw Error('observer failed');});rpc.once('disconnect',once);rpc.on('disconnect',later);
  const first=rpc.request('thread/read',{threadId:'a'}).catch(e=>e),second=rpc.request('thread/read',{threadId:'b'}).catch(e=>e);
  try{expect(vi.getTimerCount()).toBe(2);await rpc.dispose();expect(await first).toBeInstanceOf(Error);expect(await second).toBeInstanceOf(Error);expect(vi.getTimerCount()).toBe(0);expect(once).toHaveBeenCalledOnce();expect(later).toHaveBeenCalledOnce();expect(added).not.toHaveBeenCalled();expect(rpc.listeners('disconnect')).toEqual([added]);await rpc.dispose();expect(once).toHaveBeenCalledOnce();expect(child.kill).toHaveBeenCalledOnce();}
  finally{await rpc.dispose();vi.useRealTimers();}
 });
 it.each(['write-throw','stdin-error'])('terminates the owned child on %s',async trigger=>{
  const {child,rpc}=fixture();if(trigger==='write-throw')vi.spyOn(child.stdin,'write').mockImplementation(()=>{throw Error('write failed');});
  const result=rpc.request('thread/read',{threadId:'owned'}).catch(e=>e);if(trigger==='stdin-error')child.stdin.emit('error',Error('write failed'));
  try{expect((await result).message).toBe('write failed');expect(child.kill).toHaveBeenCalledOnce();}finally{await rpc.dispose();}
 });
 it('does not wait for a second exit after its child has already exited by signal',async()=>{
  vi.useFakeTimers();const {child,rpc}=fixture();child.signalCode='SIGTERM';child.kill.mockImplementation(()=>false);let finished=false;const disposing=rpc.dispose().then(()=>{finished=true;});
  try{await Promise.resolve();expect(finished).toBe(true);expect(child.kill).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);}
  finally{await vi.runAllTimersAsync();await disposing;vi.useRealTimers();}
 });
 it.each([null,false,0,'',{message:'missing code'},{code:-1}, {code:-1,message:'error',both:true}])('malformed error response %j cannot resolve a request as success or definite rejection',async value=>{
  const {child,rpc}=fixture(),result=rpc.request('thread/read',{threadId:'owned'}).catch(e=>e);
  try{child.stdout.write(JSON.stringify({id:1,error:value,...(value&&typeof value==='object'&&'both' in value?{result:{}}:{})})+'\n');const error=await result;expect(error).toBeInstanceOf(Error);expect(error).not.toBeInstanceOf(RpcRequestRejected);expect(child.kill).toHaveBeenCalledOnce();}finally{await rpc.dispose();}
 });
 it('preserves a definite server rejection without disconnecting a healthy transport',async()=>{
  const {child,rpc}=fixture(),result=rpc.request('thread/read',{threadId:'owned'}).catch(e=>e);
  try{child.stdout.write(JSON.stringify({id:1,error:{code:-32602,message:'rejected'}})+'\n');expect(await result).toBeInstanceOf(RpcRequestRejected);expect(child.kill).not.toHaveBeenCalled();const next=rpc.request('thread/read',{threadId:'owned'});child.stdout.write(JSON.stringify({id:2,result:{ok:true}})+'\n');await expect(next).resolves.toEqual({ok:true});}finally{await rpc.dispose();}
 });
 it('terminates its actual local Node child after consumer and disconnect-observer failures',async()=>{
  const code="process.stdin.once('data',()=>process.stdout.write(JSON.stringify({method:'thread/started',params:{}})+'\\n'));setInterval(()=>{},1000);";
  const child=spawn(process.execPath,['-e',code],{stdio:'pipe',windowsHide:true}),rpc=new Rpc(child,1000),later=vi.fn();
  rpc.on('notification',()=>{throw Error('projection rejected');});rpc.on('disconnect',()=>{throw Error('secondary observer failure');});rpc.on('disconnect',later);
  let timer:ReturnType<typeof setTimeout>|undefined;const exited=new Promise<void>((resolve,reject)=>{child.once('exit',()=>resolve());timer=setTimeout(()=>reject(Error('owned test child did not exit')),2000);});
  try{await expect(rpc.request('thread/read',{threadId:'synthetic'})).rejects.toThrow('projection rejected');await exited;expect(later).toHaveBeenCalledOnce();expect(child.exitCode!==null||child.signalCode!==null).toBe(true);}
  finally{clearTimeout(timer);await rpc.dispose();}
 });
 it('rejects a request on an already closed connection without leaving a pending timer',async()=>{
  const {child,rpc}=fixture();await rpc.dispose();let result:unknown;
  void rpc.request('thread/read',{threadId:'owned'}).catch(error=>{result=error;});await Promise.resolve();
  expect(result).toBeInstanceOf(Error);expect(String(result)).toContain('已关闭');expect(child.kill).toHaveBeenCalledOnce();
 });
 it.each(['notification','request'] as const)('does not silently continue after a %s consumer failed to apply state',async event=>{
  const {child,rpc}=fixture(),later=vi.fn(),disconnected=vi.fn();rpc.on(event,()=>{throw Error('projection rejected');});rpc.on(event,later);rpc.on('disconnect',disconnected);
  const result=rpc.request('thread/read',{threadId:'owned'}).catch(e=>e);
  try{child.stdout.write(JSON.stringify({...(event==='request'?{id:'server-request'}:{}),method:'thread/started',params:{}})+'\n');expect((await result).message).toBe('projection rejected');expect(disconnected).toHaveBeenCalledOnce();expect(later).not.toHaveBeenCalled();expect(child.kill).toHaveBeenCalledOnce();}
  finally{await rpc.dispose();}
 });
 it.each(['invalid-envelope','consumer-error','dispose'])('a throwing disconnect observer cannot prevent later cleanup or child termination (%s)',async trigger=>{
  const {child,rpc}=fixture(),later=vi.fn();rpc.on('disconnect',()=>{throw Error('secondary observer failure');});rpc.on('disconnect',later);
  if(trigger==='consumer-error')rpc.on('notification',()=>{throw Error('projection rejected');});
  const result=rpc.request('thread/read',{threadId:'owned'}).catch(e=>e);
  try{
   if(trigger==='dispose')await expect(rpc.dispose()).resolves.toBeUndefined();
   else expect(()=>child.stdout.write(trigger==='invalid-envelope'?'bad-json\n':JSON.stringify({method:'thread/started',params:{}})+'\n')).not.toThrow();
   const failure=await result;expect(failure).toBeInstanceOf(Error);expect(failure.message).not.toContain('secondary observer');expect(later).toHaveBeenCalledOnce();expect(later.mock.calls[0][0]).toBe(failure);expect(child.kill).toHaveBeenCalledOnce();
   await expect(rpc.request('thread/read',{threadId:'owned'})).rejects.toThrow('已关闭');
  }finally{await rpc.dispose();}
 });
});
