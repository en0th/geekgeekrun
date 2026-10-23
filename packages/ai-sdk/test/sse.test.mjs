import test from 'node:test';
import assert from 'node:assert/strict';
import { SseParser, readSse, SseSession, IncompleteStreamError, ProtocolError, HttpError, isAppDone, WorkModeSignalTracker, detectWorkMode, ZhijueAIClient } from '../dist/index.js';

const encode=new TextEncoder();
const stream=(text,chunk=7)=>new ReadableStream({start(controller){const bytes=encode.encode(text);for(let i=0;i<bytes.length;i+=chunk)controller.enqueue(bytes.slice(i,i+chunk));controller.close();}});
const response=(text,chunk=7)=>new Response(stream(text,chunk),{headers:{'Content-Type':'text/event-stream'}});
const marker=(type,role='assistant')=>({o:'add',v:{id:1,author:{role},content:{content_type:'multi_part',parts:[{content_type:type}]}}});
const packet=(event,data)=>`${event===undefined?'':`event: ${event}\n`}data: ${typeof data==='string'?data:JSON.stringify(data)}\n\n`;

test('SSE preserves absent event, multiline data, empty data, CRLF splits, BOM and UTF8',async()=>{
  const input='\uFEFF: fixture\r\nevent: delta\r\nid: 7\r\nretry: 1000\r\ndata: {"text":"中😀"}\r\n\r\ndata: first\ndata: second\n\ndata:\n\n';
  const frames=[];for await(const frame of readSse(stream(input,1)))frames.push(frame);
  assert.deepEqual(frames,[{event:'delta',id:'7',retry:1000,data:'{"text":"中😀"}'},{data:'first\nsecond'},{data:''}]);
});

test('EOF discards an unterminated event; CR-only complete delimiters are accepted',()=>{
  const parser=new SseParser();assert.deepEqual(parser.push('data: [DONE]'),[]);assert.deepEqual(parser.finish(),[]);
  const cr=new SseParser();assert.deepEqual(cr.push('data: x\r\r'),[]);assert.deepEqual(cr.finish(),[{data:'x'}]);
});

test('SSE frame limit applies to actual accumulated frame, not whole multi-frame chunk',()=>{
  const parser=new SseParser(30);assert.equal(parser.push('data: x\n\n'.repeat(100)).length,100);
  assert.throws(()=>parser.push('data: '+ 'a'.repeat(31)),ProtocolError);
});

test('DONE is consumer-profile dependent and named preempting events do not finish',()=>{
  assert.equal(isAppDone({data:'[DONE]'},'main'),true);
  assert.equal(isAppDone({event:'message',data:'[DONE]'},'main'),true);
  for(const name of ['delta','notice','control','retry_error'])assert.equal(isAppDone({event:name,data:'[DONE]'},'main'),false);
  assert.equal(isAppDone({event:'recommend_condition',data:'[DONE]'},'recommend'),false);
  assert.equal(isAppDone({event:'message',data:'[DONE]'},'resume'),false);
  assert.equal(isAppDone({data:'[DONE]'},'resume'),true);
  assert.equal(isAppDone({data:'[DONE]'},'job-match'),false);
});

test('work-mode detector matches bounded non-user content traversal; add last wins',()=>{
  const tracker=new WorkModeSignalTracker();
  assert.equal(tracker.observeDelta(marker('douzi_work_mode_job_seeking')),'JOB_SEEKING');
  assert.equal(tracker.observeDelta(marker('data_market_matching','user')),null);
  assert.equal(tracker.peek(),'JOB_SEEKING');
  assert.equal(tracker.observeDelta({o:'patch',v:marker('data_market_matching').v}),null);
  assert.equal(tracker.observeDelta(marker('douzi_work_mode_market_matching')),'MARKET_WATCHING');
  assert.equal(tracker.consume(),'MARKET_WATCHING');assert.equal(tracker.consume(),null);
  let content={content_type:'data_market_matching'};for(let i=0;i<9;i++)content={child:content};
  assert.equal(detectWorkMode({author:{role:'assistant'},content}),null);
});

test('mode signal consumes only on accepted DONE; no work-mode/toggle requests are automatic',async()=>{
  const requests=[];
  const data=packet('delta',marker('douzi_work_mode_job_seeking'))+packet('delta',marker('data_market_matching'))+packet(undefined,'[DONE]');
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',fetch:async(url,init)=>{requests.push({url,init});return response(data,1);}});
  const session=client.userSay({content:{content_type:'text',parts:[{text:'fixture'}]},agent_hint:{conversionType:'DOUZI'}});
  assert.equal(requests.length,0);
  const events=[];for await(const event of session)events.push(event);
  assert.equal(events.at(-1).done,true);assert.equal(events.at(-1).workModeSignal,'MARKET_WATCHING');
  const done=await session.completion;
  assert.equal(done.termination,'done');assert.equal(done.workModeSignal,'MARKET_WATCHING');assert.equal(done.eventCount,3);
  assert.equal(requests.length,1);assert.equal(new URL(requests[0].url).pathname,'/wapi/partners/v2/chat/userSay');
});

