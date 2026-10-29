import {beforeAll,afterAll,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve,relative,basename,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {readBinaryDocument,createDocumentReader} from '../src/codex-prototype/document-reader';
import {documentInputText} from '../src/codex-prototype/document-input';
import type {DraftFile} from '../src/codex-prototype/draft-store-types';
import {buildDocumentAssets} from '../experiments/codex-panel/build-documents.mjs';

let directory='',worker='';
beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'codex-document-worker-'));worker=join(directory,'document-worker.cjs');
  await buildDocumentAssets(resolve('.'),directory,options=>build({...options,tsconfig:resolve('experiments/codex-panel/tsconfig.json')}));
});
afterAll(async()=>{
  if(!directory)return;const path=resolve(directory),within=relative(resolve(tmpdir()),path);
  if(!within||within.startsWith('..')||isAbsolute(within)||!basename(path).startsWith('codex-document-worker-'))throw Error('Refuse cleanup outside owned worker fixture');
  await rm(path,{recursive:true,force:true});
});
async function fixture(name:string){const path=resolve('tests/fixtures/codex-documents',name),bytes=await readFile(path),file:DraftFile={path,name,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};return{file,bytes};}
describe('actual finite-lived document worker using the published slim parser',()=>{
  it.each([['text.pdf','271828'],['chinese.pdf','中文文档验证'],['word.docx','314159'],['table.xlsx','141421'],['slides.pptx','161803']])('reads all text from %s and finishes its worker',async(name,marker)=>{
    const {file,bytes}=await fixture(name!),result=await readBinaryDocument(file,bytes,undefined,worker);
    expect(result.text).toContain(marker);expect(result.sha256).toBe(file.sha256);expect(result.notes).toEqual([]);
    expect(documentInputText([result])).toContain('text-only');expect(documentInputText([result])).toContain('未运行OCR');
  });
  it('rejects a scanned PDF instead of claiming it read the page image',async()=>{
    const {file,bytes}=await fixture('scan.pdf');await expect(readBinaryDocument(file,bytes,undefined,worker)).rejects.toThrow('没有可提取的文字');
  });
  it('reads real BIFF8 XLS Chinese, stored cell values and hidden sheet text',async()=>{
    const {file,bytes}=await fixture('legacy-table.xls'),result=await readBinaryDocument(file,bytes,undefined,worker);
    expect(bytes.subarray(0,8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    for(const text of ['工作表：统计','姓名','样本甲','17','样本乙','25','合计','42','工作表：说明','XLS49_READBACK_7351','仅非敏感测试'])expect(result.text).toContain(text);
    expect(result.format).toBe('xls');expect(result.notes).toEqual(['SPREADSHEET_STORED_VALUES']);expect(result.sha256).toBe(file.sha256);
    expect(documentInputText([result])).toContain('XLS49_READBACK_7351');
  });
  it('rejects text or ZIP files renamed XLS rather than claiming binary workbook support',async()=>{
    const {file}=await fixture('legacy-table.xls'),xlsx=await fixture('table.xlsx');
    for(const bytes of [Buffer.from('<html>not a binary workbook</html>'),xlsx.bytes])await expect(readBinaryDocument(file,bytes,undefined,worker)).rejects.toThrow('另存为 .xlsx');
  });
  it('rejects damaged OLE XLS without partial text',async()=>{
    const {file,bytes}=await fixture('legacy-table.xls');await expect(readBinaryDocument(file,bytes.subarray(0,32),undefined,worker)).rejects.toThrow('解析失败');
  });
  it('rejects encryption without prompting for or storing a password',async()=>{
    const {file,bytes}=await fixture('encrypted.pdf');await expect(readBinaryDocument(file,bytes,undefined,worker)).rejects.toThrow('加密');
  });
  it('does not return truncated text when the actual parser sees corrupt bytes',async()=>{
    const {file}=await fixture('text.pdf');await expect(readBinaryDocument(file,Buffer.from('%PDF-1.7\nbroken'),undefined,worker)).rejects.toThrow('解析失败');
  });
  it('terminates an unresponsive worker at its deadline and releases it before rejecting',async()=>{
    const hang=join(directory,'hang.cjs');await writeFile(hang,'for (;;) {}');const {file,bytes}=await fixture('text.pdf'),start=performance.now();
    await expect(readBinaryDocument(file,bytes,undefined,hang,80)).rejects.toThrow('已停止');expect(performance.now()-start).toBeLessThan(1500);
  });
  it('cancels a running worker promptly and keeps input bytes unchanged',async()=>{
    const {file,bytes}=await fixture('text.pdf'),controller=new AbortController(),before=Buffer.from(bytes),start=performance.now();
    const reading=readBinaryDocument(file,bytes,controller.signal,worker),rejected=expect(reading).rejects.toMatchObject({name:'AbortError'});
    setTimeout(()=>controller.abort(),10);await rejected;expect(performance.now()-start).toBeLessThan(1500);expect(bytes).toEqual(before);
  });
  it('refuses an already canceled request without starting work and memoizes only within the current verified send',async()=>{
    const {file,bytes}=await fixture('word.docx'),controller=new AbortController();controller.abort();
    await expect(readBinaryDocument(file,bytes,controller.signal,worker)).rejects.toMatchObject({name:'AbortError'});
    const active=new AbortController(),read=createDocumentReader(active.signal,worker),first=await read(file,bytes);expect(await read(file,bytes)).toBe(first);
    active.abort();await expect(read(file,bytes)).rejects.toMatchObject({name:'AbortError'});
  });
});
