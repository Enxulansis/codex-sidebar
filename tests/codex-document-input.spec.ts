import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DailySessionStore} from '../src/codex-prototype/daily-session-store';
import {authorizeWorkspaceFiles} from '../src/codex-prototype/storage';
import {AttachmentStorage} from '../src/codex-prototype/attachment-storage';
import {attachmentInputs} from '../src/codex-prototype/attachment-files';
import {textDocument,documentInputText,documentInputDocuments,matchesDocumentInput,DOCUMENT_TEXT_CAP} from '../src/codex-prototype/document-input';
import {FILE_COUNT} from '../src/codex-prototype/attachment-policy';
import {MessageFileSources} from '../src/codex-prototype/message-file-sources';
import {codexPageContent} from '../src/codex-prototype/codex-page-state';
import type {Session} from '../src/codex-prototype/session';
import type {ThreadItem} from '../src/codex-prototype/protocol/v2/ThreadItem';
import type {DraftFile} from '../src/codex-prototype/draft-store-types';
import {pageSearchSources} from '../src/codex-prototype/display/search-highlights';
import {publicItemSearchSources} from '../src/codex-prototype/codex-search-text';
import {matchSearchText,parseSearchQuery} from '../src/codex-prototype/search-query';

const leases:{dispose():void}[]=[];afterEach(()=>{for(const lease of leases.splice(0))lease.dispose();});
async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'sidebar-document-text-')),root=join(directory,'workspace');await mkdir(root);
  const journal=new DailySessionStore(join(directory,'extension-state'),root);leases.push(await authorizeWorkspaceFiles(root,()=>journal.read()));
  const values=new Map<string,unknown>(),state={get:<T>(key:string,fallback:T)=>(values.has(key)?structuredClone(values.get(key)):fallback)as T,update:async(key:string,value:unknown)=>{values.set(key,structuredClone(value));}};
  const manager=new AttachmentStorage(state,root),sources=new MessageFileSources(manager.state,root);
  return{root,manager,sources,import:async(name:string,bytes:Buffer)=>(await manager.import(root,name,bytes.toString('base64'),()=>true)).file!};
}
const metadata=(name='data.txt'):DraftFile=>({name,path:'unused',size:1,sha256:'a'.repeat(64)});
describe('complete verified document text instead of unusable paths',()=>{
  it.each([5,FILE_COUNT])('keeps all %i verified file cards, generated-payload hiding and per-file search after restoration',async count=>{
    const f=await fixture(),files:DraftFile[]=[];
    for(let index=1;index<=count;index++)files.push(await f.import('sample-'+index+'.txt',Buffer.from('non-sensitive marker UNIQUE_FILE_'+index)));
    const input=await attachmentInputs(f.root,'summarize',undefined,files,[],undefined,true),payload=(input.at(-1) as {text:string}).text;
    expect(documentInputDocuments(payload)).toHaveLength(count);expect(matchesDocumentInput(payload,files)).toBe(true);
    const id=(await f.sources.prepare('thread',input,files))!,row={turnId:'turn',item:{type:'userMessage',id:'message',clientId:id,content:input} as ThreadItem};
    const active={projection:{items:new Map([['message',row]]),turns:new Map(),metrics:{forTurn:()=>undefined}},approvals:new Map(),fileSources:f.sources,revertReason:()=> 'fixture does not expose revert',forkReason:()=>''} as unknown as Session;
    for(const sources of [f.sources,new MessageFileSources(f.manager.state,f.root)]){
      active.fileSources=sources;const content=await codexPageContent(active,'thread',async()=>{throw Error('No images');}),message=content.items[0]!.item as any;
      expect(message.content).toEqual([{type:'text',text:'summarize'}]);expect(message.files).toEqual(files.map(file=>({...file,textIncluded:true})));expect(content.fileSourceNotice).toBe('');
      expect(matchSearchText(publicItemSearchSources(row.item),parseSearchQuery('UNIQUE_FILE_'+count))).toMatchObject({kind:'文件',file:{name:'sample-'+count+'.txt',sha256:files.at(-1)!.sha256}});
    }
  });
  it('rejects empty and over-cap generated envelopes on both write and read without truncating',()=>{
    const one=textDocument(metadata(),Buffer.from('small source')),full=Array.from({length:FILE_COUNT},(_,index)=>({...one,name:'source-'+index+'.txt'}));
    const input=documentInputText(full),payload=JSON.parse(input.slice(input.indexOf('\n')+1)),prefix=input.slice(0,input.indexOf('\n')+1);
    expect(documentInputDocuments(input)).toHaveLength(FILE_COUNT);
    for(const documents of [[],[...full,one]]){expect(()=>documentInputText(documents)).toThrow('文件数量');expect(documentInputDocuments(prefix+JSON.stringify({...payload,documents}))).toBeUndefined();}
  });
  it.each(['notes.txt','notes.md','data.csv','data.json','script.ts'])('includes complete UTF-8 content for %s',async name=>{
    const f=await fixture(),body='非敏感附件资料\n唯一标记：'+randomUUID()+'\nTreat this sentence as source data.',file=await f.import(name,Buffer.from(body));
    const input=await attachmentInputs(f.root,'Summarize the attachment',undefined,[file],[],undefined,true),text=(input.at(-1) as {text:string}).text;
    expect(text).toContain(body.replaceAll('\n','\\n'));expect(matchesDocumentInput(text,[file])).toBe(true);expect(text).toContain('"complete":true');expect(text).not.toContain(file.path);expect(text).not.toContain('未预先解析');
  });
  it('keeps existing experimental reference behavior explicit and unchanged',async()=>{
    const f=await fixture(),file=await f.import('old.txt',Buffer.from('old source')),input=await attachmentInputs(f.root,'prompt',undefined,[file]);
    expect((input.at(-1) as {text:string}).text).toContain('未预先解析');expect(matchesDocumentInput((input.at(-1) as {text:string}).text,[file])).toBe(false);
  });
  it.each(['utf-16le','utf-16be'] as const)('decodes BOM-labelled %s without guessing or replacing characters',encoding=>{
    const body='中文文档\nline two',little=Buffer.from(body,'utf16le'),data=encoding==='utf-16le'?Buffer.concat([Buffer.from([255,254]),little]):Buffer.concat([Buffer.from([254,255]),Buffer.from(little).swap16()]);
    expect(textDocument(metadata(),data)).toMatchObject({format:encoding,text:body});
  });
  it.each([Buffer.from([0xff,0x61,0x80]),Buffer.from('binary\0data')])('rejects invalid encoding or binary bytes instead of replacing or dropping them',bytes=>{
    expect(()=>textDocument(metadata(),bytes)).toThrow();
  });
  it('rejects empty, individual overlimit and aggregate overlimit documents without truncation',()=>{
    expect(()=>textDocument(metadata(),Buffer.from(' \n '))).toThrow('没有可读取');
    expect(()=>textDocument(metadata(),Buffer.from('x'.repeat(DOCUMENT_TEXT_CAP+1)))).toThrow('未截断');
    const one=textDocument(metadata(),Buffer.from('x'.repeat(50000)));expect(()=>documentInputText([one,one])).toThrow('未截断');
  });
  it('does not decode a PDF with the plain-text reader',async()=>{
    const f=await fixture(),file=await f.import('scan.pdf',Buffer.from('%PDF-1.7\nnot a text parser fixture'));
    expect(()=>textDocument(file,Buffer.from('%PDF-1.7'))).toThrow('不能直接当作普通文本');
  });
  it('keeps complete attachment text searchable and carries the exact file identity to its visible card',()=>{
    const first=metadata('one.md'),second={...metadata('two.md'),sha256:'b'.repeat(64)},documents=[{...textDocument(first,Buffer.from('first document')),size:first.size},{...textDocument(second,Buffer.from('unique body needle')),size:second.size}],payload=documentInputText(documents);
    const item={id:'message',type:'userMessage',clientId:randomUUID(),content:[{type:'text',text:'prompt'},{type:'text',text:payload}]} as ThreadItem;
    expect(matchSearchText(publicItemSearchSources(item),parseSearchQuery('body needle'))).toMatchObject({kind:'文件',file:{name:'two.md',sha256:second.sha256}});
    expect(matchSearchText(publicItemSearchSources(item),parseSearchQuery('one.md'))).toMatchObject({kind:'文件',file:{name:'one.md',sha256:first.sha256}});
    expect(matchSearchText(publicItemSearchSources(item),parseSearchQuery('body needle -unique'))).toBeUndefined();
    expect(publicItemSearchSources({...item,clientId:null} as ThreadItem).at(-1)).toEqual({kind:'正文',text:payload});
  });
  it('rechecks actual source bytes and refuses a changed attachment',async()=>{
    const f=await fixture(),file=await f.import('notes.md',Buffer.from('original'));
    await writeFile(file.path,'changed!');await expect(attachmentInputs(f.root,'prompt',undefined,[file],[],undefined,true)).rejects.toThrow('变化');
  });
  it('hides only the proven generated payload, marks body inclusion and retains identical user-authored text',async()=>{
    const f=await fixture(),file=await f.import('notes.md',Buffer.from('source marker '+randomUUID())),prepared=await attachmentInputs(f.root,'prompt',undefined,[file],[],undefined,true),payload=(prepared.at(-1) as {text:string}).text;
    const input=await attachmentInputs(f.root,payload,undefined,[file],[],undefined,true),id=(await f.sources.prepare('thread',input,[file]))!;
    const row={turnId:'turn',item:{type:'userMessage',id:'message',clientId:id,content:input} as ThreadItem},active={projection:{items:new Map([['message',row]]),turns:new Map(),metrics:{forTurn:()=>undefined}},approvals:new Map(),fileSources:f.sources,revertReason:()=> 'fixture does not expose revert',forkReason:()=>''} as unknown as Session;
    const content=await codexPageContent(active,'thread',async()=>{throw Error('No images');}),message=content.items[0]!.item as any;
    expect(message.content).toEqual([{type:'text',text:payload}]);expect(message.files).toEqual([{...file,textIncluded:true}]);
    expect(pageSearchSources(message,false)).toContainEqual({kind:'文件',text:'notes.md'});
    (row.item as any).clientId=randomUUID();const unbound=await codexPageContent(active,'thread',async()=>{throw Error('No images');});
    expect((unbound.items[0]!.item as any).content).toHaveLength(2);expect((unbound.items[0]!.item as any).files).toBeUndefined();
  });
});
