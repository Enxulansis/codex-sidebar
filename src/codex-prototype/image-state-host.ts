import {createHash} from 'node:crypto';
import type {PageState} from './page-model';
import {mapStateImages,IMAGE_RESOURCE_BATCH_CHARACTERS,type ImageStateBundle,type ImageStateAck,type ImageStatePart} from './image-state-types';

/** Parts are staged by one document; only the final state can reach consumers or earn an ACK. */
export function* imageStateMessages<T>(packed:{state:T;imageResources:ImageStateBundle}):Generator<ImageStatePart|({type:'state'}&typeof packed)>{
 const {imageResources:bundle}=packed,parts:ImageStateBundle['resources'][]=[];let part:ImageStateBundle['resources']=[],characters=0;
 for(const resource of bundle.resources){if(part.length&&characters+resource.src.length>IMAGE_RESOURCE_BATCH_CHARACTERS){parts.push(part);part=[];characters=0;}part.push(resource);characters+=resource.src.length;}
 if(part.length)parts.push(part);
 if(parts.length<=1){yield{type:'state',...packed};return;}
 for(const[index,resources]of parts.entries())yield{type:'image-state-part',connectionId:bundle.connectionId,sequence:bundle.sequence,index,total:parts.length,resources};
 yield{type:'state',state:packed.state,imageResources:{...bundle,resources:[],parts:parts.length}};
}

/** One page document; retains only the latest resource keys, never source bytes. */
export class ImageStateSender {
 private connection=-1;
 private sequence=0;
 private confirmed=0;
 private keys=new Set<string>();
 private latest=new Set<string>();
 private repairUsed=false;
 private answered=false;
 prepare<T extends Pick<PageState,'items'|'connectionId'>>(state:T):{state:T;imageResources:ImageStateBundle}{
  if(state.connectionId!==this.connection){this.connection=state.connectionId;this.sequence=0;this.confirmed=0;this.keys.clear();this.latest.clear();this.repairUsed=false;}
  const reusable=this.confirmed===this.sequence?this.keys:new Set<string>(),resources=new Map<string,string>(),bySource=new Map<string,string>(),latest=new Set<string>();
  const wire=mapStateImages(state,image=>{
   if(!image.src)return image;
   let key=bySource.get(image.src);if(!key){key=createHash('sha256').update(image.src).digest('hex');bySource.set(image.src,key);}
   latest.add(key);if(!reusable.has(key))resources.set(key,image.src);
   const {src,...metadata}=image;return {...metadata,resourceKey:key};
  });
  this.latest=latest;this.sequence++;this.answered=false;
  return {state:wire,imageResources:{connectionId:this.connection,sequence:this.sequence,resources:[...resources].map(([key,src])=>({key,src}))}};
 }
 /** A queued post is insufficient. Only the latest exact page/connection ACK admits reuse. */
 acknowledge(message:ImageStateAck):boolean{
  if(message?.type!=='image-state-ack'||message.connectionId!==this.connection||message.sequence!==this.sequence||!Number.isSafeInteger(message.sequence)||typeof message.ok!=='boolean'||this.answered)return false;
  this.answered=true;
  if(message.ok){this.keys=this.latest;this.confirmed=this.sequence;this.repairUsed=false;return false;}
  this.keys.clear();this.confirmed=0;
  if(this.repairUsed)return false;this.repairUsed=true;return true;
 }
}
