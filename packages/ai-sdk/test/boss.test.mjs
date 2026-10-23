import test from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.BOSS_TEST_MODULE_BASE ?? new URL('../dist/', import.meta.url).href;
const { BossHttpClient, BossImClient, BossAckTimeoutError, BossConnectionError } = await import(`${base}boss.js`);
const { ZhijueAIClient } = await import(`${base}client.js`);
const { BossProtocolError, encodeBossProtocol, decodeBossProtocol, createBossTextProtocol, createBossReadProtocol, createBossPresenceProtocol } = await import(`${base}boss-protobuf.js`);
const { BossMqttDecoder, encodeBossMqttConnect, encodeBossMqttPublish, encodeBossMqttSubscribe, encodeBossExtendedPuback, encodeBossMqttPuback, encodeBossMqttControl } = await import(`${base}boss-mqtt.js`);
const hex = bytes => Buffer.from(bytes).toString('hex');
const bytes = value => Uint8Array.from(Buffer.from(value, 'hex'));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const credentials = { token: 'zp-fixture', wt2: 'ticket +/fixture', zpUserId: '1', productId: 'p-fixture', identity: 0 };

test('active text/read proto bytes match manually derived tag fixtures', () => {
  const protocol = createBossTextProtocol({ from: '1', to: '2', cmid: '3', time: '4', text: '中' });
  assert.equal(hex(encodeBossProtocol(protocol)), '08011a210a04080138001204080238001801200328043209080110011a03e4b8ad58036000');
  const decoded = decodeBossProtocol(bytes('08011a210a04080138001204080238001801200328043209080110011a03e4b8ad58036000'));
  assert.equal(decoded.messages[0].body.text, '中');
  assert.equal(decoded.messages[0].from.uid, '1');
  assert.equal(decoded.messages[0].mid, '3');
  assert.equal(hex(encodeBossProtocol(createBossReadProtocol({ userId: '2', messageId: '3', readTime: '4' }))), '080642080802100318042800');
  assert.equal(decodeBossProtocol(bytes('080642080802100318042800')).messageRead[0].sync, false);
});
test('protobuf keeps int64 lossless, checks required fields and preserves unknown fields', () => {
  const large = '9007199254740993';
  const data = encodeBossProtocol(createBossTextProtocol({ from: large, to: '2', cmid: large, time: '4', text: 'x' }));
  const withUnknown = new Uint8Array([...data, 0xa0, 0x06, 0x07]); // unknown tag 100, varint 7
  const decoded = decodeBossProtocol(withUnknown);
  assert.equal(decoded.messages[0].cmid, large);
  assert.equal(decoded.$unknownFields[0].tag, 100);
  assert.equal(hex(encodeBossProtocol(decoded)), hex(withUnknown));
  assert.throws(() => encodeBossProtocol({ type: 1, messages: [{ type: 1 }] }), /Missing required/);
  assert.throws(() => encodeBossProtocol(createBossTextProtocol({ from: 9007199254740992, to: '2', cmid: '3', time: '4', text: 'x' })), /safe Number/);
  assert.throws(() => decodeBossProtocol(bytes('08011a05')), BossProtocolError);
  assert.throws(() => createBossPresenceProtocol('2147483648'), /int32/);
  const text = createBossTextProtocol({ from: '1', to: '2', cmid: '3', time: '4', text: 'x', securityId: 'ignored', jobId: 77 });
  assert.equal(text.messages[0].securityId, undefined);
});
test('MQTT CONNECT, SUBSCRIBE and retained QoS1 PUBLISH match wire fixtures', () => {
  assert.equal(hex(encodeBossMqttConnect({ clientId: 'c', username: 't|0', password: 'w', keepAlive: 25 })), '101500044d51545404c200190001630003747c30000177');
  assert.equal(hex(encodeBossMqttSubscribe(1)), '8209000100046368617401');
  assert.equal(hex(encodeBossMqttPublish({ packetId: 7, payload: bytes('0102') })), '330a00046368617400070102');
});
test('MQTT decoder handles fragmentation, coalescing and lossless extended ACK', () => {
  const decoder = new BossMqttDecoder();
  assert.deepEqual(decoder.push(bytes('200200')), []);
  const packets = decoder.push(bytes('00401200110020000000000001ffffffffffffffff40020011'));
  assert.deepEqual(packets[0], { type: 'connack', sessionPresent: false, returnCode: 0 });
  assert.deepEqual(packets[1], { type: 'puback', packetId: 17, extended: true, cmid: '9007199254740993', mid: '18446744073709551615' });
  assert.deepEqual(packets[2], { type: 'puback', packetId: 17, extended: false });
  assert.equal(decoder.bufferedBytes, 0);
  assert.throws(() => decoder.push(bytes('4080808080')), /four bytes/);
  assert.throws(() => new BossMqttDecoder(8).push(bytes('3310000463686174')), /configured limit/);
  assert.throws(() => new BossMqttDecoder().push(bytes('4003000100')), /extension length/);
});

