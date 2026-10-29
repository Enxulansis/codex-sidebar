/** Shared, bounded wire contract. Paths are relative to the selected workspace. */
export const WORKSPACE_FILES_SERVER='workspace_files';
export const WORKSPACE_FILE_TOOLS=['list_files','read_file'] as const;
export type WorkspaceFileTool=typeof WORKSPACE_FILE_TOOLS[number];
export const FILE_LIMITS={entries:100,bytes:1024*1024,characters:24000,lines:200} as const;
export function relativeFilePath(value:unknown):string{
 if(typeof value!=='string'||value.length>1024||/[\x00-\x1f\x7f:]/.test(value)||value.startsWith('/')||value.startsWith('\\'))throw Error('请输入工作区内的相对路径');
 const parts=value.replace(/\\/g,'/').split('/');
 if(parts.some(p=>p==='..'||p.startsWith('.')&&p!=='.'||p.endsWith(' ')||p.endsWith('.')&&p!=='.'||/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)||p.toLowerCase()==='node_modules'))throw Error('此路径不在只读服务支持范围内');
 return parts.filter(p=>p&&p!=='.').join('/')||'.';
}
export function fileArguments(tool:unknown,args:any):{path:string;startLine?:number}{
 if(!WORKSPACE_FILE_TOOLS.includes(tool as WorkspaceFileTool)||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>k!=='path'&&(tool!=='read_file'||k!=='startLine')))throw Error('文件读取参数无效');
 const path=relativeFilePath(args.path);
 if(tool==='list_files')return{path};
 const startLine=args.startLine??1;if(!Number.isSafeInteger(startLine)||startLine<1||startLine>FILE_LIMITS.bytes)throw Error('起始行无效');
 return{path,startLine};
}
export type FileResult={kind:'directory';path:string;entries:{name:string;kind:'file'|'directory'}[];truncated:boolean}|{kind:'text';path:string;text:string;startLine:number;nextLine:number|null;truncated:boolean};
export function checkedFileResult(value:any,tool:WorkspaceFileTool,args:{path:string;startLine?:number}):FileResult{
 if(!value||value.path!==args.path||typeof value.truncated!=='boolean')throw Error('文件回执未核对');
 if(tool==='list_files'){
  if(value.kind!=='directory'||!Array.isArray(value.entries)||value.entries.length>FILE_LIMITS.entries)throw Error('目录回执未核对');
  const seen=new Set<string>();const entries=value.entries.map((e:any)=>{if(!e||typeof e.name!=='string'||e.name.includes('/')||e.name.includes('\\')||relativeFilePath(e.name)!==e.name||seen.has(e.name)||!['file','directory'].includes(e.kind))throw Error('目录项未核对');seen.add(e.name);return{name:e.name,kind:e.kind};});
  return{kind:'directory',path:args.path,entries,truncated:value.truncated};
 }
 if(value.kind!=='text'||typeof value.text!=='string'||value.text.length>FILE_LIMITS.characters||value.startLine!==args.startLine||value.text.split('\n').length>FILE_LIMITS.lines||value.nextLine!==null&&(!Number.isSafeInteger(value.nextLine)||value.nextLine<=value.startLine)||value.truncated!==(value.nextLine!==null))throw Error('文本回执未核对');
 return{kind:'text',path:args.path,text:value.text,startLine:value.startLine,nextLine:value.nextLine,truncated:value.truncated};
}
