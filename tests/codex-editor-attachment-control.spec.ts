import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {EditorAttachmentControl} from '../src/codex-prototype/display/editor-attachment-control';
import type {AttachmentInput} from '../src/codex-prototype/display/attachment-input';
import type {EditorContextView} from '../src/codex-prototype/editor-context-types';
import type {DraftFile} from '../src/codex-prototype/draft-store-types';
import type {PageState} from '../src/codex-prototype/page-model';

// State sequencing only. Native editor/layout coverage is recorded separately.
class Button {
 hidden=false;disabled=false;title='';classList={toggle:vi.fn()};attributes=new Map<string,string>();
 setAttribute(name:string,value:string){this.attributes.set(name,value);}
}
let page:EventTarget;
beforeEach(()=>{page=new EventTarget();vi.stubGlobal('window',page);vi.stubGlobal('document',{createElement:()=>new Button(),querySelector:()=>({append:vi.fn()})});});
afterEach(()=>{page.dispatchEvent(new Event('pagehide'));vi.useRealTimers();vi.unstubAllGlobals();});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const view=(revision:number,version=2,saved=true):EditorContextView=>({revision,enabled:true,saving:false,reason:saved?'saved':'dirty',...(saved?{source:{key:JSON.stringify(['active.ts',version]),path:'active.ts',name:'active.ts',version}}:{})});
const file=(digest:string):DraftFile=>({path:'snapshot-'+digest,name:'active.ts',size:10,sha256:digest.repeat(64),editorSource:'active.ts'});
function fixture(){
 const messages=new EventTarget(),posts:any[]=[],notices:string[]=[];let files:DraftFile[]=[];
 const attachments={showNotice:(text:string)=>notices.push(text),importEditor:(request:()=>Promise<DraftFile>,current:()=>boolean)=>Promise.resolve().then(request).then(value=>{if(!current())throw Error('stale source');files=[value];})};
 const control=new EditorAttachmentControl({messages,postMessage:m=>posts.push(m)},attachments as unknown as AttachmentInput,()=>true,()=>files,value=>{files=value;});
 const emit=(data:object)=>messages.dispatchEvent(new MessageEvent('message',{data:{threadId:'a',connectionId:1,...data}}));
 const show=(editorContext:EditorContextView)=>emit({type:'editor-context-view',editorContext});
 const reply=(id:number,editorContext:EditorContextView,result:object)=>emit({type:'editor-context-result',id,editorContext,...result});
 control.update({threadId:'a',connectionId:1,editorContext:view(5,1)} as PageState);
 return{control,posts,notices,show,reply,files:()=>files};
}
describe('automatic editor attachment eligibility transitions',()=>{
 it('imports the saved revision after a premature same-version attempt was explicitly rejected as dirty',async()=>{
  const f=fixture();await flush();f.reply(f.posts[0].id,view(5,1),{ok:true,file:file('a')});await flush();
  f.show(view(6));await flush();expect(f.posts).toHaveLength(2);
  f.show(view(7,2,false));f.reply(f.posts[1].id,view(7,2,false),{ok:false,error:'活动文件来源已改变或开关未确认'});await flush();
  expect(f.files()).toEqual([file('a')]);
  f.show(view(8));await flush();expect(f.posts).toHaveLength(3);
  f.reply(f.posts[2].id,view(8),{ok:true,file:file('b')});await flush();expect(f.files()).toEqual([file('b')]);
  for(let i=0;i<5;i++)f.show(view(8));await flush();expect(f.posts).toHaveLength(3);
 });
 it('discards a late success from before dirty/save even when the document version is unchanged',async()=>{
  const f=fixture();await flush();f.reply(f.posts[0].id,view(5,1),{ok:true,file:file('a')});await flush();
  f.show(view(6));await flush();f.show(view(7,2,false));f.show(view(8));
  f.reply(f.posts[1].id,view(6),{ok:true,file:file('c')});await flush();
  expect(f.files()).toEqual([file('a')]);expect(f.posts).toHaveLength(3);
  f.reply(f.posts[2].id,view(8),{ok:true,file:file('b')});await flush();expect(f.files()).toEqual([file('b')]);
 });
 it('does not retry the same rejected eligibility or an unknown timed-out delivery',async()=>{
  vi.useFakeTimers();const f=fixture();await flush();f.reply(f.posts[0].id,view(5,1),{ok:false,error:'explicit rejection'});await flush();
  for(let i=0;i<5;i++)f.show(view(5,1));await flush();expect(f.posts).toHaveLength(1);
  f.show(view(8));await flush();expect(f.posts).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(10001);f.show(view(10,3));await flush();expect(f.posts).toHaveLength(2);
  expect(f.notices.some(text=>text.includes('未确认'))).toBe(true);expect(f.files()).toEqual([]);
 });
 it('keeps explicit same-file removal suppressed across saved revisions',async()=>{
  const f=fixture();await flush();f.reply(f.posts[0].id,view(5,1),{ok:true,file:file('a')});await flush();
  f.control.removed(file('a'));f.show(view(7,2,false));f.show(view(8));await flush();expect(f.posts).toHaveLength(1);
 });
});