class MockSocket {
  sent = []; closed = 0;
  openListener; messageListener; errorListener; closeListener;
  send(data) { this.sent.push(data.slice()); }
  close() { this.closed++; }
  onOpen(listener) { this.openListener = listener; }
  onMessage(listener) { this.messageListener = listener; }
  onError(listener) { this.errorListener = listener; }
  onClose(listener) { this.closeListener = listener; }
  open() { this.openListener(); }
  receive(data) { this.messageListener(data); }
}
async function connected(options = {}) {
  const socket = new MockSocket(); let factoryArguments; let factoryCalls = 0;
  const im = new BossImClient({ credentials, autoPresence: false, keepAliveSeconds: 0, ackTimeoutMs: 1000, now: () => 4, ...options, webSocketFactory: (url, init) => { factoryArguments = { url, init }; factoryCalls++; return socket; } });
  const promise = im.connect();
  assert.equal(im.state, 'connecting');
  assert.throws(() => im.sendText({ to: '2', text: 'before connack' }), /CONNACK/);
  socket.open();
  assert.equal(socket.sent[0][0], 0x10);
  socket.receive(bytes('20020000')); await promise;
  return { im, socket, factoryArguments, factoryCalls: () => factoryCalls };
}
test('connection is explicit and waits for CONNACK, carrying separate ZP auth', async () => {
  const { im, socket, factoryArguments } = await connected();
  try {
    assert.equal(im.state, 'connected');
    const url = new URL(factoryArguments.url);
    assert.equal(url.searchParams.get('wt'), credentials.wt2);
    assert.equal(url.searchParams.get('zp_product_id'), credentials.productId);
    assert.deepEqual(factoryArguments.init.protocols, ['mqtt']);
    assert.deepEqual(factoryArguments.init.headers, { wt: credentials.wt2, wt2: credentials.wt2, zp_product_id: credentials.productId });
    assert.equal(factoryArguments.init.headers.Authorization, undefined);
    const handle = im.sendText({ to: '2', text: ' hi ', cmid: '9007199254740993' });
    const publish = new BossMqttDecoder().push(socket.sent.at(-1))[0];
    const protocol = decodeBossProtocol(publish.payload);
    assert.equal(protocol.messages[0].body.text, 'hi');
    assert.equal(protocol.messages[0].mid, handle.cmid);
    assert.equal(protocol.messages[0].to.uid, '2');
    socket.receive(encodeBossExtendedPuback(handle.packetId, handle.cmid, '9007199254741001'));
    const ack = await handle.brokerAck;
    assert.deepEqual(ack, { state: 'brokerAck', packetId: handle.packetId, cmid: '9007199254740993', mid: '9007199254741001' });
  } finally { im.disconnect(); }
});
test('standard PUBACK is broker_received only and expires without application delivery ACK or resend', async () => {
  const { im, socket, factoryCalls } = await connected({ ackTimeoutMs: 35 });
  try {
    const handle = im.sendText({ to: '2', text: 'x', cmid: '123' }); let confirmed = false;
    void handle.brokerAck.then(() => { confirmed = true; }, () => undefined);
    socket.receive(encodeBossMqttPuback(handle.packetId));
    assert.equal((await handle.brokerReceived).extended, false);
    await tick(); assert.equal(confirmed, false);
    const sent = socket.sent.length;
    await assert.rejects(handle.brokerAck, error => error instanceof BossAckTimeoutError && error.brokerReceived === true);
    assert.equal(socket.sent.length, sent); assert.equal(factoryCalls(), 1);
  } finally { im.disconnect(); }
});
test('extension validates original cmid and packetId; unrelated ACK cannot settle a send', async () => {
  const { im, socket } = await connected();
  try {
    const unmatched = []; im.on('unmatchedAck', value => unmatched.push(value));
    const handle = im.sendText({ to: '2', text: 'x', cmid: '123' });
    socket.receive(encodeBossExtendedPuback(65000, '123', '456')); await tick();
    assert.equal(unmatched.length, 1);
    socket.receive(encodeBossExtendedPuback(handle.packetId, '124', '456'));
    await assert.rejects(handle.brokerAck, /original cmid/);
    await assert.rejects(handle.read, /original cmid/);
  } finally { im.disconnect(); }
});
test('read receipts use server mid, peer/source and non-sync semantics, including read-before-ACK', async () => {
  const { im, socket } = await connected();
  try {
    const handle = im.sendText({ to: '2', text: 'x', cmid: '123' });
    const read = createBossReadProtocol({ userId: '2', messageId: '9007199254741001', readTime: '99' });
    socket.receive(encodeBossMqttPublish({ packetId: 44, payload: encodeBossProtocol(read), qos: 1, retained: false }));
    await tick();
    socket.receive(encodeBossExtendedPuback(handle.packetId, '123', '9007199254741001'));
    const receipt = await handle.read;
    assert.equal(receipt.mid, '9007199254741001'); assert.equal(receipt.cmid, '123');
    assert.ok(socket.sent.some(data => hex(data) === '4002002c'));
  } finally { im.disconnect(); }
});
test('read send has a broker-only receipt; inbound QoS2 delivers the entire batch after PUBREL', async () => {
  const { im, socket } = await connected();
  try {
    const reading = im.sendRead({ userId: '2', messageId: '456' });
    const sent = new BossMqttDecoder().push(socket.sent.at(-1))[0];
    assert.equal(decodeBossProtocol(sent.payload).type, 6);
    socket.receive(encodeBossMqttPuback(sent.packetId));
    assert.equal((await reading).state, 'broker_received');
    const a = createBossTextProtocol({ from: '2', to: '1', cmid: '101', text: 'a', time: '4' });
    const b = createBossTextProtocol({ from: '2', to: '1', cmid: '102', text: 'b', time: '4' });
    const messages = []; im.on('message', message => messages.push(message));
    socket.receive(encodeBossMqttPublish({ packetId: 77, qos: 2, payload: encodeBossProtocol({ type: 1, messages: [...a.messages, ...b.messages] }) }));
    await tick(); assert.equal(messages.length, 0); assert.equal(hex(socket.sent.at(-1)), '5002004d');
    socket.receive(encodeBossMqttControl('pubrel', 77)); await tick();
    assert.deepEqual(messages.map(message => message.body.text), ['a', 'b']);
    assert.equal(hex(socket.sent.at(-1)), '7002004d');
    socket.receive(encodeBossMqttControl('pubrel', 77)); await tick(); assert.equal(messages.length, 2);
  } finally { im.disconnect(); }
});
test('disconnect and rejected CONNACK do not replay writes or leave unhandled receipt promises', async () => {
  const unhandled = []; const observer = error => unhandled.push(error);
  process.on('unhandledRejection', observer);
  try {
    const { im, socket, factoryCalls } = await connected();
    const handle = im.sendText({ to: '2', text: 'x', cmid: '123' });
    socket.receive(encodeBossExtendedPuback(handle.packetId, '123', '456')); await handle.brokerAck;
    im.disconnect(); await tick(); await tick(); assert.deepEqual(unhandled, []); assert.equal(factoryCalls(), 1);
    const rejectedSocket = new MockSocket();
    const rejected = new BossImClient({ credentials, autoPresence: false, keepAliveSeconds: 0, webSocketFactory: () => rejectedSocket });
    const ready = rejected.connect(); rejectedSocket.open(); rejectedSocket.receive(bytes('20020005'));
    await assert.rejects(ready, error => error instanceof BossConnectionError && error.connackCode === 5);
    assert.equal(rejected.state, 'disconnected');
  } finally { process.off('unhandledRejection', observer); }
});
test('HTTP credentials/history/peer/exchange preserve auth layers and exact endpoint bodies', async () => {
  const calls = [];
  const client = new ZhijueAIClient({ baseUrl: 'https://mock.invalid', getAccessToken: () => 'app-fixture', fetch: async (url, init) => {
    const path = new URL(url).pathname; calls.push({ url: new URL(url), init });
    const response = path.endsWith('/token/h5') ? { code: 0, result: { userId: '1', token: 'zp-fixture' } }
      : path.endsWith('/ticket/h5') ? { code: 0, result: { webTicket2: 'wt-fixture', productId: 'p-fixture' } }
      : path.endsWith('/history') ? { code: 1000, result: null, message: 'removed' }
      : path.endsWith('/listByJobIds') ? { code: 0, result: [{ zpBossUid: '99', jobSnapshot: { bossId: '2', jobId: '7' } }] }
      : { code: 0, result: { ok: true } };
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const boss = new BossHttpClient(client);
  assert.deepEqual(await boss.getCredentials(), { token: 'zp-fixture', wt2: 'wt-fixture', zpUserId: '1', productId: 'p-fixture', identity: 0 });
  assert.equal(calls[0].url.searchParams.get('forceRefresh'), 'false');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer app-fixture');
  assert.equal((await boss.history({ userId: '1', friendId: '2', maxMsgId: '0' })).code, 1000);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { userId: 1, friendId: 2, identity: 0, userSource: 0, friendSource: 0, pageSize: 10 });
  const resolved = await boss.resolvePeer({ jobId: '7', friendId: '99' });
  assert.equal(resolved.friendId, '2');
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { ids: [7], includeDeleted: true });
  await boss.acceptExchange({ userId: '1', friendId: '2', requestDialogMid: '456', exchangeType: 4, resumeId: '7' });
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { userId: 1, identity: 0, userSource: 0, friendId: 2, friendSource: 0, exchangeType: 4, requestDialogMid: 456, extendJson: '{"resumeId":"7"}' });
  assert.equal(typeof boss.sendText, 'undefined');
});
test('HTTP unsafe integer IDs reject instead of silently using rounded values', async () => {
  const client = new ZhijueAIClient({ baseUrl: 'https://mock.invalid', fetch: async () => new Response('{"code":0,"result":{"userId":9007199254740993,"token":"t","webTicket2":"w"}}', { status: 200 }) });
  await assert.rejects(new BossHttpClient(client).getCredentials(), /unsafe integer/);
});
test('every BOSS HTTP method forwards the pinned session epoch, including both credential reads', async () => {
  const calls = [];
  const boss = new BossHttpClient({ request: async (method, path, options) => {
    calls.push({ method, path, options });
    const result = path.endsWith('/token/h5') ? { userId: '1', token: 't' }
      : path.endsWith('/ticket/h5') ? { webTicket2: 'w', productId: 'p' }
      : path.endsWith('/listByJobIds') ? [{ jobSnapshot: { jobId: '7', bossId: '2' } }]
      : path.endsWith('/delivery/list') || path.endsWith('/attachment/list') ? [] : {};
    return { raw: { code: 0, result } };
  } });
  let epochReads = 0;
  await boss.getCredentials({ get sessionEpoch() { return ++epochReads; } });
  assert.equal(epochReads, 1);
  assert.deepEqual(calls.slice(0, 2).map(call => call.options.sessionEpoch), [1, 1]);
  calls.length = 0; const options = { sessionEpoch: 17 };
  await boss.history({ userId: '1', friendId: '2' }, options);
  await boss.message('3', options);
  await boss.deliveryRecords({}, options);
  await boss.lookupDeliveryJobs(['7'], options);
  await boss.resolvePeer({ jobId: '7' }, options);
  await boss.hasWechat(options);
  await boss.resumeAttachments(options);
  await boss.acceptExchange({ userId: '1', friendId: '2', requestDialogMid: '3', exchangeType: 4, resumeId: 'opaque/source-ref' }, options);
  await boss.rejectExchange({ userId: '1', friendId: '2', requestDialogMid: '3', exchangeType: 2 }, options);
  assert.equal(calls.length, 9);
  assert.ok(calls.every(call => call.options.sessionEpoch === 17));
  assert.equal(JSON.parse(calls[7].options.body.extendJson).resumeId, 'opaque/source-ref');
});

