import type {ReferenceImageSource} from '../reference-image';
import {IMAGE_SOURCE_BYTES,sourceImage} from '../image-formats';
import {sourceBytes} from './image-decode';
/** Validate host bytes before any decoder or DOM resource can consume them. */
export async function checkedReferenceImage(value:ReferenceImageSource,current:()=>boolean){
 if(!current())throw Error('图片引用所属页面或线程已失效');
 if(!value||typeof value.name!=='string'||typeof value.base64!=='string'||value.base64.length>Math.ceil(IMAGE_SOURCE_BYTES/3)*4||typeof value.mime!=='string'||value.mime.length>32||typeof value.animated!=='boolean'||!Number.isSafeInteger(value.size)||value.size<1||value.size>IMAGE_SOURCE_BYTES||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('图片引用来源信息无效');
 const src=`data:${value.mime};base64,${value.base64}`,source=sourceBytes(src);if(source.bytes.length!==value.size||btoa(atob(value.base64))!==value.base64)throw Error('图片引用编码或长度不匹配');
 const info=sourceImage(value.name,source.bytes);if(info.mime!==value.mime||info.animated!==value.animated)throw Error('图片引用格式或动画来源不匹配');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',source.bytes as Uint8Array<ArrayBuffer>))).map(v=>v.toString(16).padStart(2,'0')).join('');
 if(!current())throw Error('图片引用所属页面或线程已失效');if(digest!==value.sha256)throw Error('图片引用内容与宿主摘要不一致');return{src,bytes:source.bytes,info};
}
