import {describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

// Execute the production Webview admission callback without activating VS Code,
// native helpers, a backend or a model. The receiver models a held Session operation.
function fixture(){
 const source=readFileSync('src/codex-prototype/extension.ts','utf8'),file=ts.createSourceFile('extension.ts',source,ts.ScriptTarget.Latest,true);let listener:ts.Expression|undefined;
 function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='onDidReceiveMessage')listener=node.arguments[0];ts.forEachChild(node,visit);}visit(file);if(!listener)throw Error('Missing production webview message admission');
 let callback:(message:any)=>Promise<unknown>,busy=false,selected='',release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),events:string[]=[];
 const receive=vi.fn(async(message:any)=>{events.push(message.type+':'+(message.threadId??''));if(message.type==='restore'){if(busy)throw Error('先停止当前轮次');busy=true;try{if(message.threadId==='a')await gate;selected=message.threadId;}finally{busy=false;}}});
 const target={},context:any={target,view:target,pageId:'11111111-1111-1111-1111-111111111111',generation:1,sessionActions:Promise.resolve(),sessionActionOwner:'',receive,queueRunner:undefined,session:undefined,replyHost:undefined,bindPage:()=>receive};
 const code=ts.transpileModule('('+listener.getText(file)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;callback=runInNewContext(code,context);
 const send=(threadId:string)=>callback({type:'restore',threadId,pageId:context.pageId}),drain=async()=>{for(let n=0;n<8;n++)await Promise.resolve();};
 return{context,send,callback,release,events,receive,drain,selected:()=>selected};
}
describe('sidebar session actions preserve order across asynchronous host publication',()=>{
 it('accepts a second tab selection before the first restore publishes its lock and eventually selects it',async()=>{
  const f=fixture(),first=f.send('a');await f.drain();const second=f.send('b').catch(error=>error);await f.drain();expect(f.events).toEqual(['restore:a']);f.release();await first;expect(await second).not.toBeInstanceOf(Error);expect(f.selected()).toBe('b');expect(f.events).toEqual(['restore:a','restore:b']);
 });
 it('does not block stop, draft saves or cancel messages behind a held restore',async()=>{
  const f=fixture(),first=f.send('a');await f.drain();for(const type of ['stop','draft-save','attachment-cancel'])await f.callback({type,pageId:f.context.pageId});expect(f.events).toEqual(['restore:a','stop:','draft-save:','attachment-cancel:']);f.release();await first;
 });
 it.each(['connection','page','view'])('drops queued work after its %s owner changes',async owner=>{
  const f=fixture(),first=f.send('a');await f.drain();const second=f.send('b').catch(error=>error);await f.drain();if(owner==='connection')f.context.generation++;if(owner==='page')f.context.pageId='22222222-2222-2222-2222-222222222222';if(owner==='view')f.context.view={};f.release();await first;await second;expect(f.events).toEqual(['restore:a']);
 });
 it('continues after a rejected operation without replaying it',async()=>{
  const f=fixture();f.receive.mockRejectedValueOnce(Error('explicit failure'));await expect(f.send('a')).rejects.toThrow('explicit failure');await f.send('b');expect(f.selected()).toBe('b');expect(f.receive).toHaveBeenCalledTimes(2);
 });
 it('does not keep a replacement connection waiting for the retired session',async()=>{
  const f=fixture(),first=f.send('a');await f.drain();const stale=f.send('stale');await f.drain();f.context.generation++;
  const replacement=vi.fn(async()=>{});f.context.receive=replacement;const fresh=f.send('fresh');await f.drain();expect(replacement).toHaveBeenCalledOnce();f.release();await Promise.all([first,stale,fresh]);expect(f.events).toEqual(['restore:a']);
 });
 it('waits for the retained session operation across page reload but skips the outgoing page queue',async()=>{
  const f=fixture(),first=f.send('a');await f.drain();const stale=f.send('stale');f.context.pageId='22222222-2222-2222-2222-222222222222';const fresh=f.send('fresh');await f.drain();expect(f.events).toEqual(['restore:a']);f.release();await Promise.all([first,stale,fresh]);expect(f.events).toEqual(['restore:a','restore:fresh']);expect(f.selected()).toBe('fresh');
 });
});
