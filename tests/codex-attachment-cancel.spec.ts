import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {AttachmentPreparations} from '../src/codex-prototype/attachment-preparations';
import {AttachmentStorage} from '../src/codex-prototype/attachment-storage';
import {handleAttachmentImport,type importAttachment} from '../src/codex-prototype/attachment-files';
import {DraftStore,emptyDraft} from '../src/codex-prototype/draft-store';

function gate(){let release!:()=>void;return{wait:new Promise<void>(resolve=>release=resolve),release:()=>release()};}
const normalizedPath=(path:string)=>process.platform==='win32'?path.toLowerCase():path;
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'codex-prototype-cancel-unit-'));await writeFile(join(root,'.codex-prototype-owned'),'restricted-prototype');
 const values=new Map<string,unknown>(),raw={get:<T>(key:string,fallback:T)=>(values.get(key)??fallback) as T,update:async(key:string,value:unknown)=>{values.set(key,structuredClone(value));}};
 const storage=new AttachmentStorage(raw,root),drafts=new DraftStore(storage.state),leases=new AttachmentPreparations(),owner={threadId:'a',connectionId:1};
 const existing=await storage.import(root,'existing.md',Buffer.from('preserved source').toString('base64'),()=>true);if(existing.kind!=='file')throw Error();
 await drafts.save('a',{...emptyDraft(),text:'preserved draft',files:[existing.file]});await drafts.begin('a','preserved draft','','',[existing.file]);
 return{root,storage,drafts,leases,owner,existing:existing.file};
}
describe('same-owner attachment preparation cancellation with durable source evidence',()=>{
 it.each(['before-write','after-write'] as const)('cancels %s without changing the uncertain draft or an existing referenced file',async stage=>{
  const f=await fixture(),reached=gate(),blocked=gate(),before=f.drafts.read('a'),posts:unknown[]=[];
  const importFile:typeof importAttachment=async(...args)=>{if(stage==='before-write'){reached.release();await blocked.wait;}const value=await f.storage.import(...args);if(stage==='after-write'){reached.release();await blocked.wait;}return value;};
  const pending=f.leases.run(f.owner,active=>handleAttachmentImport(f.root,{type:'attachment-import',id:1,...f.owner,name:'pending.md',base64:Buffer.from('cancel this import').toString('base64')},()=>f.owner,active,value=>{posts.push(value);return true;},importFile));
  await reached.wait;f.leases.cancel(f.owner);blocked.release();await pending;
  expect(posts).toEqual([]);expect(f.drafts.read('a')).toEqual(before);expect(await readFile(f.existing.path,'utf8')).toBe('preserved source');
  const snapshot=await f.storage.snapshot();expect(snapshot.imports).toHaveLength(1);expect(snapshot.protectedPaths).toEqual([normalizedPath(f.existing.path)]);
  const next=await f.leases.run(f.owner,active=>f.storage.import(f.root,'next.md',Buffer.from('next deliberate import').toString('base64'),active));expect(next.kind).toBe('file');
 });
 it('keeps delivered bytes and durable references when cancellation races an unknown delivery acknowledgement',async()=>{
  const f=await fixture(),reached=gate(),blocked=gate();let deliveredPath='';
  const pending=f.leases.run(f.owner,active=>handleAttachmentImport(f.root,{type:'attachment-import',id:1,...f.owner,name:'delivered.md',base64:Buffer.from('delivered source').toString('base64')},()=>f.owner,active,async result=>{deliveredPath=result.file.path;const {uncertain:_uncertain,pendingEditId:_pending,recovery:_recovery,...current}=f.drafts.read('a');await f.drafts.save('a',{...current,files:[f.existing,result.file]});reached.release();await blocked.wait;throw Error('Acknowledgement lost after the page saved its reference');},f.storage.import));
  await Promise.race([reached.wait,pending.then(()=>{throw Error('Import ended before delivering the saved reference');})]);f.leases.cancel(f.owner);blocked.release();await pending;await f.storage.collect();
  expect(await readFile(deliveredPath,'utf8')).toBe('delivered source');expect(await readFile(f.existing.path,'utf8')).toBe('preserved source');expect(f.drafts.read('a')).toMatchObject({text:'preserved draft',uncertain:true});expect(f.drafts.read('a').files).toHaveLength(2);expect((await f.storage.snapshot()).protectedPaths.sort()).toEqual([f.existing.path,deliveredPath].map(normalizedPath).sort());
 });
 it('cancels active and queued preparations for one owner while another thread and the next explicit import remain usable',async()=>{
  const f=await fixture(),blocked=gate(),other={threadId:'b',connectionId:1},entered=gate();let count=0;
  const work=(owner:typeof f.owner,name:string)=>f.leases.run(owner,async active=>{if(++count===3)entered.release();await blocked.wait;return f.storage.import(f.root,name,Buffer.from(name).toString('base64'),active);});
  const first=work(f.owner,'cancel-a.md'),second=work(f.owner,'cancel-b.md'),foreign=work(other,'other.md');
  // Attach handlers before cancellation so rejected operations are never unhandled.
  const settled=Promise.allSettled([first,second,foreign]);await entered.wait;f.leases.cancel(f.owner);blocked.release();const results=await settled;
  expect(results.map(value=>value.status)).toEqual(['rejected','rejected','fulfilled']);expect((await f.storage.snapshot()).imports).toHaveLength(2);expect(f.drafts.read('a').uncertain).toBe(true);
  const next=await work(f.owner,'next.md');expect(next.kind).toBe('file');
 });
});
