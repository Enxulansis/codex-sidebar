/** Display export staging is separate from model/workspace execution authority. */
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertWorkspaceFiles} from './storage';
import {exportCarriers} from './export-carriers';

let privateRoot:Promise<string>|undefined;
export async function displayExportCarriers(sourceRoot:string){
 // A registered daily workspace and an owned experiment retain their bounded journal.
 // A display-only workspace uses private staging without gaining model authority.
 let owned=false;try{await assertWorkspaceFiles(sourceRoot);owned=true;}catch{/* A display-only source does not need execution authority. */}
 if(owned)return exportCarriers(sourceRoot);
 privateRoot??=(async()=>{const root=await mkdtemp(join(tmpdir(),'codex-prototype-clipboard-'));await writeFile(join(root,'.codex-prototype-owned'),'restricted-prototype',{encoding:'utf8',flag:'wx'});return root;})();
 return exportCarriers(await privateRoot);
}
