/** DSH165 opening preferences, counted with Codex public history entries. */
export type HistoryPreferences={loadAll:boolean;maxMessages:number};
export const HISTORY_LOAD_DEFAULTS:Readonly<HistoryPreferences>=Object.freeze({loadAll:true,maxMessages:3000});
export function validHistoryMaximum(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=500&&value<=20000;}
