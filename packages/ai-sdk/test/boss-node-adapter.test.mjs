import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBossNodeWebSocketFactory } from '../dist/index.js';

test('Node adapter explicitly supplies MQTT subprotocol and upgrade credentials without implicit connection',()=>{
  let instance,constructions=0;
  class MockNodeWebSocket extends EventEmitter{
    constructor(url,protocols,options){super();constructions++;instance=this;Object.assign(this,{url,protocols,options});}
    send(data){this.sent=data;}
    close(){this.closed=true;}
  }
  const factory=createBossNodeWebSocketFactory(MockNodeWebSocket);assert.equal(constructions,0);
  const socket=factory('wss://offline.invalid/chatws',{protocols:['mqtt'],headers:{wt:'fixture',wt2:'fixture2',zp_product_id:'fixture-product'}});
  assert.deepEqual(instance.protocols,['mqtt']);assert.equal(instance.options.headers.wt2,'fixture2');
  let opened=false,data,closed;socket.onOpen(()=>{opened=true;});socket.onMessage(value=>{data=value;});socket.onClose(value=>{closed=value;});
  instance.emit('open');instance.emit('message',new Uint8Array([1,2]),true);instance.emit('close',1000,'fixture');
  assert.equal(opened,true);assert.deepEqual(data,new Uint8Array([1,2]));assert.equal(closed.code,1000);
  socket.send(new Uint8Array([3]));assert.deepEqual(instance.sent,new Uint8Array([3]));socket.close();assert.equal(instance.closed,true);
});

test('browser-style constructor is rejected before it can open a socket without headers',()=>{
  let constructed=false;class BrowserStyle{constructor(){constructed=true;}}
  assert.throws(()=>createBossNodeWebSocketFactory(BrowserStyle),/Node-style/);assert.equal(constructed,false);
});
