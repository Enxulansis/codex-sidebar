import {lstat,realpath,open,opendir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {FILE_LIMITS,fileArguments,relativeFilePath,type FileResult,type WorkspaceFileTool} from './workspace-files-contract';
/** No writes, network access or subprocesses. Hidden paths, dependencies and links are excluded. */
export class WorkspaceFiles{
 private constructor(private root:string){}
 static async create(root:string){return new WorkspaceFiles(await realpath(root));}
 private async checked(path:string){
  let target=this.root;
  for(const part of path==='.'?[]:path.split('/')){target=join(target,part);if((await lstat(target)).isSymbolicLink())throw Error('不支持链接路径');}
  const canonical=await realpath(target),rel=relative(this.root,canonical);
  if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel)||canonical!==resolve(target))throw Error('路径已改变或越过工作区');
  return canonical;
 }
 async call(tool:WorkspaceFileTool,input:unknown):Promise<FileResult>{
  const args=fileArguments(tool,input),target=await this.checked(args.path);
  if(tool==='list_files'){
   const entries:{name:string;kind:'file'|'directory'}[]=[];let truncated=false,visited=0;
   const dir=await opendir(target);
   for await(const entry of dir){
    if(++visited>2000){truncated=true;break;}
    try{relativeFilePath(entry.name);}catch{continue;}
    if(entry.isSymbolicLink()||!entry.isFile()&&!entry.isDirectory())continue;
    if(entries.length===FILE_LIMITS.entries){truncated=true;break;}
    entries.push({name:entry.name,kind:entry.isDirectory()?'directory':'file'});
   }
   await this.checked(args.path);entries.sort((a,b)=>a.name.localeCompare(b.name));
   return{kind:'directory',path:args.path,entries,truncated};
  }
  const admitted=await lstat(target);if(!admitted.isFile()||admitted.nlink!==1||admitted.size>FILE_LIMITS.bytes)throw Error('仅支持不超过 1 MiB 的普通文本文件');
  await this.checked(args.path);
  const handle=await open(target,'r');
  try{
   const before=await handle.stat();if(!before.isFile()||before.nlink!==1||before.size>FILE_LIMITS.bytes||before.ino!==admitted.ino||before.dev!==admitted.dev||before.ctimeMs!==admitted.ctimeMs)throw Error('文件在打开期间改变，请重新读取');
   const buffer=Buffer.alloc(FILE_LIMITS.bytes+1);let length=0;
   while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
   const after=await handle.stat(),pathStat=await lstat(await this.checked(args.path));
   if(length>FILE_LIMITS.bytes||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||pathStat.ino!==before.ino||pathStat.dev!==before.dev||pathStat.nlink!==1)throw Error('文件在读取期间改变，请重新读取');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length));if(text.includes('\0'))throw Error('不支持二进制文件');
   const lines=text.replace(/\r\n/g,'\n').split('\n'),start=args.startLine!;
   if(lines.some(line=>line.length>FILE_LIMITS.characters))throw Error('单行文本超过显示上限');
   if(start>lines.length)throw Error('起始行超出文件范围');
   const selected:string[]=[];let size=0,index=start-1;
   for(;index<lines.length&&selected.length<FILE_LIMITS.lines;index++){
    const line=lines[index]!;
    const added=line.length+(selected.length?1:0);if(size+added>FILE_LIMITS.characters)break;selected.push(line);size+=added;
   }
   return{kind:'text',path:args.path,text:selected.join('\n'),startLine:start,nextLine:index<lines.length?index+1:null,truncated:index<lines.length};
  }finally{await handle.close();}
 }
}
