import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {createVsCodePageHost} from '../src/codex-prototype/vscode-page-host';
import {MessageCopyBridge} from '../src/codex-prototype/display/message-copy-bridge';
import {codexPageContent} from '../src/codex-prototype/codex-page-state';
import {Projection} from '../src/codex-prototype/state';
import type {Session} from '../src/codex-prototype/session';

afterEach(()=>vi.unstubAllGlobals());
const emit=(target:EventTarget,data:unknown)=>target.dispatchEvent(new MessageEvent('message',{data}));
describe('page transport boundary',()=>{
 it('acquires VS Code once and preserves message data, ordering and unsubscribe',()=>{
  const win=new EventTarget(),postMessage=vi.fn(),acquire=vi.fn(()=>({postMessage}));
  vi.stubGlobal('window',win);vi.stubGlobal('acquireVsCodeApi',acquire);
  const host=createVsCodePageHost(),seen:unknown[]=[],receive=(e:MessageEvent)=>seen.push(e.data);
  host.messages.addEventListener('message',receive);
  const request={type:'send',viewId:'v',requestId:4,threadId:'t',connectionId:2,text:'原文'};
  host.postMessage(request);const pageId=postMessage.mock.calls[0]![0].pageId;emit(win,{type:'state',pageId});emit(win,{type:'sent',pageId});
  expect(acquire).toHaveBeenCalledTimes(1);expect(postMessage).toHaveBeenCalledExactlyOnceWith({...request,pageId});
  expect(seen).toEqual([{type:'state',pageId},{type:'sent',pageId}]);
  host.messages.removeEventListener('message',receive);emit(win,{type:'state'});expect(seen).toHaveLength(2);
 });
 it('isolates receipts even when two documents reuse request and owner identities',()=>{
  const win=new EventTarget(),postMessage=vi.fn();vi.stubGlobal('window',win);vi.stubGlobal('acquireVsCodeApi',()=>({postMessage}));
  const first=createVsCodePageHost(),second=createVsCodePageHost(),seen=vi.fn();
  first.postMessage({type:'ready'});second.postMessage({type:'ready'});second.messages.addEventListener('message',seen);
  const oldId=postMessage.mock.calls[0]![0].pageId,newId=postMessage.mock.calls[1]![0].pageId;
  expect(newId).not.toBe(oldId);const receipt={type:'display-copied',id:1,threadId:'a',connectionId:1,ok:true};
  emit(win,{...receipt,pageId:oldId});emit(win,receipt);expect(seen).not.toHaveBeenCalled();
  emit(win,{...receipt,pageId:newId});expect(seen).toHaveBeenCalledOnce();
  win.dispatchEvent(new Event('pagehide'));emit(win,{...receipt,pageId:newId});expect(seen).toHaveBeenCalledOnce();
 });
 it('persists only one synthetic serializer marker and never serializes actual history or drafts',()=>{
  const win=new EventTarget(),postMessage=vi.fn(),setState=vi.fn();vi.stubGlobal('window',win);vi.stubGlobal('acquireVsCodeApi',()=>({postMessage,setState}));const host=createVsCodePageHost();host.messages.addEventListener('message',()=>{});host.messages.addEventListener('message',()=>{});host.postMessage({type:'ready'});const pageId=postMessage.mock.calls[0]![0].pageId;
  emit(win,{type:'state',pageId,state:{threadId:'real',items:['private']}});emit(win,{type:'state',pageId:'old',state:{offlinePreview:true}});expect(setState).not.toHaveBeenCalled();
  emit(win,{type:'state',pageId,state:{offlinePreview:true,items:['synthetic'],draft:'unsent'}});emit(win,{type:'state',pageId,state:{offlinePreview:true}});expect(setState).toHaveBeenCalledExactlyOnceWith({offlineExperience:true});
 });
 it('uses only the injected channel, rejects stale owners, and removes subscriptions on pagehide',async()=>{
  const win=new EventTarget(),channel=new EventTarget(),postMessage=vi.fn(),remove=vi.spyOn(channel,'removeEventListener');
  vi.stubGlobal('window',win);let owner={threadId:'a',connectionId:1};
  const bridge=new MessageCopyBridge({postMessage,messages:channel},()=>owner);
  let done=false;const pending=bridge.copy('turn','item').then(()=>{done=true;});
  const receipt={type:'message-copied',id:1,threadId:'a',connectionId:1,turnId:'turn',itemId:'item',ok:true};
  emit(win,receipt);await Promise.resolve();expect(done).toBe(false);
  emit(channel,receipt);await pending;expect(done).toBe(true);
  const stale=bridge.copy('turn','item'),rejected=expect(stale).rejects.toThrow('身份');
  owner={threadId:'b',connectionId:2};emit(channel,{...receipt,id:2});await rejected;
  const closing=bridge.copy('turn','item'),closed=expect(closing).rejects.toThrow('身份');
  win.dispatchEvent(new Event('pagehide'));await closed;expect(remove).toHaveBeenCalledOnce();
 });
 it('keeps the browser runtime free of Codex projection/RPC and confines VS Code acquisition to the wrapper',()=>{
  const bundle=buildSync({entryPoints:['src/codex-prototype/display/browser-entry.ts'],bundle:true,platform:'browser',write:false,metafile:true});
  expect(Object.keys(bundle.metafile!.inputs).filter(p=>/codex-prototype\/(protocol\/|rpc\.ts|session\.ts|state\.ts|turn-display-metrics\.ts|codex-page-state\.ts)/.test(p))).toEqual([]);
  const page=readFileSync('src/codex-prototype/page-entry.ts','utf8');
  expect(page).not.toMatch(/acquireVsCodeApi|window\.(?:add|remove)EventListener\('message'|protocol\//);
  for(const path of Object.keys(bundle.metafile!.inputs).filter(p=>/codex-prototype\/display\/.*\.ts$/.test(p)))expect(readFileSync(path,'utf8'),path).not.toMatch(/window\.(?:add|remove)EventListener\('message'|acquireVsCodeApi|from ['"][^'"]*protocol\//);
 });
});

function fixture(items:unknown[],status='completed'){
 const projection=new Projection();
 projection.snapshot({id:'thread',turns:[{id:'turn',status,items,itemsView:'full',startedAt:100,completedAt:102,durationMs:2000,error:null}]} as never);
 const approvals=new Map([[9,{id:9,method:'item/fileChange/requestApproval',callbackToken:'callback',params:{itemId:'file',threadId:'thread',turnId:'turn',reason:'保留审批原文',grantRoot:null}}]]);
 return {projection,approvals,revertReason:()=> 'fixture does not expose revert',forkReason:()=>undefined,approvalAcceptance:async()=>({allowed:false,reason:'fixture acceptance scope unavailable'})} as unknown as Session;
}
describe('Codex display adapter',()=>{
 it('preserves mapped public data and unknown identity while excluding unverified payload, reasoning and execution-only fields',async()=>{
  const raw={type:'futurePublicItem',id:'raw',nested:{literal:'<script>不执行</script>'}};
  const active=fixture([
   {type:'reasoning',id:'hidden',summary:['hidden'],content:['hidden']},
   {type:'agentMessage',id:'answer',text:'完整正文',phase:'partial_answer',memoryCitation:{entries:[]}},
   {type:'userMessage',id:'user',content:[{type:'text',text:'原文',text_elements:[]},{type:'image',url:'https://unloaded.invalid'},{type:'localImage',path:'owned.png',detail:'original'},{type:'skill',name:'ignore',path:'not-loaded'}]},
   {type:'commandExecution',id:'cmd',command:'echo literal',cwd:'workspace',status:'failed',aggregatedOutput:'全部输出',exitCode:1,durationMs:25,processId:'private',source:'agent',commandActions:[]},
   {type:'fileChange',id:'file',status:'completed',changes:[{path:'a.txt',kind:{type:'update',move_path:null},diff:'-a\n+b'}]},
   {type:'plan',id:'plan',text:'公开计划'},raw
  ]);
  const before=JSON.stringify([...active.projection.items.values()]),check=vi.fn(async(path,id)=>({id,name:path,src:'data:image/png;base64,AA=='}));
  const result=await codexPageContent(active,'thread',check);
  expect(result.items.map(r=>r.item.id)).toEqual(['answer','user','cmd','file','plan','raw']);
  expect(result.items[0]!.item).toEqual({type:'agentMessage',id:'answer',text:'完整正文',phase:'partial_answer'});
  expect(result.items[1]!.item).toEqual({type:'userMessage',id:'user',content:[{type:'text',text:'原文'},{type:'image'},{type:'localImage',path:'owned.png',displayImage:{id:'["thread","turn","user",2]',name:'owned.png',src:'data:image/png;base64,AA=='}},{type:'skill'}]});
  expect(check).toHaveBeenCalledExactlyOnceWith('owned.png','["thread","turn","user",2]');
  expect(result.items[2]!.item).toEqual({type:'commandExecution',id:'cmd',command:'echo literal',cwd:'workspace',status:'failed',aggregatedOutput:'全部输出',exitCode:1,durationMs:25});
  expect(result.items[3]!.item).toEqual(active.projection.items.get('file')!.item);
  expect(result.items.at(-1)!.item).toMatchObject({type:'unavailableRecord',id:'raw',title:'未适配记录 · futurePublicItem',searchSources:[]});
  expect(JSON.stringify(result)).not.toContain('<script>不执行</script>');
  expect(result.approvals).toEqual([{id:9,callbackToken:'callback',params:active.approvals.get(9)!.params,acceptance:{allowed:false,reason:'fixture acceptance scope unavailable'}}]);
  expect(result.turns).toEqual([{id:'turn',status:'completed',itemsView:'full',durationMs:2000,errorMessage:''}]);
  expect(JSON.stringify([...active.projection.items.values()])).toBe(before);
 });
 it('retains stream completion, phases, usage provenance and incomplete/order flags',async()=>{
  const active=fixture([{type:'agentMessage',id:'a',text:'首段',phase:'commentary'}],'inProgress');
  const totals={totalTokens:12,inputTokens:5,cachedInputTokens:1,cacheWriteInputTokens:0,outputTokens:7,reasoningOutputTokens:2};
  active.projection.apply({method:'thread/tokenUsage/updated',params:{threadId:'thread',turnId:'turn',tokenUsage:{total:totals,last:totals,modelContextWindow:null}}} as never);
  active.projection.apply({method:'item/completed',params:{threadId:'thread',turnId:'turn',item:{type:'contextCompaction',id:'compact'}}} as never);
  active.projection.metrics.disconnect();
  const content=await codexPageContent(active,'thread',vi.fn());
  expect(content.items[0]).toMatchObject({turnId:'turn',complete:false,item:{text:'首段',phase:'commentary'},displayMeta:{source:'public',timeSource:'server-turn',durationSource:'server-turn',durationMs:2000,incomplete:true,usageOrderUnknown:true,tokenUsage:{total:totals,last:totals,modelContextWindow:null}}});
  expect(content.items[0]!.displayMeta?.averageOutputTokS).toBeUndefined();
 });
 it('captures the original image owner while the projection changes during a resource check',async()=>{
  const active=fixture([{type:'userMessage',id:'image',content:[{type:'localImage',path:'old.png'}]}]);
  let finish!:(value:any)=>void;const check=vi.fn(()=>new Promise<any>(resolve=>finish=resolve));
  const pending=codexPageContent(active,'thread',check);active.projection.clear('other');
  finish({id:'["thread","turn","image",0]',name:'old.png',error:'不可用'});
  const content=await pending;expect(content.items[0]).toMatchObject({turnId:'turn',item:{content:[{displayImage:{id:'["thread","turn","image",0]',error:'不可用'}}]}});
 });
 it('renders no session as empty content without reading resources',async()=>{
  const check=vi.fn();expect(await codexPageContent(undefined,'',check)).toEqual({items:[],turns:[],approvals:[],userInputs:[]});expect(check).not.toHaveBeenCalled();
 });
 it('captures live question identity before async resource checks without retaining mutable request objects',async()=>{
  const active=fixture([{type:'userMessage',id:'image',content:[{type:'localImage',path:'old.png'}]}])as any;
  const request={id:0,callbackToken:'exact-token',status:'pending',params:{threadId:'thread',turnId:'turn',itemId:'question',questions:[{id:'q',header:'Q',question:'Original',isOther:false,isSecret:true,options:null}],isBlocking:true,autoResolutionMs:null}};active.userInputs=new Map([[0,request]]);
  let finish!:(value:any)=>void;const pending=codexPageContent(active,'thread',()=>new Promise(resolve=>finish=resolve));request.status='submitted';request.params.questions[0]!.question='Replacement';active.userInputs.clear();finish({id:'image',error:'fixture'});
  const content=await pending;expect(content.userInputs).toEqual([expect.objectContaining({id:0,callbackToken:'exact-token',status:'pending',params:expect.objectContaining({questions:[expect.objectContaining({question:'Original'})]})})]);
 });
});
