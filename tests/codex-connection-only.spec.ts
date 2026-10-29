import {afterEach,describe,expect,it} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {connectionOnlyStore,CONNECTION_ONLY_REASON} from '../src/codex-prototype/session-access';
import {Rpc,RpcRequestRejected} from '../src/codex-prototype/rpc';
import {Session} from '../src/codex-prototype/session';

const live:Rpc[]=[];
afterEach(async()=>{for(const rpc of live.splice(0))await rpc.dispose();});
function pipe(){
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:123,exitCode:null as number|null,kill(){this.exitCode=0;this.emit('exit',0);return true;}});
 const requests:any[]=[];child.stdin.on('data',bytes=>requests.push(JSON.parse(String(bytes))));
 const rpc=new Rpc(child as unknown as ChildProcessWithoutNullStreams,1000,false);live.push(rpc);return{rpc,child,requests};
}
describe('ordinary restricted connection without dispatch authority',()=>{
 it('has no ledger or imported thread ownership and cannot acquire either through mutation',()=>{
  const store=connectionOnlyStore(),before=store.read();expect(before).toEqual({attempts:[],threads:[]});
  before.threads.push('foreign');expect(store.read().threads).toEqual([]);expect(store.hasAttempts('foreign')).toBe(false);
  expect(store.dispatchReason()).toBe(CONNECTION_ONLY_REASON);
  for(const operation of [()=>store.reserve('foreign','text'),()=>store.record('foreign',{}),()=>store.own('foreign'),()=>store.select('foreign'),()=>store.pending({threadId:'foreign',turnId:'turn',kind:'command'})])expect(operation).toThrow(CONNECTION_ONLY_REASON);
  expect(store.read()).toEqual({attempts:[],threads:[]});
 });
 it.each(['turn/start','turn/steer'] as const)('rejects %s before writing even one request to the backend',async method=>{
  const {rpc,requests}=pipe();await expect(rpc.request(method,{threadId:'foreign',input:[],expectedTurnId:'turn'} as never)).rejects.toBeInstanceOf(RpcRequestRejected);expect(requests).toEqual([]);
 });
 it('keeps metadata requests and public failures intact without granting dispatch',async()=>{
  const {rpc,child,requests}=pipe(),account=rpc.request('account/read',{refreshToken:false});expect(requests).toEqual([{id:1,method:'account/read',params:{refreshToken:false}}]);
  child.stdout.write(JSON.stringify({id:1,result:{account:{type:'chatgpt'},requiresOpenaiAuth:true}})+'\n');await expect(account).resolves.toMatchObject({account:{type:'chatgpt'}});
  const models=rpc.request('model/list',{});child.stdout.write(JSON.stringify({id:2,error:{code:-32603,message:'catalog unavailable'}})+'\n');await expect(models).rejects.toThrow('catalog unavailable');expect(requests.map(r=>r.method)).toEqual(['account/read','model/list']);
 });
 it('blocks real Session send, steer and foreign restore before transport, without resetting any allowance',async()=>{
  const {rpc,requests}=pipe(),session=new Session(rpc,'ordinary-workspace',connectionOnlyStore());
  await expect(session.send('synthetic text')).rejects.toThrow(CONNECTION_ONLY_REASON);
  await expect(session.steer('synthetic text')).rejects.toThrow(CONNECTION_ONLY_REASON);
  await expect(session.restore('foreign-thread')).rejects.toThrow('非本任务');expect(requests).toEqual([]);expect(session.projection.threadId).toBe('');
 });
});
