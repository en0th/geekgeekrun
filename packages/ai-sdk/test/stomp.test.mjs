import test from 'node:test';
import assert from 'node:assert/strict';
import { StompParser, encodeStompFrame, AssistantStompClient, ProtocolError } from '../dist/index.js';

test('STOMP byte parser handles split UTF8, embedded NUL, CRLF, escaped headers and heartbeat',()=>{
  const frame={command:'MESSAGE',headers:{destination:'/user/queue/douzi','fixture:key':'value\nline\\tail'},body:'中😀\0tail'};
  const wire='\n'+encodeStompFrame(frame)+'\r\n';const bytes=new TextEncoder().encode(wire);
  const parser=new StompParser(),frames=[];
  for(const byte of bytes)frames.push(...parser.push(new Uint8Array([byte])));
  assert.equal(frames.length,1);assert.equal(frames[0].body,frame.body);assert.equal(frames[0].headers['fixture:key'],frame.headers['fixture:key']);
  assert.equal(frames[0].headers['content-length'],String(new TextEncoder().encode(frame.body).length));
  const crlf=new StompParser();assert.equal(crlf.push('CONNECTED\r\nversion:1.2\r\n\r\n\0')[0].command,'CONNECTED');
  assert.throws(()=>new StompParser().push('MESSAGE\ncontent-length:1\n\nxx'),ProtocolError);
});

class FakeSocket extends EventTarget {
  readyState=0; sent=[];closed=false;
  send(data){this.sent.push(data);}
  close(){this.readyState=3;this.closed=true;this.dispatchEvent(new Event('close'));}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
  message(data){this.dispatchEvent(new MessageEvent('message',{data}));}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('assistant connects with separate upgrade and CONNECT auth and subscribes exact destination',async()=>{
  const socket=new FakeSocket(),pushes=[],errors=[];let factory;
  const client=new AssistantStompClient({url:'wss://sdk.invalid/wapi/user/ws',getAccessToken:()=> 'fixture-token',
    heartbeatOutgoing:0,heartbeatIncoming:0,
    webSocketFactory:(url,protocols,headers)=>{factory={url,protocols,headers};return socket;},
    onMessage:push=>pushes.push(push),onError:error=>errors.push(error)});
  assert.equal(socket.sent.length,0);
  const connected=client.connect();await tick();socket.open();
  const connectFrame=new StompParser().push(socket.sent[0])[0];
  assert.equal(factory.headers.Authorization,'Bearer fixture-token');assert.deepEqual(factory.protocols,['v12.stomp','v11.stomp','v10.stomp']);
  assert.equal(connectFrame.command,'CONNECT');assert.equal(connectFrame.headers.Authorization,'Bearer fixture-token');
  socket.message('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0');await connected;
  const subscribe=new StompParser().push(socket.sent[1])[0];assert.equal(subscribe.headers.destination,'/user/queue/douzi');
  socket.message(encodeStompFrame({command:'MESSAGE',headers:{destination:'/user/queue/douzi'},body:JSON.stringify({eventType:'workbench.updated',data:{agentProxyEnabled:false}})}));
  await tick();assert.equal(pushes[0].data.data.agentProxyEnabled,false);assert.equal(errors.length,0);
  client.close();assert.equal(client.connected,false);assert.equal(socket.closed,true);
  const commands=socket.sent.slice(2).flatMap(wire=>new StompParser().push(wire).map(f=>f.command));assert.deepEqual(commands,['UNSUBSCRIBE','DISCONNECT']);
});

test('STOMP ERROR rejects connect and never synthesizes application success',async()=>{
  const socket=new FakeSocket(),errors=[];
  const client=new AssistantStompClient({url:'wss://sdk.invalid/wapi/user/ws',webSocketFactory:()=>socket,onMessage:()=>{},onError:e=>errors.push(e),heartbeatOutgoing:0,heartbeatIncoming:0});
  const promise=client.connect();await tick();socket.open();socket.message('ERROR\nmessage:fixture denied\n\nfixture failure\0');
  await assert.rejects(promise,ProtocolError);assert.equal(client.connected,false);assert.equal(errors.length,1);assert.equal(socket.closed,true);
});

test('cancelled old token resolution cannot clear a newer connection latch',async()=>{
  const pending=[];let calls=0;const socket=new FakeSocket();
  const client=new AssistantStompClient({url:'wss://sdk.invalid/wapi/user/ws',getAccessToken:()=>{calls++;return new Promise(resolve=>pending.push(resolve));},webSocketFactory:()=>socket,onMessage:()=>{},heartbeatOutgoing:0,heartbeatIncoming:0});
  const old=client.connect();const oldRejected=assert.rejects(old,ProtocolError);await tick();client.close();
  const current=client.connect();await tick();pending[0]('fixture-old');await oldRejected;
  const same=client.connect();assert.equal(calls,2);
  pending[1]('fixture-new');await tick();socket.open();socket.message('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0');
  await Promise.all([current,same]);assert.equal(client.connected,true);client.close();
});

test('fatal parser error after CONNECTED clears transport state and closes socket',async()=>{
  const socket=new FakeSocket(),errors=[];
  const client=new AssistantStompClient({url:'wss://sdk.invalid/wapi/user/ws',webSocketFactory:()=>socket,onMessage:()=>{},onError:e=>errors.push(e),heartbeatIncoming:0,heartbeatOutgoing:0});
  const opened=client.connect();await tick();socket.open();socket.message('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0');await opened;
  socket.message('MESSAGE\ncontent-length:x\n\nbody\0');await tick();
  assert.equal(client.connected,false);assert.equal(socket.closed,true);assert.equal(errors.length,1);
});

test('adapter send failure during close cannot skip state or physical cleanup',async()=>{
  const socket=new FakeSocket(),errors=[];
  const client=new AssistantStompClient({url:'wss://sdk.invalid/wapi/user/ws',webSocketFactory:()=>socket,onMessage:()=>{},onError:e=>errors.push(e),heartbeatIncoming:0,heartbeatOutgoing:0});
  const opened=client.connect();await tick();socket.open();socket.message('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0');await opened;
  socket.send=()=>{throw new Error('fixture send failed');};
  assert.doesNotThrow(()=>client.close());assert.equal(client.connected,false);assert.equal(socket.closed,true);assert.equal(errors.length,1);
});
