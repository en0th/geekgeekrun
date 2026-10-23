import type { BossSocket, BossWebSocketFactory } from './boss.js';

export interface NodeBossWebSocket {
  send(data:Uint8Array):void;
  close():void;
  on(event:string,listener:(...args:any[])=>void):unknown;
}
export interface NodeBossWebSocketConstructor {
  new(url:string,protocols:string[],options:{headers:Record<string,string>}):NodeBossWebSocket;
  prototype:{on:(...args:any[])=>unknown};
}
/** Inject an EventEmitter-style Node WebSocket implementation supporting upgrade
 * headers. The native browser/global WebSocket constructor is not compatible.
 * No library or connection is created until the returned factory is invoked.
 */
export function createBossNodeWebSocketFactory(Constructor:NodeBossWebSocketConstructor):BossWebSocketFactory {
  if(typeof Constructor?.prototype?.on!=='function')throw new TypeError('A Node-style WebSocket constructor with upgrade-header support is required');
  return (url,options)=>{
    const socket=new Constructor(url,[...options.protocols],{headers:{...options.headers}});
    const adapter:BossSocket={
      send:bytes=>socket.send(bytes),close:()=>socket.close(),
      onOpen:listener=>{socket.on('open',listener);},
      onMessage:listener=>{socket.on('message',data=>listener(data));},
      onError:listener=>{socket.on('error',listener);},
      onClose:listener=>{socket.on('close',(code,reason)=>listener({code,reason}));},
    };
    return adapter;
  };
}
