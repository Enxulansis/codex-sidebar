import {build as esbuild} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {buildDocumentAssets} from './build-documents.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const production=process.argv.includes('--production');
const inputs=new Set();
// Use the same dedicated compiler semantics in both the checkout and a clean
// source export; never inherit an unrelated ancestor tsconfig implicitly.
const build=async options=>{const result=await esbuild({...options,tsconfig:resolve(root,'experiments/codex-panel/tsconfig.json'),...(production?{metafile:true}:{})});for(const file of Object.keys(result.metafile?.inputs??{}))inputs.add(file);return result;};
// Launchers may inherit a protected WindowsApps cwd; resolution must use this checkout.
const dist=resolve(root,'experiments/codex-panel/dist');
await mkdir(dist,{recursive:true});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/workspace-files-mcp.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'workspace-files-mcp.cjs')});
await buildDocumentAssets(root,dist,build);
const mathjax=(await readFile(resolve(root,'node_modules/mathjax/es5/tex-svg.js'),'utf8')).replace(/\/\/\# sourceMappingURL=[^\r\n]*/g,'');
await writeFile(resolve(dist,'mathjax-tex-svg.js'),mathjax,'utf8');
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/markdown-vendor-entry.ts')],bundle:true,platform:'browser',format:'iife',target:'chrome130',outfile:resolve(dist,'offline-vendor.js')});
// DSH's embedded KaTeX WOFF2 fonts, restricted to data: in both surfaces.
const css=await readFile(resolve(root,'node_modules/katex/dist/katex.min.css'),'utf8');
let embedded=css;
for(const m of css.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g))embedded=embedded.replace(m[0],`url(data:font/woff2;base64,${(await readFile(resolve(root,'node_modules/katex/dist/fonts',m[1]))).toString('base64')})`);
// Remove the entire fallback source item, including its format(); a leftover
// format("woff") after format("woff2") invalidates the whole font-face src.
embedded=embedded.replace(/,url\(fonts\/[^)]+\)\s+format\([^)]+\)/g,'');
if(/url\((?!data:)/.test(embedded))throw Error('KaTeX CSS contains an unembedded resource');
await writeFile(resolve(dist,'offline-vendor.js'),(await readFile(resolve(dist,'offline-vendor.js'),'utf8'))+`\n(()=>{const style=document.createElement('style');style.nonce=document.currentScript.nonce;style.textContent=${JSON.stringify(embedded)};document.head.append(style)})();\n`,'utf8');
const tiffWorker=await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/display/tiff-worker.ts')],bundle:true,platform:'browser',format:'iife',target:'chrome130',write:false});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/offline/browser.ts')],bundle:true,platform:'browser',format:'iife',target:'chrome130',define:{TIFF_WORKER_SOURCE:JSON.stringify(tiffWorker.outputFiles[0].text)},outfile:resolve(dist,'offline-browser.js')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/display/browser-entry.ts')],bundle:true,platform:'browser',format:'iife',target:'chrome130',define:{TIFF_WORKER_SOURCE:JSON.stringify(tiffWorker.outputFiles[0].text)},outfile:resolve(dist,'online-display.js')});
if(!production){
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/offline/html.ts')],bundle:true,platform:'node',format:'esm',outfile:resolve(dist,'offline-html.mjs')});
const {offlineHtml}=await import('./dist/offline-html.mjs');
await writeFile(resolve(root,'experiments/codex-panel/offline-demo.html'),offlineHtml(await readFile(resolve(dist,'offline-vendor.js'),'utf8'),await readFile(resolve(dist,'offline-browser.js'),'utf8'),'offline-display-demo',mathjax),'utf8');
// Standalone native fixtures share one export coordinator, as the single production extension bundle does.
const sharedExportCarriers={name:'shared-export-carriers',setup(builder){builder.onResolve({filter:/^\.\/export-carriers$/},()=>({path:'./export-carriers.cjs',external:true}));}};
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/export-carriers.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'export-carriers.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/formula-export-host.ts')],bundle:true,plugins:[sharedExportCarriers],platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'formula-export-host.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/block-fold-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'block-fold-store.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/user-fold-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'user-fold-store.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/draft-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'draft-store.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/attachment-files.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'attachment-files.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/attachment-storage.ts')],bundle:true,plugins:[sharedExportCarriers],platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'attachment-storage.cjs')});
await build({absWorkingDir:root,stdin:{contents:"export {SearchCache} from './src/codex-prototype/search-cache';export {ModelSelections} from './src/codex-prototype/model-selection';export {MessageFileSources} from './src/codex-prototype/message-file-sources';export {startAttachmentMaintenance} from './src/codex-prototype/attachment-maintenance';export {checkedImage} from './src/codex-prototype/online-image';export {AttachmentRetention} from './src/codex-prototype/attachment-retention';export {Session} from './src/codex-prototype/session';export {Store} from './src/codex-prototype/storage';export {codexPageContent} from './src/codex-prototype/codex-page-state';export {DISABLED_MCP,DISABLED_PLUGINS} from './src/codex-prototype/tools';export {SearchHistoryStore,handleSearchHistory} from './src/codex-prototype/search-history-store';export {LocalQueueStore,LocalQueueRunner} from './src/codex-prototype/local-queue';export {SubmissionHost,queueDisplay} from './src/codex-prototype/submission-host';export {RpcRequestRejected} from './src/codex-prototype/rpc';",resolveDir:root},bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'history-fixture.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/message-copy.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'message-copy.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/display-copy.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'display-copy.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/image-export-host.ts')],bundle:true,plugins:[sharedExportCarriers],platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'image-export-host.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/file-action-host.ts')],bundle:true,plugins:[sharedExportCarriers],platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'file-action-host.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/scroll-view-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'scroll-view-store.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/tool-expansion-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'tool-expansion-store.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/work-fold-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'work-fold-store.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/changed-files-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'changed-files-store.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/changed-review-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'changed-review-store.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/thread-catalog.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'thread-catalog.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/rail-view-store.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'rail-view-store.cjs')});
}
await writeFile(resolve(dist,'local-speech.ps1'),await readFile(resolve(root,'src/codex-prototype/local-speech.ps1')));
await writeFile(resolve(dist,'local-dictation.ps1'),await readFile(resolve(root,'src/codex-prototype/local-dictation.ps1')));
if(!production){
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/reply-action-host.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'reply-action-host.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/model-selection-host.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'model-selection-host.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/skills-host.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'skills-host.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/editor-attachment-host.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'editor-attachment-host.cjs')});
await build({absWorkingDir:root,stdin:{contents:"export {FileReferenceHost} from './src/codex-prototype/file-reference-host';export {openReferencedText,openReferencedFile,findReferencedFiles} from './src/codex-prototype/file-reference-vscode';",resolveDir:root},bundle:true,platform:'node',format:'cjs',target:'node22',external:['vscode'],outfile:resolve(dist,'file-reference-fixture.cjs')});
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/local-speech.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'local-speech.cjs')});
}
await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/extension.ts')],bundle:true,platform:'node',format:'cjs',target:'node22',external:['vscode'],outfile:resolve(root,'experiments/codex-panel/dist/extension.js'),sourcemap:!production});
console.log('独立实验扩展已构建');
if(!production)await import('./build-preview-comparison.mjs');
if(production)await writeFile(resolve(dist,'build-inputs.json'),JSON.stringify([...inputs].sort(),null,2)+'\n');
