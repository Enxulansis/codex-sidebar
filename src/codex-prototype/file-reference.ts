/** DSH 165 fileReference/appendFileText syntax; no filesystem or execution authority. */
export type FileReference={path:string;line?:number};
const exact=/^((?:[A-Za-z]:[\\/]|\/)?(?:[A-Za-z0-9_@.+~-]+[\\/])*[A-Za-z0-9_@.+~-]+\.[A-Za-z][A-Za-z0-9]{0,9})(?::(\d+))?(?::\d+)?$/;
const scan=/[A-Za-z0-9_@.+~:\\/-]+/g;
const validLine=(value:number)=>Number.isSafeInteger(value)&&value>=1;
export function validReferencePath(path:unknown):path is string {
 if(typeof path!=='string'||!path||path.length>4096||/[\x00-\x1f<>"|?*]/.test(path)||/^(?:\\\\|\/\/)/.test(path))return false;
 const withoutDrive=path.replace(/^[A-Za-z]:[\\/]/,'');return !withoutDrive.includes(':')&&!/^\s|\s$/.test(path);
}
export function fileReference(value:string):FileReference|undefined {
 if(value.length>4096)return;
 const match=exact.exec(value);if(!match||!validReferencePath(match[1]))return;
 const line=match[2]===undefined?undefined:Number(match[2]);if(line!==undefined&&!validLine(line))return;
 return {path:match[1]!,...(line===undefined?{}:{line})};
}
/** Explicit Markdown file targets may contain encoded spaces/Unicode and #L positions. */
export function fileHref(value:unknown):FileReference|undefined {
 if(typeof value!=='string'||!value||value.length>12300)return;let path=value,line:number|undefined;
 try{
  if(/^file:/i.test(path)){const url=new URL(path);if(url.protocol!=='file:'||url.hostname||url.search)return;path=url.pathname+url.hash;if(/^\/[A-Za-z]:\//.test(path))path=path.slice(1);}
  else if(/^[a-z][\w+.-]*:\/\//i.test(path)||/^(?:command|data|javascript|vscode):/i.test(path))return;
  path=decodeURIComponent(path);
 }catch{return;}
 const hash=/#L(\d+)(?:C\d+)?$/.exec(path),suffix=hash??/:(\d+)(?::\d+)?$/.exec(path);
 if(suffix){line=Number(suffix[1]);if(!validLine(line))return;path=path.slice(0,suffix.index);}
 if(path.includes('#')||!validReferencePath(path))return;
 return{path,...(line===undefined?{}:{line})};
}
export const fileReferenceId=(reference:FileReference)=>JSON.stringify([reference.path,reference.line??null]);
export function textFileReferences(text:string):{start:number;end:number;reference:FileReference}[]{
 const out:{start:number;end:number;reference:FileReference}[]=[];
 for(const m of text.matchAll(scan)){const value=m[0].replace(/\.+$/,''),start=m.index!,end=start+value.length;if(!value.includes('.')||value.length>4096)continue;
  // Do not turn part of a URI, longer filename or unsupported path into authority.
  if(start&&/[\p{L}\p{N}_@.+~:\\/-]/u.test(text[start-1]!)||end<text.length&&/[\p{L}\p{N}_@+~:\\/-]/u.test(text[end]!))continue;
  const reference=fileReference(value);if(reference)out.push({start,end,reference});
 }return out;
}
export type ReferenceItem={type:string;id:string;text?:unknown;aggregatedOutput?:unknown;changes?:unknown};
