/** Install the supported public backend. Does not log in or modify VS Code. */
import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {access,copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';

const version='0.163.0-alpha.10.2';
const executableHash='76b4bfc83785f31c59ec384760003109410132bab602a2115d83e88e04a6dc47';
const archiveHash='ac056f7dfafcf8e9d4c549d3e025c4e838ae6427dbfce21942f45b7805db8f59';
const url=`https://github.com/openai/codex/releases/download/rust-v${version}/codex-x86_64-pc-windows-msvc.exe.tar.gz`;
const args=process.argv.slice(2);let destination=join(homedir(),'AppData','Local','CodexSidebar','backends',`${version}-${executableHash.slice(0,16)}`),archive;
for(let i=0;i<args.length;i++){if(args[i]==='--destination'&&args[i+1])destination=resolve(args[++i]);else if(args[i]==='--archive'&&args[i+1])archive=resolve(args[++i]);else throw Error('Usage: node scripts/setup-backend.mjs [--destination directory] [--archive official.tar.gz]');}
if(process.platform!=='win32'||process.arch!=='x64')throw Error('This preview supports Windows x64 only.');
const hash=async path=>{const h=createHash('sha256');for await(const bytes of createReadStream(path))h.update(bytes);return h.digest('hex');};
const exists=async path=>{try{await access(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const target=join(destination,'codex.exe');
if(await exists(target)){if(await hash(target)!==executableHash)throw Error('Existing backend differs; choose a new directory. Nothing was overwritten.');console.log('Verified existing backend: '+target);process.exit(0);}
const temporary=await mkdtemp(join(tmpdir(),'codex-sidebar-setup-'));
try{
 if(!archive){archive=join(temporary,'backend.tar.gz');console.log('Downloading supported official backend…');const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('Download failed: '+response.status);await pipeline(Readable.fromWeb(response.body),createWriteStream(archive,{flags:'wx'}));}
 if(await hash(archive)!==archiveHash)throw Error('Archive SHA-256 mismatch; nothing installed.');
 const result=spawnSync('tar.exe',['-xzf',archive,'-C',temporary],{encoding:'utf8',windowsHide:true,timeout:60000});if(result.error||result.status!==0)throw result.error??Error('Archive extraction failed.');
 const executable=join(temporary,'codex-x86_64-pc-windows-msvc.exe');if(await hash(executable)!==executableHash)throw Error('Executable SHA-256 mismatch; nothing installed.');
 await mkdir(destination,{recursive:true});await copyFile(executable,target,constants.COPYFILE_EXCL);
 await writeFile(join(destination,'source.json'),JSON.stringify({version,url,sha256:executableHash},null,2)+'\n',{flag:'wx'});
 console.log('Installed verified backend: '+target);console.log('Next: run this executable with "login" to use the official sign-in flow.');
}finally{
 const rel=relative(resolve(tmpdir()),resolve(temporary));if(!isAbsolute(rel)&&!rel.startsWith('..')&&rel.startsWith('codex-sidebar-setup-'))await rm(temporary,{recursive:true,force:true});
}
