import type {PageState} from '../page-model';
import {mapStateImages,IMAGE_RESOURCE_BATCH_CHARACTERS,IMAGE_RESOURCE_PART_TIMEOUT_MS,type ImageStateAck,type ImageStateBundle,type ImageStatePart} from '../image-state-types';
import {safeImageSource} from './image-preview';

/** Shared by all listeners in this page; resources live only as long as the current state needs them. */
export class ImageStateReceiver {
 private connection=-1;
 private sequence=0;
 private sources=new Map<string,string>();
 private pending:{connectionId:number;sequence:number;total:number;next:number;valid:boolean;sources:Map<string,string>}|undefined;
 private timer:ReturnType<typeof setTimeout>|undefined;
 constructor(private acknowledge:(message:ImageStateAck)=>void){}
 private clearPending(){clearTimeout(this.timer);this.timer=undefined;this.pending=undefined;}
 private identity(value:{connectionId:number;sequence:number}){return Number.isSafeInteger(value.connectionId)&&value.connectionId>=0&&Number.isSafeInteger(value.sequence)&&value.sequence>=1;}
 private older(value:{connectionId:number;sequence:number},than:{connectionId:number;sequence:number}){return value.connectionId<than.connectionId||value.connectionId===than.connectionId&&value.sequence<than.sequence;}
 private stage(part:ImageStatePart){
  if(!this.identity(part)||this.older(part,{connectionId:this.connection,sequence:this.sequence+1})||this.pending&&this.older(part,this.pending))return;
  if(!this.pending||part.connectionId!==this.pending.connectionId||part.sequence!==this.pending.sequence){this.clearPending();this.pending={connectionId:part.connectionId,sequence:part.sequence,total:part.total,next:0,valid:true,sources:new Map()};}
  const pending=this.pending;
  if(!pending.valid)return;
  if(!Number.isSafeInteger(part.total)||part.total<2||part.total!==pending.total||part.index!==pending.next||part.index>=part.total||!Array.isArray(part.resources)||!part.resources.length){pending.valid=false;pending.sources.clear();return;}
  let characters=0;for(const resource of part.resources){if(!resource||!/^[a-f0-9]{64}$/.test(resource.key)||!safeImageSource(resource.src)||pending.sources.has(resource.key)){pending.valid=false;break;}characters+=resource.src.length;pending.sources.set(resource.key,resource.src);}
  if(part.resources.length>1&&characters>IMAGE_RESOURCE_BATCH_CHARACTERS)pending.valid=false;
  if(!pending.valid){pending.sources.clear();clearTimeout(this.timer);}else{pending.next++;clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.pending===pending){pending.valid=false;pending.sources.clear();this.timer=undefined;}},IMAGE_RESOURCE_PART_TIMEOUT_MS);}
 }
 receive(message:any):any{
  if(message?.type==='image-state-part'){this.stage(message);return;}
  if(message?.type==='image-state-abort'){
   if(this.pending&&message.connectionId===this.pending.connectionId&&message.sequence===this.pending.sequence){this.connection=message.connectionId;this.sequence=message.sequence;this.sources.clear();this.clearPending();}return;
  }
  if(message?.type!=='state')return message;
  if(!message.imageResources){this.sources.clear();this.clearPending();return message;}
  const bundle=message.imageResources as ImageStateBundle,state=message.state as PageState;
  if(!state||!Array.isArray(state.items)||!Number.isSafeInteger(bundle.connectionId)||bundle.connectionId<0||bundle.connectionId!==state.connectionId||!Number.isSafeInteger(bundle.sequence)||bundle.sequence<1)return;
  if(bundle.connectionId<this.connection||bundle.connectionId===this.connection&&bundle.sequence<=this.sequence||this.pending&&this.older(bundle,this.pending))return;
  if(bundle.connectionId!==this.connection){this.sources.clear();this.sequence=0;this.connection=bundle.connectionId;}
  const pending=this.pending;this.clearPending();
  const available=new Map(this.sources),next=new Map<string,string>();let valid=Array.isArray(bundle.resources),resources=bundle.resources;
  if(bundle.parts!==undefined){valid=valid&&resources.length===0&&Number.isSafeInteger(bundle.parts)&&bundle.parts>=2&&!!pending&&pending.connectionId===bundle.connectionId&&pending.sequence===bundle.sequence&&pending.valid&&pending.total===bundle.parts&&pending.next===bundle.parts;resources=valid?[...pending!.sources].map(([key,src])=>({key,src})):[];}
  if(valid)for(const resource of resources){
   if(!resource||! /^[a-f0-9]{64}$/.test(resource.key)||!safeImageSource(resource.src)||available.has(resource.key)&&available.get(resource.key)!==resource.src){valid=false;continue;}
   available.set(resource.key,resource.src);
  }
  const restored=mapStateImages(state,image=>{
   const {resourceKey,...metadata}=image;
   if(resourceKey===undefined)return metadata;
   const src=valid&&/^[a-f0-9]{64}$/.test(resourceKey)?available.get(resourceKey):undefined;
   if(src){next.set(resourceKey,src);return {...metadata,src};}
   valid=false;return {...metadata,src:undefined,error:'图片资源未确认；请刷新核对'};
  });
  this.sources=next;this.sequence=bundle.sequence;
  this.acknowledge({type:'image-state-ack',connectionId:bundle.connectionId,sequence:bundle.sequence,ok:valid});
  const {imageResources,...rest}=message;return {...rest,state:restored};
 }
 dispose(){this.sources.clear();this.clearPending();}
}
