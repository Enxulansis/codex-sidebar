/** Optional owned preview driver only. No API bridge, RPC, model, tool or persistence. */
export function installActivityDemo(){
 const root=document.querySelector('header');if(!root||document.getElementById('motion-demo-play'))return;
 const button=document.createElement('button');button.id='motion-demo-play';button.type='button';button.textContent='播放合成工作态';button.hidden=true;button.title='仅回放显示状态；不运行模型或命令';root.append(button);
 let timers:ReturnType<typeof setTimeout>[]=[],epoch=0,base:any;
 const current=()=> (window as any).__prototypeState,owner=(s:any)=>JSON.stringify([s?.threadId,s?.connectionId]);
 const clear=()=>{epoch++;for(const timer of timers)clearTimeout(timer);timers=[];base=undefined;button.textContent='播放合成工作态';};
 const emit=(state:any)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'state',state}}));
 const finish=()=>{const source=base,identity=owner(source),settings=current()?.copySettings;clear();if(source&&identity===owner(current()))emit({...source,copySettings:settings,status:'合成回放结束；没有执行模型或命令'});};
 const observe=()=>{const s=current();button.hidden=!/^offline-motion-[ab]$/.test(s?.threadId??'');if(base&&(owner(base)!==owner(s)||s?.activityReplayId!==epoch))clear();};
 window.addEventListener('message',e=>{if(e.data?.type==='state')observe();});
 button.onclick=()=>{if(base){finish();return;}const s=current();if(!/^offline-motion-[ab]$/.test(s?.threadId??''))return;clear();base=s;const token=epoch,identity=owner(s),valid=()=>token===epoch&&owner(current())===identity;
  const stage=(text:boolean)=>{if(!valid())return;const source=base;const rows=source.items.filter((v:any)=>text||v.item.type!=='agentMessage').map((v:any)=>v.item.type==='commandExecution'?{...v,complete:text,item:{...v.item,status:text?'completed':'inProgress',exitCode:text?0:null}}:v.item.type==='agentMessage'?{...v,complete:false}:v);emit({...source,copySettings:current()?.copySettings,busy:true,status:'生成中',items:rows,turns:source.turns.map((t:any)=>({...t,status:'inProgress'})),activityReplayId:token});};
  button.textContent='停止合成回放';stage(false);timers.push(setTimeout(()=>stage(true),1500),setTimeout(()=>{if(valid())finish();},7000));};
 // The regular stop control ends this display-only playback, never sends a stop RPC.
 document.getElementById('stop')?.addEventListener('click',e=>{if(base){e.preventDefault();e.stopImmediatePropagation();finish();}},true);
 window.addEventListener('pagehide',clear,{once:true});observe();
}
