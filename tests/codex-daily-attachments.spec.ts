import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {authorizeWorkspaceFiles,assertOwnedWorkspace,assertWorkspaceFiles} from '../src/codex-prototype/storage';
import {DailySessionStore} from '../src/codex-prototype/daily-session-store';
import {AttachmentStorage} from '../src/codex-prototype/attachment-storage';
import {attachmentInputs} from '../src/codex-prototype/attachment-files';
import {DraftStore,emptyDraft} from '../src/codex-prototype/draft-store';
import {AttachmentRetention} from '../src/codex-prototype/attachment-retention';
import {readImageOrigin} from '../src/codex-prototype/image-origin';
import {exportCarriers} from '../src/codex-prototype/export-carriers';

const leases:{dispose():void}[]=[];
afterEach(()=>{for(const lease of leases.splice(0))lease.dispose();});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'sidebar-daily-files-')),root=join(directory,'ordinary-workspace');await mkdir(root);
  const store=new DailySessionStore(join(directory,'extension-state'),root),values=new Map<string,unknown>();
  const state={get:<T>(key:string,fallback:T)=>(values.has(key)?structuredClone(values.get(key)):fallback)as T,update:async(key:string,value:unknown)=>{values.set(key,structuredClone(value));}};
  return{directory,root,store,values,state,manager:new AttachmentStorage(state,root)};
}
async function authorize(f:Awaited<ReturnType<typeof fixture>>){const lease=await authorizeWorkspaceFiles(f.root,()=>f.store.read());leases.push(lease);return lease;}
describe('daily workspace attachments without experimental markers',()=>{
  it('requires an explicit live daily registration and leaves the experimental authority unchanged',async()=>{
    const f=await fixture();await expect(f.manager.import(f.root,'image.png',png,()=>true)).rejects.toThrow('临时工作区');
    const lease=await authorize(f);await expect(assertWorkspaceFiles(f.root)).resolves.toBeUndefined();
    await expect(assertOwnedWorkspace(f.root)).rejects.toThrow('临时工作区');expect(await readdir(f.root)).toEqual([]);
    await expect(authorizeWorkspaceFiles(f.root,()=>f.store.read())).rejects.toThrow('其他实例');
    lease.dispose();await expect(f.manager.import(f.root,'image.png',png,()=>true)).rejects.toThrow('临时工作区');
  });
  it('imports a real image, persists its draft, sends matching localImage bytes and retains the accepted source',async()=>{
    const f=await fixture();await authorize(f);const imported=await f.manager.import(f.root,'image.png',png,()=>true),drafts=new DraftStore(f.manager.state);
    await drafts.save('own-thread',{...emptyDraft(),text:'Describe the picture',image:imported.path!,imageToken:randomUUID()});
    const proof={path:imported.path!,sha256:createHash('sha256').update(Buffer.from(png,'base64')).digest('hex')};
    expect(await attachmentInputs(f.root,'Describe the picture',imported.path,[],[],[proof])).toEqual([{type:'text',text:'Describe the picture',text_elements:[]},{type:'localImage',path:imported.path,detail:'auto'}]);
    await new AttachmentRetention(f.manager.state,f.root).retain('own-thread',[imported.path!]);await drafts.save('own-thread',emptyDraft());
    expect(await f.manager.collect()).toMatchObject({removed:0,referenced:1});expect((await readFile(imported.path!)).equals(Buffer.from(png,'base64'))).toBe(true);
    expect((await f.manager.maintain()).sizeError).toBe('');expect(f.manager.status().exports.error).toBe('');
  });
  it('preserves original-image sidecars and uses the bounded export journal in the selected workspace',async()=>{
    const f=await fixture();await authorize(f);const original=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const image=await f.manager.import(f.root,'converted.png',png,()=>true,{name:'source.svg',base64:original.toString('base64'),transformation:'rasterized'});
    expect((await readImageOrigin(f.root,image.path!))?.bytes).toEqual(original);
    const copies:string[]=[];await exportCarriers(f.root).copy('image','tiny.png',Buffer.from(png,'base64'),async()=>{},async path=>{copies.push(path);});
    expect(copies).toHaveLength(1);expect((await readFile(copies[0]!)).equals(Buffer.from(png,'base64'))).toBe(true);
  });
  it('rejects a changed journal before reading, importing or collecting attachment files',async()=>{
    const f=await fixture();await authorize(f);await writeFile(f.store.path,'corrupt');
    await expect(f.manager.import(f.root,'image.png',png,()=>true)).rejects.toThrow();expect(await readdir(f.root)).toEqual([]);
    await expect(f.manager.collect()).rejects.toThrow();
  });
  it('does not follow an attachment junction into another directory',async()=>{
    const f=await fixture();await authorize(f);const outside=join(f.directory,'outside');await mkdir(outside);await writeFile(join(outside,'canary.txt'),'keep');
    await symlink(outside,join(f.root,'.codex-attachments'),'junction');await expect(f.manager.import(f.root,'image.png',png,()=>true)).rejects.toThrow('链接');
    expect(await readdir(outside)).toEqual(['canary.txt']);expect(await readFile(join(outside,'canary.txt'),'utf8')).toBe('keep');
  });
  it('rejects replacing the registered root instead of accepting another directory with the same name',async()=>{
    const f=await fixture();await authorize(f);await rename(f.root,f.root+'-original');await mkdir(f.root);
    await expect(assertWorkspaceFiles(f.root)).rejects.toThrow('身份已改变');expect(await readdir(f.root)).toEqual([]);
  });
});
