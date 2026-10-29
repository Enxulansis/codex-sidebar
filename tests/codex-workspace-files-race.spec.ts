import {it,expect,vi} from 'vitest';import {mkdtemp,mkdir,writeFile,rename,symlink,rm,open} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
vi.mock('node:fs/promises',async load=>{const original=await load<typeof import('node:fs/promises')>();return{...original,open:vi.fn(original.open)};});
import {WorkspaceFiles} from '../src/codex-prototype/workspace-files';
it('detects a directory replaced at open before reading bytes from a different file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'workspace-race-')),project=join(root,'project'),outside=join(root,'outside');await mkdir(project);await mkdir(join(project,'dir'));await mkdir(outside);await writeFile(join(project,'dir','file.txt'),'inside');await writeFile(join(outside,'file.txt'),'PRIVATE_OUTSIDE');const files=await WorkspaceFiles.create(project),original=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open;let read:any;
 vi.mocked(open).mockImplementationOnce(async(...args:any[])=>{await rename(join(project,'dir'),join(project,'saved'));await symlink(outside,join(project,'dir'),'junction');const handle=await original(args[0],args[1]);read=vi.spyOn(handle,'read');await rm(join(project,'dir'));await rename(join(project,'saved'),join(project,'dir'));return handle;});
 try{await expect(files.call('read_file',{path:'dir/file.txt'})).rejects.toThrow('打开期间改变');expect(read).not.toHaveBeenCalled();}finally{vi.mocked(open).mockReset();await rm(root,{recursive:true,force:true});}
});
