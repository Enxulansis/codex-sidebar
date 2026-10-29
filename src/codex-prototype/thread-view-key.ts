/** Existing v1 fold keys all begin with a thread id; malformed keys are never swept. */
export function viewKeyThread(key:unknown):string|undefined {
  if(typeof key!=='string')return;
  try{const value=JSON.parse(key);return Array.isArray(value)&&typeof value[0]==='string'?value[0]:undefined;}catch{return;}
}
