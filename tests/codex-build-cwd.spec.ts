import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

it('builds identical experiment assets from the project and an unrelated working directory',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const script=join(root,'experiments/codex-panel/build.mjs');
  const outputs=['dist/extension.js','dist/offline-vendor.js','dist/offline-browser.js','dist/online-display.js','dist/mathjax-tex-svg.js','dist/workspace-files-mcp.cjs','dist/document-worker.cjs','dist/officeparser.slim.mjs','dist/document-geometry.cjs'];
  const fingerprints=()=>outputs.map(n=>createHash('sha256').update(readFileSync(join(root,'experiments/codex-panel',n))).digest('hex'));
  const run=(cwd:string)=>{
    const result=spawnSync(process.execPath,[script,'--production'],{cwd,encoding:'utf8',windowsHide:true,timeout:30_000});
    expect(result.error).toBeUndefined();
    expect(result.status,result.stderr).toBe(0);
    expect(result.stdout).toContain('独立实验扩展已构建');
  };
  run(root);const before=fingerprints();
  run(mkdtempSync(join(tmpdir(),'codex-build-cwd-')));
  expect(fingerprints()).toEqual(before);
},40_000);
