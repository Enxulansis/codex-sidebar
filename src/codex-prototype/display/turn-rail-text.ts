import type {DisplaySettings} from '../display-settings';
/** DSH165 railOrdinalText/railSnippetOf; all surfaces share the visible-node table. */
export function railOrdinalText(num:number,total:number|string,style:DisplaySettings['railNumberStyle']='compact'){
 if(style==='legacy')return '第 '+num+' 轮';
 if(style==='full')return '第 '+num+'/'+total+' 个节点';
 return num+'/'+total;
}
export function railSnippetOf(text:string,maximum=40){const flat=String(text||'').replace(/\s+/g,' ').trim();if(!flat)return '（附件/空消息）';return flat.length>maximum?flat.slice(0,maximum)+'…':flat;}
