import type {Session} from './session';
import type {ThreadItem} from './protocol/v2/ThreadItem';
import type {DisplayImage} from './display/image-preview';
import type {PageItem,PageRow,PageState} from './page-model';
import type {DisplayFile} from './message-file-types';
import {publicToolDisplay} from './public-tool-display';
import {publicRecordDisplay,unavailableRecord} from './public-record-display';
import {publicQuestionRecord} from './public-questions';

const MAX_CONCURRENT_IMAGE_CHECKS=4;

/** Codex's public projection becomes display data here; execution stays in Session. */
async function displayItem(item:ThreadItem,threadId:string,turnId:string,checkImage:(path:string,id:string)=>Promise<DisplayImage>,files?:DisplayFile[],referenceIndex?:number,progress?:string):Promise<PageItem> {
  switch(item.type) {
    case 'agentMessage': {const questionRecord=publicQuestionRecord(item.questions);return {type:item.type,id:item.id,text:item.text,phase:item.phase,...(questionRecord?{questionRecord}:{})};}
    case 'userMessage': return {type:item.type,id:item.id,...(typeof item.clientId==='string'?{clientId:item.clientId}:{}),...(files?.length?{files}:{}),content:await Promise.all(item.content.map(async(input,index)=> {
      if(input.type==='text')return {type:input.type,text:input.text};
      if(input.type==='localImage')return {type:input.type,path:input.path,displayImage:await checkImage(input.path,JSON.stringify([threadId,turnId,item.id,index]))};
      return {type:input.type};
    })).then(inputs=>inputs.filter((_input,index)=>index!==referenceIndex))};
    case 'commandExecution': return {type:item.type,id:item.id,command:item.command,cwd:item.cwd,status:item.status,aggregatedOutput:item.aggregatedOutput,exitCode:item.exitCode,durationMs:item.durationMs};
    case 'fileChange': return {type:item.type,id:item.id,status:item.status,changes:item.changes.map(change=>({...change,kind:{...change.kind}}))};
    case 'plan': return {type:item.type,id:item.id,text:item.text};
    default: return publicToolDisplay(item,progress)??publicRecordDisplay(item)??unavailableRecord(item);
  }
}

export async function codexPageContent(active:Session|undefined,threadId:string,checkImage:(path:string,id:string)=>Promise<DisplayImage>):Promise<Pick<PageState,'items'|'turns'|'approvals'|'fileSourceNotice'|'userInputs'>> {
  // Verify each exact source once per publication, with bounded concurrent reads.
  // Never retain these checks across publications: files may change or disappear.
  let imageChecks=0;
  const waitingImages:Array<()=>void>=[];
  const checkedSources=new Map<string,Promise<DisplayImage>>();
  const readProjectedImage=async(path:string,id:string):Promise<DisplayImage>=>{
    if(imageChecks<MAX_CONCURRENT_IMAGE_CHECKS)imageChecks++;
    else await new Promise<void>(resolve=>waitingImages.push(resolve));
    try{return await checkImage(path,id);}
    finally{
      const next=waitingImages.shift();
      if(next)next(); // Transfer the occupied slot directly to the next check.
      else imageChecks--;
    }
  };
  const checkProjectedImage=async(path:string,id:string):Promise<DisplayImage>=>{
    let pending=checkedSources.get(path);
    if(!pending){pending=readProjectedImage(path,id);checkedSources.set(path,pending);}
    const image=await pending;
    // Source bytes can be shared, but message bindings and their metadata cannot.
    return {...image,id,...(image.originHint?{originHint:{...image.originHint}}:{})};
  };
  // Capture row metadata before asynchronous resource checks, as in the original host.
  const rows=[...(active?.projection.items.values()??[])].filter(row=>row.item.type!=='reasoning').map(row=>({...row,forkReason:active?.forkReason(row.turnId,row.item.id),revertReason:active?.revertReason(row.turnId,row.item.id),displayMeta:active?.projection.metrics.forTurn(active.projection.turns.get(row.turnId),row.item.type==='agentMessage')}));
  const turns=[...(active?.projection.turns.values()??[])].map(turn=>({id:turn.id,status:turn.status,itemsView:turn.itemsView,durationMs:turn.durationMs,errorMessage:turn.error?.message??''}));
  const approvals=Promise.all([...(active?.approvals.values()??[])].map(async request=>({id:request.id,callbackToken:request.callbackToken,params:{...request.params},acceptance:await active!.approvalAcceptance(request.id,request.callbackToken)})));
  const userInputs=structuredClone([...(active?.userInputs?.values()??[])]);
  const sourceFiles=threadId&&active?.fileSources?await active.fileSources.project(threadId,rows):undefined;
  const items:PageRow[]=await Promise.all(rows.map(async row=>({...row,item:await displayItem(row.item,threadId,row.turnId,checkProjectedImage,sourceFiles?.files.get(row.item.id),sourceFiles?.referenceIndexes.get(row.item.id),row.toolProgress)})));
  return {items,turns,approvals:await approvals,userInputs,...(sourceFiles?{fileSourceNotice:sourceFiles.notice}:{})};
}
