import type {ChangedFile} from './changed-files';
export const CHANGED_REVIEW_KEY='codexPrototype.changedReviewed.v1',CHANGED_REVIEW_CAP=2000;
/** Full literal source identity; view folds and line statistics cannot stand in for patch contents. */
export function changedReviewPayload(file:ChangedFile){return JSON.stringify([file.path,file.movePath,file.sources.map(source=>[source.itemId,source.path,source.movePath,source.kind,source.diff])]);}
export function changedReviewKey(thread:string,turn:string,digest:string){const key=JSON.stringify([thread,turn,digest]);if(!validChangedReviewKey(key))throw Error('变更身份不可用');return key;}
export function validChangedReviewKey(key:unknown):key is string{if(typeof key!=='string'||key.length>500)return false;try{const v=JSON.parse(key);return Array.isArray(v)&&v.length===3&&v.slice(0,2).every(p=>typeof p==='string'&&p.length>0&&p.length<=150)&&typeof v[2]==='string'&&/^[a-f0-9]{64}$/.test(v[2])&&JSON.stringify(v)===key;}catch{return false;}}
export function validChangedReviewKeys(value:unknown):value is string[]{return Array.isArray(value)&&value.length<=CHANGED_REVIEW_CAP&&value.every(validChangedReviewKey)&&new Set(value).size===value.length;}
