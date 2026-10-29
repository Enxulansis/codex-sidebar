import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {FormulaExporter,validateFormulaPayload,formulaValidationScript,runFormulaScript,type FormulaOwner,type FormulaRequest} from '../src/codex-prototype/formula-export-host';
import {pngScale,mathjaxSourceTag} from '../src/codex-prototype/display/dsh-math-export';
import {cfHtmlDocument} from '../src/system-clipboard';
const SVG='<svg xmlns="http://www.w3.org/2000/svg" width="10px" height="10px"><path d="M0 0H10V10H0Z"/></svg>';
const MATH='<math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mi>x</mi><annotation encoding="application/x-tex">x+中文</annotation></semantics></math>';
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function setup(){
 const root=mkdtempSync(join(tmpdir(),'codex-prototype-export-unit-'));writeFileSync(join(root,'.codex-prototype-owned'),'restricted-prototype');
 const state:FormulaOwner={threadId:'synthetic',connectionId:1,items:[{turnId:'turn',complete:true,item:{type:'agentMessage',id:'answer',text:'$x$'}}]};
 const request:FormulaRequest={id:1,threadId:'synthetic',connectionId:1,turnId:'turn',itemId:'answer',raw:'x',display:false,kind:'svg',svg:SVG,png:PNG};
 return {root,state,request};
}
describe('formula export boundary — synthetic data only',()=>{
 it.each(['svg','png','mathml','save-svg','save-png'] as const)('exports %s from an ordinary display workspace without granting execution authority',async kind=>{
  const {state,request}=setup(),root=mkdtempSync(join(tmpdir(),'codex-prototype-formula-ordinary-')),target=join(root,kind==='save-svg'?'selected.svg':'selected.png');let nativeCalls=0;
  const exporter=new FormulaExporter(root,()=>state,async()=>target,async()=>{nativeCalls++});
  const payload=kind==='svg'?{svg:SVG,png:PNG}:kind==='png'?{png:PNG}:kind==='mathml'?{mathml:MATH}:kind==='save-svg'?{svg:SVG,name:'formula-20261013-120000.svg'}:{png:PNG,name:'formula-20261013-120000.png'};
  expect(await exporter.handle({...request,kind,...payload} as FormulaRequest)).toBe(kind.startsWith('save-')?'saved':'copied');expect(nativeCalls).toBe(kind.startsWith('save-')?1:2);expect(existsSync(join(root,'.codex-prototype-owned'))).toBe(false);expect(existsSync(join(root,'.codex-export-temp'))).toBe(false);
  if(kind.startsWith('save-'))expect(readFileSync(target)).toEqual(kind==='save-svg'?Buffer.from(SVG):Buffer.from(PNG.slice(22),'base64'));
 });
 it('permits clipboard-only display without a folder but requires a local folder before a save dialog',async()=>{
  const {state,request}=setup();let choices=0;const exporter=new FormulaExporter('',()=>state,async()=>{choices++;return undefined},async()=>{});expect(await exporter.handle(request)).toBe('copied');await expect(exporter.handle({...request,kind:'save-svg',name:'formula-20261013-120000.svg'})).rejects.toThrow('本地文件夹');expect(choices).toBe(0);
 });
 it.each(['svg','png','mathml','save-svg','save-png'] as const)('validates and routes %s; writes only selected owned output and releases staging files',async kind=>{
  const {root,state,request}=setup(),scripts:string[]=[];const target=join(root,'selected.'+(kind==='save-svg'?'svg':'png'));
  const exporter=new FormulaExporter(root,()=>state,async()=>target,async script=>{scripts.push(script)});
  const identity={id:request.id,threadId:request.threadId,connectionId:request.connectionId,turnId:request.turnId,itemId:request.itemId,raw:request.raw,display:request.display};
  const payload=kind==='svg'?{svg:SVG,png:PNG}:kind==='png'?{png:PNG}:kind==='mathml'?{mathml:MATH}:kind==='save-svg'?{svg:SVG,name:'formula-20261013-120000.svg'}:{png:PNG,name:'formula-20261013-120000.png'};
  const value={...identity,kind,...payload} as FormulaRequest;
  const result=await exporter.handle(value);expect(result).toBe(kind.startsWith('save-')?'saved':'copied');
  expect(scripts[0]).toContain('XmlResolver=$null');expect(scripts[0]).toContain('DtdProcessing');
  if(kind==='svg')expect(scripts[1]).toContain("'image/svg+xml'");if(kind==='png')expect(scripts[1]).toContain("'PNG'");if(kind==='mathml')expect(scripts[1]).toContain("'HTML Format'");
  if(kind.startsWith('save-'))expect(readFileSync(target).equals(kind==='save-svg'?Buffer.from(SVG):Buffer.from(PNG.slice(22),'base64'))).toBe(true);
  const paths=scripts[0]!.match(/'(?:[^']*codex-formula-export-[^']*)'/g)??[];for(const path of paths)expect(existsSync(path.slice(1,-1))).toBe(false);
 });
 it('save cancellation creates no output and cannot flash a successful save',async()=>{
  const {root,state,request}=setup();const exporter=new FormulaExporter(root,()=>state,async()=>undefined,async()=>{});
  expect(await exporter.handle({...request,kind:'save-svg',svg:SVG,name:'formula-20261013-120000.svg'})).toBe('canceled');expect(existsSync(join(root,'formula-20261013-120000.svg'))).toBe(false);
 });
 it.each(['thread','connection','item','turn','stream','changed','code'])('rejects %s identity before any native operation or dialog',async fault=>{
  const {root,state,request}=setup();let effects=0;
  if(fault==='thread')state.threadId='other';if(fault==='connection')state.connectionId++;
  if(fault==='item')state.items[0]!.item.id='other';if(fault==='turn')state.items[0]!.turnId='other';if(fault==='stream')state.items[0]!.complete=false;
  if(fault==='changed')state.items[0]!.item.text='$y$';if(fault==='code')state.items[0]!.item.text='```tex\n$x$\n```';
  const exporter=new FormulaExporter(root,()=>state,async()=>{effects++;return undefined},async()=>{effects++});
  await expect(exporter.handle(request)).rejects.toThrow();expect(effects).toBe(0);
 });
 it('a thread switch while validation awaits prevents native copying',async()=>{
  const {root,state,request}=setup();let release!:()=>void,calls=0;
  const exporter=new FormulaExporter(root,()=>state,async()=>undefined,async()=>{calls++;if(calls===1)await new Promise<void>(r=>{release=r})});
  const sending=exporter.handle(request);while(!release)await new Promise(r=>setTimeout(r,5));state.connectionId++;release();await expect(sending).rejects.toThrow('身份');expect(calls).toBe(1);
 });
 it('does not acknowledge a late clipboard completion after its display identity changes',async()=>{
  const {root,state,request}=setup();let calls=0;const exporter=new FormulaExporter(root,()=>state,async()=>undefined,async()=>{if(++calls===2)state.connectionId++;});await expect(exporter.handle(request)).rejects.toThrow('身份');expect(calls).toBe(2);
 });
 it.each(['.codex-export-temp','.CODEX-attachments'])('rejects reserved internal save folder %s without writing or removing its contents',async folder=>{
  const {root,state,request}=setup(),directory=join(root,folder);mkdirSync(directory,{recursive:true});const target=join(directory,'existing.svg');writeFileSync(target,'foreign existing');const exporter=new FormulaExporter(root,()=>state,async()=>target,async()=>{});await expect(exporter.handle({...request,kind:'save-svg',name:'formula-20261013-120000.svg'})).rejects.toThrow('内部');expect(readFileSync(target,'utf8')).toBe('foreign existing');
 });
 it('a thread switch during the save dialog discards the selected target without writing it',async()=>{
  const {root,state,request}=setup();let choose!:(s:string)=>void;const file=join(root,'discarded.svg');
  const exporter=new FormulaExporter(root,()=>state,()=>new Promise<string>(r=>{choose=r}),async()=>{});
  const saving=exporter.handle({...request,kind:'save-svg',svg:SVG,name:'formula-20261013-120000.svg'});while(!choose)await new Promise(r=>setTimeout(r,5));state.threadId='other';choose(file);
  await expect(saving).rejects.toThrow('身份');expect(existsSync(file)).toBe(false);
 });
 it.each(['outside','junction'])('never saves through an %s target',async fault=>{
  const {root,state,request}=setup(),outside=mkdtempSync(join(tmpdir(),'codex-prototype-export-outside-'));let path=join(outside,'blocked.svg');
  if(fault==='junction'){mkdirSync(join(root,'nested'));symlinkSync(outside,join(root,'nested/link'),'junction');path=join(root,'nested/link/blocked.svg');}
  const exporter=new FormulaExporter(root,()=>state,async()=>path,async()=>{});
  await expect(exporter.handle({...request,kind:'save-svg',svg:SVG,name:'formula-20261013-120000.svg'})).rejects.toThrow(/超出|链接/);expect(existsSync(join(outside,'blocked.svg'))).toBe(false);
 });
 it('rejects a concurrent export and recovers after a native failure',async()=>{
  const {root,state,request}=setup();let release:((error:Error)=>void)|undefined;
  const exporter=new FormulaExporter(root,()=>state,async()=>undefined,()=>new Promise<void>((_r,reject)=>{release=reject}));
  const first=exporter.handle(request);while(!release)await new Promise(r=>setTimeout(r,5));await expect(exporter.handle({...request,id:2})).rejects.toThrow('尚未结束');release(Error('native failed'));await expect(first).rejects.toThrow('native failed');
  release=undefined;const second=exporter.handle({...request,id:3});await expect(exporter.handle({...request,id:4})).rejects.toThrow('尚未结束');while(!release)await new Promise(r=>setTimeout(r,5));release(Error('second failure'));await expect(second).rejects.toThrow('second failure');
 });
 it.each(['oversize','signature','dimensions','name','doctype','unknown'])('rejects %s export payloads',fault=>{
  const {request}=setup();let value:any={...request};
  if(fault==='oversize')value.svg='<svg>'+('x'.repeat(2*1024*1024))+'</svg>';
  if(fault==='signature')value.png='data:image/png;base64,AAAA';
  if(fault==='dimensions'){const bytes=Buffer.from(PNG.slice(22),'base64');bytes.writeUInt32BE(4097,16);value.png='data:image/png;base64,'+bytes.toString('base64');}
  if(fault==='name')value={...value,kind:'save-svg',name:'../escape.svg'};
  if(fault==='doctype')value.svg='<!DOCTYPE svg><svg/>';if(fault==='unknown')value.kind='unsupported';
  expect(()=>validateFormulaPayload(value)).toThrow();
 });
 it('CF_HTML byte offsets preserve Chinese and the TeX annotation precisely',()=>{
  const data=Buffer.from(cfHtmlDocument(MATH),'utf8'),text=data.toString('utf8');
  const offset=(name:string)=>Number(new RegExp(name+':(\\d+)').exec(text)![1]);
  expect(data.subarray(offset('StartFragment'),offset('EndFragment')).toString('utf8')).toBe(MATH);expect(offset('EndHTML')).toBe(data.length);
 });
 it('embeds library bytes as inert JSON, with script terminators escaped',()=>{
  const html=mathjaxSourceTag('</script><script>unsafe</script>','test');expect(html).toContain('type="application/json"');expect(html.match(/<script/g)).toHaveLength(1);expect(html).toContain('\\u003c/script>');
 });
 it.each(['512','1024','2048','screen'])('keeps original normal-size raster policy for %s and bounds extreme formula widths',edge=>{
  const width=200,height=60,target=edge==='screen'?0:Number(edge);const scale=Math.min(8,Math.max(2,target>0?target/width:4));
  expect(pngScale(width,height,edge)).toEqual({width:Math.round(width*scale),height:Math.round(height*scale)});
  expect(pngScale(20000,1000,edge).width).toBeLessThanOrEqual(4096);
 });
});
describe.skipIf(process.platform!=='win32')('native XML validation — no clipboard access',()=>{
 it.each([['svg',SVG],['math',MATH]] as const)('accepts static %s using the real XML reader',async(kind,source)=>{
  const root=mkdtempSync(join(tmpdir(),'codex-prototype-xml-unit-')),path=join(root,'valid.xml');writeFileSync(path,source);await expect(runFormulaScript(formulaValidationScript(path,kind))).resolves.toBeUndefined();
 });
 it.each([
  '<svg xmlns="http://www.w3.org/2000/svg"><script>unsafe</script></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/x"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><use href="file:///C:/outside.svg"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" onload="unsafe"/>',
  '<svg xmlns="http://www.w3.org/2000/svg" style="fill:url(https://example.invalid/x)"/>',
  '<!DOCTYPE svg SYSTEM "https://example.invalid/x"><svg xmlns="http://www.w3.org/2000/svg"/>',
 ])('rejects resource or execution markup without resolving it (%s)',async source=>{
  const root=mkdtempSync(join(tmpdir(),'codex-prototype-xml-unit-')),path=join(root,'blocked.xml');writeFileSync(path,source);await expect(runFormulaScript(formulaValidationScript(path,'svg'))).rejects.toThrow();
 });
});