test('disconnecting from connection state callbacks cannot leave an orphan socket',async()=>{
  let calls=0;const im=new BossImClient({credentials,autoPresence:false,keepAliveSeconds:0,webSocketFactory:()=>{calls++;return new MockSocket();}});
  im.on('state',state=>{if(state==='connecting')im.disconnect();});
  await assert.rejects(im.connect(),BossConnectionError);assert.equal(calls,0);assert.equal(im.state,'disconnected');
  const socket=new MockSocket();const second=new BossImClient({credentials,autoPresence:false,keepAliveSeconds:0,webSocketFactory:()=>socket});
  second.on('state',state=>{if(state==='connected')second.disconnect();});
  const ready=second.connect();socket.open();socket.receive(bytes('20020000'));await assert.rejects(ready,BossConnectionError);
  assert.equal(socket.sent.filter(packet=>packet[0]===0x82).length,0);assert.equal(socket.closed,1);
});

test('late old socket messages cannot block a new CONNACK receive queue',{timeout:1000},async()=>{
  const sockets=[];let conversions=0;
  class SlowBlob extends Blob{arrayBuffer(){conversions++;return new Promise(()=>{});}}
  const im=new BossImClient({credentials,autoPresence:false,keepAliveSeconds:0,webSocketFactory:()=>{const socket=new MockSocket();sockets.push(socket);return socket;}});
  try{
    const first=im.connect();sockets[0].open();sockets[0].receive(bytes('20020000'));await first;im.disconnect();
    const second=im.connect();sockets[0].receive(new SlowBlob(['old packet']));sockets[1].open();sockets[1].receive(bytes('20020000'));await second;
    assert.equal(im.state,'connected');assert.equal(conversions,0);
  }finally{im.disconnect();}
});

