import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Script,runInNewContext} from 'node:vm';
import {buildSync,transformSync} from 'esbuild';
import ts from 'typescript';
import {html} from '../src/codex-prototype/webview';

const readSource=(path:string)=>readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const baseline=JSON.parse(readSource('tests/fixtures/codex-page-entry-baseline.json'));
const daily=JSON.parse(readSource('tests/fixtures/codex-page-entry-daily-dev21.json'));
const publicRelease=JSON.parse(readSource('tests/fixtures/codex-public-release-dev22.json'));
const dev20Path='tests/fixtures/codex-page-entry-daily-dev20.json';
const dev20=JSON.parse(readSource(dev20Path));
const dev19Path='tests/fixtures/codex-page-entry-daily-dev19.json';
const dev19=JSON.parse(readSource(dev19Path));
const dev18Path='tests/fixtures/codex-page-entry-daily-dev18.json';
const dev18=JSON.parse(readSource(dev18Path));
const dev17Path='tests/fixtures/codex-page-entry-daily-dev17.json';
const dev17=JSON.parse(readSource(dev17Path));
const dev16Path='tests/fixtures/codex-page-entry-daily-dev16.json';
const dev16=JSON.parse(readSource(dev16Path));
const dev15Path='tests/fixtures/codex-page-entry-daily-dev15.json';
const dev15=JSON.parse(readSource(dev15Path));
const dev14Path='tests/fixtures/codex-page-entry-daily-dev14.json';
const dev14=JSON.parse(readSource(dev14Path));
const dev13Path='tests/fixtures/codex-page-entry-daily-dev13.json';
const dev13=JSON.parse(readSource(dev13Path));
const dev12Path='tests/fixtures/codex-page-entry-daily-dev12.json';
const dev12=JSON.parse(readSource(dev12Path));
const previousPath='tests/fixtures/codex-page-entry-daily-0185.json';
const previous=JSON.parse(readSource(previousPath));
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const frozen=readSource('tests/fixtures/codex-page-entry-38d1f3d.js').replace(/^\/\/[^\n]*\n/gm,'').trim();
const normalized=(source:string)=>transformSync(source,{loader:'js',target:'es2024',minifySyntax:true,minifyWhitespace:true}).code;

