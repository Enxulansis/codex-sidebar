import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
/** The same frozen parser assets and worker configuration serve production and structural worker tests. */
export async function buildDocumentAssets(root,dist,build){
 await mkdir(dist,{recursive:true});
 const vendor=resolve(root,'src/codex-prototype/vendor'),manifest=JSON.parse(await readFile(resolve(vendor,'ORIGINS.json'),'utf8'));
 for(const asset of manifest.assets){
  if(!/^[a-z0-9.-]+$/i.test(asset.file))throw Error('Invalid document asset name');
  const bytes=await readFile(resolve(vendor,asset.file));
  if(createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('Document vendor fingerprint differs: '+asset.file);
  if(asset.file.endsWith('.mjs')||asset.file.endsWith('.cjs'))await writeFile(resolve(dist,asset.file),bytes);
 }
 const assets={name:'frozen-local-document-assets',setup(builder){builder.onResolve({filter:/^\.\/vendor\/(officeparser\.slim\.mjs|document-geometry\.cjs)$/},args=>({path:'./'+args.path.split('/').at(-1),external:true}));}};
 await build({absWorkingDir:root,entryPoints:[resolve(root,'src/codex-prototype/document-worker.ts')],bundle:true,plugins:[assets],platform:'node',format:'cjs',target:'node22',outfile:resolve(dist,'document-worker.cjs')});
}