test('credentials are snapshotted and cannot change the sending UID under an authenticated socket',async()=>{
  const mutable={...credentials};const {im,socket}=await connected({credentials:mutable});
  try{mutable.zpUserId='9';mutable.token='different';const sent=im.sendText({to:'2',text:'fixture',cmid:'123'});
    const packet=new BossMqttDecoder().push(socket.sent.at(-1))[0];assert.equal(decodeBossProtocol(packet.payload).messages[0].from.uid,'1');
    socket.receive(encodeBossExtendedPuback(sent.packetId,sent.cmid,'456'));await sent.brokerAck;
  }finally{im.disconnect();}
});

test('unsigned ACK mids and a smaller explicit cmid cannot poison the next signed client ID',async()=>{
  for(const serverMid of ['9223372036854775808','9223372036854775807']){
    const {im,socket}=await connected();
    try{const first=im.sendText({to:'2',text:'a'});socket.receive(encodeBossExtendedPuback(first.packetId,first.cmid,serverMid));await first.brokerAck;
      const small=im.sendText({to:'2',text:'b',cmid:'1'});const next=im.sendText({to:'2',text:'c'});
      assert.ok(BigInt(next.cmid)>BigInt(first.cmid));assert.notEqual(next.cmid,small.cmid);
    }finally{im.disconnect();}
  }
});