test('EOF is incomplete, preserves unconsumed signal, and cannot be reported as DONE',async()=>{
  const session=new SseSession(async()=>response(packet('delta',marker('data_market_matching'))));
  await assert.rejects(async()=>{for await(const event of session){assert.equal(event.done,false);}},IncompleteStreamError);
  const summary=await session.completion;
  assert.equal(summary.termination,'eof');assert.equal(summary.sawDone,false);assert.equal(summary.pendingWorkMode,'MARKET_WATCHING');
  const named=new SseSession(async()=>response(packet('notice','[DONE]')));
  await assert.rejects(async()=>{for await(const ignored of named){}},IncompleteStreamError);
});

test('job-match EOF is normal transport completion and still does not imply a DONE ACK',async()=>{
  const session=new SseSession(async()=>response(packet('score',{score:70})),{profile:'job-match'});
  const events=[];for await(const event of session)events.push(event);
  assert.equal(events[0].event,'score');assert.equal((await session.completion).termination,'eof');assert.equal((await session.completion).sawDone,false);
});

test('consumer break cancels reader without implicitly requesting stopSay',async()=>{
  let cancelled=false,calls=0;
  const body=new ReadableStream({start(c){c.enqueue(encode.encode(packet('delta',{o:'append',v:'fixture'})));},cancel(){cancelled=true;}});
  const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',fetch:async()=>{calls++;return new Response(body,{headers:{'Content-Type':'text/event-stream'}});}});
  const session=client.userSay({content:{content_type:'text'}});
  for await(const event of session){break;}
  assert.equal(cancelled,true);assert.equal((await session.completion).termination,'consumer_cancelled');assert.equal(calls,1);
});

test('abort before consumption and HTTP failures cannot resolve as successful streams',async()=>{
  let requests=0;const session=new SseSession(async()=>{requests++;return response(packet(undefined,'[DONE]'));});
  session.abort(new DOMException('fixture abort','AbortError'));
  await assert.rejects(async()=>{for await(const ignored of session){}},/fixture abort/);
  assert.equal(requests,0);assert.equal((await session.completion).termination,'aborted');
  const failure=new SseSession(async()=>new Response('fixture fail',{status:500}));
  await assert.rejects(async()=>{for await(const ignored of failure){}},HttpError);
  assert.equal((await failure.completion).termination,'error');
});

test('return/throw before first next settle completion and never start network',async()=>{
  let calls=0;const make=()=>new SseSession(async()=>{calls++;return response(packet(undefined,'[DONE]'));});
  const cancelled=make();await cancelled[Symbol.asyncIterator]().return();
  assert.equal((await cancelled.completion).termination,'consumer_cancelled');
  const thrown=make();await assert.rejects(thrown[Symbol.asyncIterator]().throw(new Error('fixture')),/fixture/);
  assert.equal((await thrown.completion).termination,'error');
  const aborted=make();const iterator=aborted[Symbol.asyncIterator]();aborted.abort();
  assert.equal((await aborted.completion).termination,'aborted');await iterator.return();
  assert.equal(calls,0);
});

test('SSE transport cleans only empty top-level body fields, retaining nested values',async()=>{
  let body;const client=new ZhijueAIClient({baseUrl:'https://sdk.invalid',fetch:async(url,init)=>{body=JSON.parse(init.body);return response(packet(undefined,'[DONE]'));}});
  const session=client.userSay({content:{content_type:'text'},empty:'',absent:null,zero:0,flag:false,metadata:{empty:'',nil:null}});
  for await(const ignored of session){}
  assert.equal(Object.hasOwn(body,'empty'),false);assert.equal(Object.hasOwn(body,'absent'),false);
  assert.equal(body.zero,0);assert.equal(body.flag,false);assert.deepEqual(body.metadata,{empty:'',nil:null});
});

test('App last-data-line compatibility and standard multiline mode preserve the same raw frame',async()=>{
  const text='data: {"ignored":1}\ndata: {"kept":2}\n\ndata: [DONE]\n\n';
  const app=new SseSession(async()=>response(text));const a=[];for await(const event of app)a.push(event);
  assert.deepEqual(a[0].data,{kept:2});assert.equal(a[0].raw.data,'{"ignored":1}\n{"kept":2}');
  const standard=new SseSession(async()=>response(text),{dataLineMode:'standard'});const b=[];for await(const event of standard)b.push(event);
  assert.equal(b[0].data,'{"ignored":1}\n{"kept":2}');assert.equal(b[0].raw.data,a[0].raw.data);
});
