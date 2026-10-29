import {publicPatchStats,type PatchStats} from './changed-files';
export const PUBLIC_DIFF_CHARACTERS=2_000_000;
export const PUBLIC_DIFF_HUNK_OPTIONS=128;
export type PublicDiffHunk={beforePath:string;afterPath:string;oldStart:number;oldCount:number;newStart:number;newCount:number;before:string;after:string};
export type PublicDiffOption=Omit<PublicDiffHunk,'before'|'after'>&{index:number};
export type ParsedPublicDiff={stats:PatchStats|null;hunks:PublicDiffHunk[];hunkCount:number};
/** Exact, independently labelled patch hunks; missing lines never become a full-file baseline. */
export function parsePublicDiff(diff:string):ParsedPublicDiff{
 const stats=publicPatchStats(diff),hunks:PublicDiffHunk[]=[];if(!stats)return{stats:null,hunks,hunkCount:0};
 let beforePath='',afterPath='',oldRemaining=0,newRemaining=0,current:PublicDiffHunk|undefined,oldLines:string[]=[],newLines:string[]=[],oldEof=false,newEof=false,last='',hunkCount=0;
 const finish=()=>{if(current&&beforePath&&afterPath&&hunks.length<PUBLIC_DIFF_HUNK_OPTIONS){current.before=oldLines.join('\n')+(oldLines.length&&!oldEof?'\n':'');current.after=newLines.join('\n')+(newLines.length&&!newEof?'\n':'');hunks.push(current);}current=undefined;};
 for(const line of diff.split(/\r?\n/)){
  const h=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
  if(h){finish();hunkCount++;oldRemaining=h[2]===undefined?1:Number(h[2]);newRemaining=h[4]===undefined?1:Number(h[4]);const oldStart=Number(h[1]),newStart=Number(h[3]);current=Number.isSafeInteger(oldStart+oldRemaining)&&Number.isSafeInteger(newStart+newRemaining)&&(oldRemaining===0||oldStart>0)&&(newRemaining===0||newStart>0)&&beforePath.length<=1024&&afterPath.length<=1024?{beforePath,afterPath,oldStart,oldCount:oldRemaining,newStart,newCount:newRemaining,before:'',after:''}:undefined;oldLines=[];newLines=[];oldEof=newEof=false;last='';continue;}
  if(line==='\\ No newline at end of file'&&current){if(last==='-'||last===' ')oldEof=true;if(last==='+'||last===' ')newEof=true;continue;}
  if(oldRemaining||newRemaining){last=line[0]??'';if(last==='-'||last===' '){if(oldEof)current=undefined;oldLines.push(line.slice(1));oldRemaining--;}if(last==='+'||last===' '){if(newEof)current=undefined;newLines.push(line.slice(1));newRemaining--;}continue;}
  finish();if(line.startsWith('diff --git ')){beforePath=afterPath='';}else if(line.startsWith('--- ')){beforePath=line.slice(4).split('\t')[0]!;}else if(line.startsWith('+++ ')){afterPath=line.slice(4).split('\t')[0]!;}
 }
 finish();return{stats,hunks,hunkCount};
}
export function publicDiffOptions(parsed:ParsedPublicDiff):PublicDiffOption[]{return parsed.hunks.map(({before:_before,after:_after,...hunk},index)=>({...hunk,index}));}
