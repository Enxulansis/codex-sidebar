/** Inventory and bounded disclosure checks for the public source snapshot. */
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const excluded=new Set(['node_modules','.git','_temp','output','dist','coverage']);
const files=[];async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(excluded.has(e.name))continue;const path=join(dir,e.name);if(e.isSymbolicLink())throw Error('Source link is not publishable: '+relative(root,path));if(e.isDirectory())await walk(path);else if(e.isFile())files.push(path);}}
await walk(root);const problems=[],manifest=[];
for(const file of files){const path=relative(root,file).replaceAll('\\','/'),bytes=await readFile(file);manifest.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 if(/(^|\/)(auth\.json|\.env(?:\..*)?)$|\.(pem|key|exe|vsix)$/i.test(path))problems.push({path,kind:'private-or-runtime-file'});
 if(!['.ts','.js','.mjs','.cjs','.json','.yaml','.yml','.md','.txt','.ps1','.svg'].includes(extname(file)))continue;
 const text=bytes.toString('utf8');if(/[A-Z]:[\\/]+Users[\\/]+[^\\/\s"']+[\\/]|[A-Z]:[\\/]+[^\x00-\x7F]/i.test(text))problems.push({path,kind:'personal-absolute-path'});
 if(/(?:github_pat_|ghp_)[a-zA-Z0-9_]{30,}|sk-[a-zA-Z0-9_-]{40,}/.test(text))problems.push({path,kind:'credential-pattern'});
 if(extname(file)==='.md')for(const m of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)){let target=m[1].replace(/^<|>$/g,'').split('#')[0];if(!target||/^[a-z]+:/i.test(target))continue;target=decodeURIComponent(target);const destination=resolve(file,'..',target);if(!files.includes(destination))problems.push({path,kind:'missing-local-link',target});}
}
manifest.sort((a,b)=>a.path.localeCompare(b.path));await mkdir(join(root,'output'),{recursive:true});await writeFile(join(root,'output/public-source-manifest.json'),JSON.stringify({files:manifest,problems,scope:'Public source only; excludes local evidence, dependencies, build output and Git history. Binary fixture metadata is checked separately.'},null,2)+'\n');
console.log(JSON.stringify({files:manifest.length,problems}));if(problems.length)process.exitCode=1;
