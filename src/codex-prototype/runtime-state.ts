/** Narrow public display projection; never advances a session or performs recovery. */
export function runtimeState(active:{status:string;error:string;errorTurnId:string|undefined;model:string;auth:string;busy:boolean;sendOutcomeUncertain:boolean;isConnected:boolean}|undefined,ready:boolean,connecting:boolean,connectionError:string){
 return {status:active?.status??'未连接',error:active?.error||connectionError,errorTurnId:active?.errorTurnId,model:active?.model??'',auth:active?.auth??'',busy:active?.busy??false,ready:ready&&!connecting&&active?.isConnected===true,connecting,needsRecovery:active?.sendOutcomeUncertain??false};
}