// The historical extraction artifact stays immutable. The current daily
// checkpoint includes the reviewed windowed renderer and native controls in
// full, instead of erasing their code to mimic the pre-window implementation.
// State/permission/render behavior remains exercised by the corresponding
// executable suites and real-plugin evidence listed in this checkpoint.
describe('historical extraction provenance and current daily page contract',()=>{
 it('preserves the previous snapshot and accounts for the reviewed source and function changes',()=>{
  const daily=dev12;
  expect(daily.inheritedCheckpoint).toBe(previousPath);
  expect(sha(readSource(previousPath))).toBe(daily.inheritedCheckpointSha256);
  expect(previous.historicalRevision).toBe(baseline.revision);
  const changedFiles=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==previous.protectedFiles[path]).sort();
  expect(changedFiles).toEqual(['src/codex-prototype/extension.ts','src/codex-prototype/display/style.ts','src/codex-prototype/display/settings-style.ts','src/codex-prototype/display/composer.ts','src/codex-prototype/display/draft-memory.ts','src/codex-prototype/webview.ts','src/codex-prototype/page-entry.ts'].sort());
  expect(Object.keys(daily.reviewedChanges.protectedFiles).sort()).toEqual(changedFiles);
  expect(Object.keys(daily.functionSha256).filter(name=>daily.functionSha256[name]!==previous.functionSha256[name]).sort()).toEqual(['render','updateSend']);
  expect(daily.sourceReview.unchangedProtectedFiles).toBe(21);
  expect(daily.sourceReview.unchangedFunctions).toBe(9);
 });
 it('pins the authorized R02/R05 changes while retaining all dev12 functions and historical evidence',()=>{
  const daily=dev13;
  expect(daily.inheritedCheckpoint).toBe(dev12Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev12Path)));
  const changed=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==dev12.protectedFiles[path]).sort();
  expect(changed).toEqual(['src/codex-prototype/display/settings-style.ts','src/codex-prototype/storage.ts']);
  expect(Object.keys(daily.reviewedChanges.protectedFiles).sort()).toEqual(changed);expect(daily.functionSha256).toEqual(dev12.functionSha256);
  expect(daily.sourceReview.unchangedProtectedFiles).toBe(26);expect(daily.sourceReview.unchangedFunctions).toBe(11);
 });
 it('pins R04 presentation and located-target wiring without changing dev13 controls, backend or page functions',()=>{
  const daily=dev14;
  expect(daily.inheritedCheckpoint).toBe(dev13Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev13Path)));
  const changed=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==dev13.protectedFiles[path]).sort();
  expect(changed).toEqual(['src/codex-prototype/display/settings-style.ts','src/codex-prototype/page-entry.ts']);
  expect(Object.keys(daily.reviewedChanges.protectedFiles)).toEqual(changed);expect(daily.functionSha256).toEqual(dev13.functionSha256);
  expect(daily.sourceReview.unchangedProtectedFiles).toBe(26);expect(daily.sourceReview.unchangedFunctions).toBe(11);
 });
 it('pins explicit R11 daily service admission while preserving all dev14 page functions',()=>{
  const daily=dev15;
  expect(daily.inheritedCheckpoint).toBe(dev14Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev14Path)));
  const changed=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==dev14.protectedFiles[path]).sort();
  expect(changed).toEqual(['src/codex-prototype/display/settings-style.ts','src/codex-prototype/extension.ts','src/codex-prototype/rpc.ts','src/codex-prototype/tools.ts']);
  expect(Object.keys(daily.reviewedChanges.protectedFiles).sort()).toEqual(changed);expect(daily.functionSha256).toEqual(dev14.functionSha256);
  expect(daily.sourceReview.unchangedProtectedFiles).toBe(24);expect(daily.sourceReview.unchangedFunctions).toBe(11);
 });
 it('pins R12 conversation changes without rewriting the inherited dev15 checkpoint',()=>{
  const daily=dev16;
  expect(daily.inheritedCheckpoint).toBe(dev15Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev15Path)));
  const changed=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==dev15.protectedFiles[path]).sort();
  expect(changed).toEqual(['src/codex-prototype/display/message-actions.ts','src/codex-prototype/extension.ts','src/codex-prototype/page-entry.ts','src/codex-prototype/rpc.ts','src/codex-prototype/session.ts']);
  expect(Object.keys(daily.reviewedChanges.protectedFiles).sort()).toEqual(changed);
  expect(Object.keys(dev15.functionSha256).filter(name=>daily.functionSha256[name]!==dev15.functionSha256[name]).sort()).toEqual(['render','updateSend']);
  expect(Object.keys(daily.functionSha256).filter(name=>!(name in dev15.functionSha256))).toEqual(['revertReply']);
  expect(daily.shellSha256).toBe(dev15.shellSha256);expect(daily.sourceReview.unchangedProtectedFiles).toBe(23);expect(daily.sourceReview.unchangedFunctions).toBe(9);
 });
 it('pins R11-D metadata changes and retains all dev16 page functions and shell',()=>{
  const daily=dev17;
  expect(daily.inheritedCheckpoint).toBe(dev16Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev16Path)));
  const changed=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==dev16.protectedFiles[path]).sort();
  expect(changed).toEqual(['src/codex-prototype/extension.ts','src/codex-prototype/rpc.ts','src/codex-prototype/session.ts']);
  expect(Object.keys(daily.reviewedChanges.protectedFiles).sort()).toEqual(changed);expect(daily.functionSha256).toEqual(dev16.functionSha256);expect(daily.shellSha256).toBe(dev16.shellSha256);
  expect(daily.sourceReview.unchangedProtectedFiles).toBe(25);expect(daily.sourceReview.unchangedFunctions).toBe(12);
 });
 it('pins R09 hidden image measurement without changing visible image controls or the shell',()=>{
  const daily=dev18;
  expect(daily.inheritedCheckpoint).toBe(dev17Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev17Path)));
  const changed=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==dev17.protectedFiles[path]);
  expect(changed).toEqual(['src/codex-prototype/page-entry.ts']);expect(Object.keys(daily.reviewedChanges.protectedFiles)).toEqual(changed);
  expect(Object.keys(daily.functionSha256).filter(name=>daily.functionSha256[name]!==dev17.functionSha256[name])).toEqual(['render']);
  expect(daily.shellSha256).toBe(dev17.shellSha256);expect(daily.sourceReview.unchangedProtectedFiles).toBe(27);expect(daily.sourceReview.unchangedFunctions).toBe(11);
 });
 it('pins atomic image publication while retaining the dev18 page functions and shell',()=>{
  const daily=dev19;
  expect(daily.inheritedCheckpoint).toBe(dev18Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev18Path)));
  const changed=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==dev18.protectedFiles[path]);
  expect(changed).toEqual(['src/codex-prototype/extension.ts']);expect(Object.keys(daily.reviewedChanges.protectedFiles)).toEqual(changed);
  expect(daily.functionSha256).toEqual(dev18.functionSha256);expect(daily.shellSha256).toBe(dev18.shellSha256);
  expect(daily.sourceReview.unchangedProtectedFiles).toBe(27);expect(daily.sourceReview.unchangedFunctions).toBe(12);
 });
 it('pins authorized disclosure styling and connection quota delivery while retaining unrelated functions',()=>{
  const daily=dev20;
  expect(daily.inheritedCheckpoint).toBe(dev19Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev19Path)));
  const changed=Object.keys(daily.protectedFiles).filter(path=>daily.protectedFiles[path]!==dev19.protectedFiles[path]).sort();
  expect(changed).toEqual(['src/codex-prototype/extension.ts','src/codex-prototype/page-entry.ts','src/codex-prototype/webview.ts']);
  expect(Object.keys(daily.reviewedChanges.protectedFiles).sort()).toEqual(changed);
  expect(Object.keys(daily.functionSha256).filter(name=>daily.functionSha256[name]!==dev19.functionSha256[name])).toEqual(['render']);
  expect(daily.shellSha256).not.toBe(dev19.shellSha256);expect(daily.sourceReview.unchangedProtectedFiles).toBe(25);expect(daily.sourceReview.unchangedFunctions).toBe(11);
 });
 it('pins the smaller disclosure shell without altering protected behavior or entry functions',()=>{
  expect(daily.inheritedCheckpoint).toBe(dev20Path);expect(daily.inheritedCheckpointSha256).toBe(sha(readSource(dev20Path)));
  expect(daily.protectedFiles).toEqual(dev20.protectedFiles);expect(daily.functionSha256).toEqual(dev20.functionSha256);
  expect(daily.shellSha256).not.toBe(dev20.shellSha256);expect(daily.reviewedChanges.protectedFiles).toEqual({});
  expect(daily.sourceReview.unchangedProtectedFiles).toBe(28);expect(daily.sourceReview.unchangedFunctions).toBe(12);
 });
 it('retains the original reference and checks the complete current HTML/CSS/CSP shell',()=>{
  expect(sha(frozen)).toBe(baseline.mainSha256);
  expect(daily.historicalRevision).toBe(baseline.revision);
  const page=html('baseline',{vendor:'',display:''});
  const shell=page.replace(/(<script nonce="baseline" data-main>)[\s\S]*?(<\/script>)/,'$1$2').replace(/\r\n/g,'\n');
  expect(sha(shell)).toBe(daily.shellSha256);
  for(const id of ['new','restore','restart'])expect(page).toContain('id="'+id+'" disabled');
  expect(page).toContain("default-src 'none'; worker-src blob:; connect-src 'none'; style-src 'nonce-baseline'; script-src 'nonce-baseline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none';");
  expect(page).not.toContain('unsafe-inline');expect(page).not.toContain('unsafe-eval');
 });
 it('pins every original protected source plus the current complete webview and entry without erasing guards',()=>{
  expect(Object.keys(daily.protectedFiles).sort()).toEqual([...Object.keys(baseline.protectedFiles),'src/codex-prototype/webview.ts','src/codex-prototype/page-entry.ts'].sort());
  expect(Object.keys(publicRelease.reviewedChanges).sort()).toEqual(['src/codex-prototype/pin.ts','src/codex-prototype/rpc.ts','src/codex-prototype/tools.ts']);
  const mismatches=Object.entries({...daily.protectedFiles,...publicRelease.reviewedChanges}).flatMap(([path,expected])=>{const actual=sha(readSource(path));return actual===expected?[]:[{path,expected,actual}];});
  expect(mismatches).toEqual([]);
 });
 it('checks rendering, send gates, identity and action functions at the reviewed daily checkpoint',()=>{
  const source=readSource('src/codex-prototype/page-entry.ts');
  const emitted=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText;
  const file=ts.createSourceFile('page.js',emitted,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const entry=file.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='startPage')!;
  const functions=new Map(entry.body!.statements.filter(ts.isFunctionDeclaration).map(n=>[n.name!.text,n.getText(file)]));
  expect(Object.keys(daily.functionSha256).sort()).toEqual(['render','updateSend','rememberDraft','resetPendingSend','sameOwner','clearFormulaExports','loadMathJax','exportFormula','copyText','forkReply','revertReply','text'].sort());
  const mismatches=Object.entries(daily.functionSha256).flatMap(([name,expected])=>{expect(functions.has(name),name).toBe(true);const actual=sha(normalized(functions.get(name)!));return actual===expected?[]:[{name,expected,actual}];});
  expect(mismatches).toEqual([]);
 });
 it('boots the extracted entry exactly once with the original timeout values',()=>{
  const main=html('baseline',{vendor:'',display:''}).match(/<script nonce="baseline" data-main>([\s\S]*?)<\/script>/)![1]!;
  const calls:unknown[]=[],events=new Map<string,(event?:unknown)=>void>(),body={dataset:{} as Record<string,string>};runInNewContext(main,{document:{body,addEventListener:(type:string,callback:(event?:unknown)=>void)=>events.set(type,callback)},window:{__codexDisplay:{startPage:(...args:unknown[])=>calls.push(args)}}});
  expect(calls).toEqual([[30000,35000]]);
  events.get('pointerdown')!();expect(body.dataset.input).toBe('pointer');events.get('keydown')!({key:'Escape'});expect(body.dataset.input).toBe('pointer');events.get('keydown')!({key:'Tab'});expect(body.dataset.input).toBe('keyboard');events.get('pointerdown')!();expect(body.dataset.input).toBe('pointer');
 });
 it('does not display the DSH-specific price-period lamp or execute its reminder algorithm',()=>{
  const page=html('semantic',{vendor:'',display:''});for(const literal of ['usage-light','usagePeriodTitle','beijingPeak','高峰时段','空闲时段'])expect(page).not.toContain(literal);
  const output=buildSync({entryPoints:['src/codex-prototype/display/browser-entry.ts'],bundle:true,platform:'browser',format:'iife',target:'chrome130',write:false}).outputFiles[0]!.text;for(const literal of ['usage-light','usagePeriodTitle','beijingPeak'])expect(output).not.toContain(literal);
 });
 it('executes the real browser bundle and exposes the original library plus its current page entry',()=>{
  const output=buildSync({entryPoints:['src/codex-prototype/display/browser-entry.ts'],bundle:true,platform:'browser',format:'iife',target:'chrome130',write:false}).outputFiles[0]!.text;
  expect(()=>new Script(output)).not.toThrow();expect(output).not.toContain('eval(');
  const window:{__codexDisplay?:Record<string,unknown>}={};runInNewContext(output,{window});
  expect(Object.keys(window.__codexDisplay!).sort()).toEqual([...baseline.displayKeys,'messageFileCards','foldedWorkItems','startPage'].sort());
  expect(Object.values(window.__codexDisplay!).every(value=>typeof value==='function')).toBe(true);
 });
});
