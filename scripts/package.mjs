/** Local packaging only. No upload, account access, or extension installation. */
import {readFile,writeFile,mkdir,readdir,realpath} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const dist=join(root,'experiments/codex-panel/dist'),output=resolve(process.argv[2]??join(root,'output/candidate'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourcePackage=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const inputs=JSON.parse(await readFile(join(dist,'build-inputs.json'),'utf8'));
const assets=['extension.js','offline-vendor.js','offline-browser.js','online-display.js','mathjax-tex-svg.js','local-speech.ps1','local-dictation.ps1','document-worker.cjs','officeparser.slim.mjs','document-geometry.cjs','workspace-files-mcp.cjs'];
await mkdir(dirname(output),{recursive:true});await mkdir(output,{recursive:false});const stage=join(output,'extension');await mkdir(stage);
const files=[];async function put(name,bytes){await mkdir(dirname(join(stage,name)),{recursive:true});await writeFile(join(stage,name),bytes);files.push({path:name,sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});}
for(const name of assets){const bytes=await readFile(join(dist,name));if(/[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+/i.test(bytes.toString('utf8')))throw Error('User directory in bundled asset: '+name);await put('dist/'+name,bytes);}
for(const name of ['codex.svg','codex-light.svg'])await put('media/'+name,await readFile(join(root,'experiments/codex-panel/media',name)));
await put('LICENSE',await readFile(join(root,'LICENSE')));await put('README.md',await readFile(join(root,'docs/EXTENSION_README.md')));
async function copyTree(path){for(const entry of await readdir(join(root,path),{withFileTypes:true})){const child=path+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Linked documentation: '+child);if(entry.isDirectory())await copyTree(child);else if(entry.isFile())await put(child,await readFile(join(root,child)));}}
await copyTree('docs');
const manifest=JSON.parse(await readFile(join(root,'experiments/codex-panel/package.json'),'utf8'));
delete manifest.codexIsolatedArchitecturePrototype;manifest.codexDailyChat=true;manifest.version=sourcePackage.version;manifest.displayName='Codex Sidebar';manifest.description='非官方 Codex 侧栏：长对话阅读、工作区草稿、图片文档和只读文件工具。';manifest.license='MIT';manifest.categories=['Other'];manifest.engines.vscode='^1.125.0';
manifest.capabilities={untrustedWorkspaces:{supported:false,description:'需要受信任的本地工作区。'}};
manifest.contributes.commands=manifest.contributes.commands.filter(v=>!['codexPrototype.previewComparison','codexPrototype.openOfflineExperience','codexPrototype.openOffline'].includes(v.command));manifest.contributes.commands.push({command:'codexPrototype.showBuildInfo',title:'Codex: 显示加载信息'});
manifest.files=[...files.map(f=>f.path),'package.json','THIRD_PARTY_NOTICES.md','build-info.json'];
await put('package.json',JSON.stringify(manifest,null,2)+'\n');
let notices='# Third-party notices\n\nCodex Sidebar derives from DSH under the included MIT LICENSE, Copyright 2026 Lixxx1. It is an independent, unofficial project. Protocol declarations originate from the public Codex App Server interface. No Codex binary or credentials are included. The sidebar window/rail icon is original project artwork under MIT.\n';
notices+='\n## Material Icon Theme\n\nFile-type icons in src/file-type-icons.ts originate from Material Icon Theme: https://github.com/material-extensions/vscode-material-icon-theme .\n\n'+await readFile(join(root,'licenses/material-icon-theme-LICENSE.txt'),'utf8');
notices+='\n## Codex protocol declarations\n\nGenerated from the public openai/codex App Server interface, release rust-v0.163.0-alpha.10.2. Upstream source: https://github.com/openai/codex .\n\n'+await readFile(join(root,'licenses/codex-APACHE-2.0.txt'),'utf8');
const vendorDirectory=join(root,'src/codex-prototype/vendor'),vendor=JSON.parse(await readFile(join(vendorDirectory,'ORIGINS.json'),'utf8'));
notices+='\n## Local document parser resources\n\n'+vendor.retainedNotices+'\n';
for(const name of vendor.licenses){if(!/^[a-z0-9-]+-LICENSE\.txt$/i.test(name))throw Error('Invalid license name');notices+='\n### '+name+'\n\n```text\n'+(await readFile(join(vendorDirectory,name),'utf8')).trim()+'\n```\n';}
const packages=new Map();
for(const input of inputs){if(isAbsolute(input)||input.startsWith('../'))throw Error('Build escaped source root');const marker=input.lastIndexOf('node_modules/');if(marker<0)continue;const sub=input.slice(marker+13).split('/'),name=sub[0].startsWith('@')?sub.slice(0,2).join('/'):sub[0];packages.set(name,resolve(root,input.slice(0,marker+13)+name));}
for(const name of ['mathjax','katex'])packages.set(name,dirname(require.resolve(name+'/package.json')));
async function licenseFiles(folder,depth=0){const found=[];for(const e of await readdir(folder,{withFileTypes:true})){if(e.name==='node_modules'||e.name.startsWith('.'))continue;const path=join(folder,e.name);if(e.isFile()&&/^(licen[sc]e|notice|copying|ofl)([._-].*)?$/i.test(e.name))found.push(path);else if(e.isDirectory()&&depth<2)found.push(...await licenseFiles(path,depth+1));}return found;}
const dependencies=[];
for(const[name,folder]of [...packages].sort(([a],[b])=>a.localeCompare(b))){const rel=relative(resolve(root,'node_modules'),await realpath(folder));if(isAbsolute(rel)||rel.startsWith('..'))throw Error('Dependency outside source root: '+name);const data=JSON.parse(await readFile(join(folder,'package.json'),'utf8')),licenses=await licenseFiles(folder);if(!licenses.length)throw Error('Missing license: '+name);dependencies.push({name,version:data.version,license:data.license});notices+='\n## '+name+' '+data.version+'\n\nDeclared license: '+data.license+'\n';for(const path of licenses)notices+='\n```text\n'+(await readFile(path,'utf8')).trim()+'\n```\n';}
await put('THIRD_PARTY_NOTICES.md',notices);await writeFile(join(root,'THIRD_PARTY_NOTICES.md'),notices);
const sources=[];for(const input of inputs.filter(p=>!p.includes('node_modules/')))sources.push({path:input,sha256:sha(await readFile(join(root,input)))});
await put('build-info.json',JSON.stringify({schemaVersion:1,version:manifest.version,extensionId:manifest.publisher+'.'+manifest.name,mode:'daily-chat',sourceManifestSha256:sha(JSON.stringify(sources)),assets:files,dependencies,documentVendor:vendor.assets},null,2)+'\n');
const vscePackage=JSON.parse(await readFile(require.resolve('@vscode/vsce/package.json'),'utf8')),vsce=join(dirname(require.resolve('@vscode/vsce/package.json')),typeof vscePackage.bin==='string'?vscePackage.bin:vscePackage.bin.vsce),vsix=join(output,manifest.publisher+'.'+manifest.name+'-'+manifest.version+'.vsix');
const result=spawnSync(process.execPath,[vsce,'package','--no-dependencies','--allow-missing-repository','--out',vsix],{cwd:stage,stdio:'inherit',windowsHide:true,timeout:120000});if(result.error||result.status!==0)throw result.error??Error('VSIX packaging failed');
const installer=await readFile(join(root,'scripts/setup-backend.mjs'));await writeFile(join(output,'setup-backend.mjs'),installer);
await writeFile(join(output,'SHA256SUMS.txt'),sha(await readFile(vsix))+'  '+vsix.slice(output.length+1)+'\n'+sha(installer)+'  setup-backend.mjs\n');console.log(JSON.stringify({vsix,files:files.length,dependencies:dependencies.length}));
