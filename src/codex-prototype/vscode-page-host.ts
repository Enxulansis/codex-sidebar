import type {PageHost} from './page-host';
import {ImageStateReceiver} from './display/image-state';

declare function acquireVsCodeApi(): {postMessage(message: unknown): void;setState(value:unknown):void};

/** One document lease covers every command and receipt, independently of request IDs. */
export function createVsCodePageHost(): PageHost {
  const api = acquireVsCodeApi();
  const pageId=crypto.randomUUID();
  const images=new ImageStateReceiver(message=>api.postMessage({...message,pageId}));
  const decoded=new WeakMap<MessageEvent,MessageEvent|null>();
  let offlineRestorable=false;
  const listeners=new Map<(event:MessageEvent)=>void,(event:MessageEvent)=>void>();
  const messages:PageHost['messages']={
    addEventListener(_type,listener){
      if(listeners.has(listener))return;
      const receive=(event:MessageEvent)=>{if(event.data?.pageId!==pageId)return;
        if(!decoded.has(event)){const data=images.receive(event.data);decoded.set(event,data===undefined?null:data===event.data?event:new MessageEvent('message',{data,origin:event.origin,lastEventId:event.lastEventId,source:event.source,ports:[...event.ports]}));}
        const resolved=decoded.get(event);if(!resolved)return;
        // Only the synthetic editor needs a serializer marker. Bodies and drafts stay
        // in their scoped host stores; no runtime or approval state is serialized.
        if(!offlineRestorable&&resolved.data?.type==='state'&&resolved.data.state?.offlinePreview===true){api.setState({offlineExperience:true});offlineRestorable=true;}
        listener(resolved);};
      listeners.set(listener,receive);window.addEventListener('message',receive);
    },
    removeEventListener(_type,listener){const receive=listeners.get(listener);if(receive)window.removeEventListener('message',receive);listeners.delete(listener);}
  };
  window.addEventListener('pagehide',()=>{for(const receive of listeners.values())window.removeEventListener('message',receive);listeners.clear();images.dispose();},{once:true});
  return {postMessage: message => api.postMessage({...message as object,pageId}), messages};
}
