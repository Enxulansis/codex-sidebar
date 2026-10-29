import {isPageItem,type PageState} from './page-model';
import type {DisplayImage} from './display/image-preview';

/** Transport references confer no image export or filesystem authority. */
export type ImageResource=DisplayImage&{resourceKey?:string};
/** Small batches avoid cloning a whole history's data URLs in a single message.
 * A single checked image may exceed this target, but keeps the existing 5 MiB input limit. */
export const IMAGE_RESOURCE_BATCH_CHARACTERS=1024*1024;
export const IMAGE_RESOURCE_PART_TIMEOUT_MS=15000;
export type ImageStateBundle={connectionId:number;sequence:number;resources:{key:string;src:string}[];parts?:number};
export type ImageStatePart={type:'image-state-part';connectionId:number;sequence:number;index:number;total:number;resources:ImageStateBundle['resources']};
export type ImageStateAck={type:'image-state-ack';connectionId:number;sequence:number;ok:boolean};
export function mapStateImages<T extends Pick<PageState,'items'>>(state:T,convert:(image:ImageResource)=>ImageResource):T{
 return {...state,items:state.items.map(row=>{
  if(!isPageItem(row.item,'userMessage'))return row;
  return {...row,item:{...row.item,content:row.item.content.map(input=>input.type==='localImage'&&input.displayImage?{...input,displayImage:convert(input.displayImage)}:input)}};
 })};
}
