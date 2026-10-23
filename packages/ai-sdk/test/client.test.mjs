import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ZhijueAIClient, ENDPOINTS, AuthenticationError, BusinessError, HttpError, ProtocolError, extractEnvelope, serializeQuery,
  buildDouziText, buildModeSelection, buildAgentJobChat, buildRecommendText, buildResumeOptimizationInit, buildResumeOptimizationText,
  normalizeServerId, toProxyMode } from '../dist/index.js';

const origin = 'https://sdk.invalid';
const json = (raw,status=200)=>new Response(JSON.stringify(raw),{status,headers:{'Content-Type':'application/json','X-Fixture':'yes'}});
const makeClient = (fetch,extra={})=>new ZhijueAIClient({baseUrl:origin,fetch,...extra});

test('query serialization repeats arrays and omits nullish values',()=>{
  const query=serializeQuery({word:'中文 &?',ids:[1,null,'2',undefined],flag:false,none:null});
  const result=new URLSearchParams(query);
  assert.equal(result.get('word'),'中文 &?');
  assert.deepEqual(result.getAll('ids'),['1','2']);
  assert.equal(result.get('flag'),'false');assert.equal(result.has('none'),false);
  assert.ok(query.includes('%20'));assert.equal(query.includes('+'),false);
});

test('envelope extraction exactly distinguishes data null, result null and absence',()=>{
  assert.deepEqual(extractEnvelope({data:{x:1},result:{x:2}}),{x:1});
  assert.equal(extractEnvelope({data:null,result:0}),0);
  assert.equal(extractEnvelope({result:null}),null);
  assert.equal(extractEnvelope({only:'raw'}),undefined);
});

test('REST keeps raw fields, resolves caller token at request time, and has no implicit write',async()=>{
  const requests=[];let token='fixture-token-1';
  const client=makeClient(async(url,init)=>{requests.push({url:new URL(url),init});return json({code:0,result:{proxyMode:'AUTO_CHAT'},revision:'fixture-r1'});},
    {getAccessToken:()=>token,headers:{'X-App-Version':'2.3.0'}});
  assert.equal(requests.length,0);
  const result=await client.getWorkSettings();
  assert.deepEqual(result.data,{proxyMode:'AUTO_CHAT'});assert.equal(result.raw.revision,'fixture-r1');
  assert.equal(result.headers.get('x-fixture'),'yes');assert.equal(requests[0].init.headers.get('authorization'),'Bearer fixture-token-1');
  token='fixture-token-2';
  await client.setWorkMode('MARKET_WATCHING');
  assert.equal(requests.length,2);
  assert.deepEqual(JSON.parse(requests[1].init.body),{workMode:'MARKET_WATCHING'});
  assert.equal(requests[1].init.headers.get('authorization'),'Bearer fixture-token-2');
  assert.equal(requests[1].url.pathname,'/wapi/user/geek/agent/work-settings/work-mode');
  assert.equal(requests[1].init.credentials,'include');
  assert.equal(requests[1].init.cache,'no-store');
});

test('numeric business codes 0/200/4 and nonnumeric codes follow observed wrapper',async()=>{
  for(const code of [0,200,4,'401',undefined]){
    const client=makeClient(async()=>json({code,result:{ok:true}}));
    assert.equal((await client.bootstrap()).data.ok,true);
  }
});

test('HTTP401, business401 and business errors surface without retry',async()=>{
  for(const [raw,status,ErrorType] of [[{code:401},200,AuthenticationError],[{code:0},401,AuthenticationError],[{code:403,msg:'fixture denied'},200,BusinessError],[{message:'fixture failed'},500,HttpError]]){
    let calls=0;const client=makeClient(async()=>{calls++;return json(raw,status);});
    await assert.rejects(client.bootstrap(),error=>error instanceof ErrorType&&error.raw.code===raw.code&&error.status===status);
    assert.equal(calls,1);
  }
});

test('returnEnvelope and allowed business codes preserve no-more400 without bypassing401',async()=>{
  const raw={code:400,result:{fixture:'no-more'}};
  const client=makeClient(async()=>json(raw));
  const envelope=await client.call('chatJobTaskMore',{body:{id:1},returnEnvelope:true});
  assert.deepEqual(envelope.data,raw);assert.equal(envelope.raw.code,400);
  const allowed=await client.call('chatJobTaskMore',{body:{id:1},allowBusinessCodes:[400]});
  assert.deepEqual(allowed.data,raw.result);
  const auth=makeClient(async()=>json({code:401}));
  await assert.rejects(auth.bootstrap({returnEnvelope:true,allowBusinessCodes:[401]}),AuthenticationError);
});

test('paths are encoded and cross-origin paths are rejected before token can be sent',async()=>{
  const seen=[];const client=makeClient(async(url)=>{seen.push(new URL(url));return json({result:[]});});
  await client.conversation('1/2?x=3');
  assert.equal(seen[0].pathname,'/wapi/partners/v2/chat/conversation/1%2F2%3Fx%3D3');
  await assert.rejects(client.request('GET','//other.invalid/path'),TypeError);
  await assert.rejects(client.request('GET','https://other.invalid/path'),TypeError);
  assert.equal(seen.length,1);
  await assert.rejects(client.call('chatConversationGet'),/Missing path/);
});

test('all generated HTTP operations dispatch using mock fetch and retain open query/body fields',async()=>{
  const registry=JSON.parse(await readFile(new URL('../contracts/ai-api-catalog.json',import.meta.url),'utf8'));
  const http=registry.entries.filter(e=>e.include_in_sdk&&['GET','POST','PUT','DELETE','PATCH'].includes(e.method));
  assert.deepEqual(Object.keys(ENDPOINTS).sort(),http.map(e=>e.name).sort());
  const requests=[];
  const bases={};for(const def of Object.values(ENDPOINTS))if(def.base!=='api')bases[def.base]='https://external.invalid';
  const client=makeClient(async(url,init)=>{
    requests.push({url:new URL(url),init});
    return json({code:0,result:{file_id:'fixture-file',ok:true},revision:'fixture'});
  },{serviceBases:bases});
  for(const [name,def]of Object.entries(ENDPOINTS)){
    if(def.transport==='sse')continue;
    const path=Object.fromEntries((def.pathParams??[]).map(k=>[k,'fixture/segment']));
    const options={path,query:{fixture_extra:'kept'}};
    if(def.method!=='GET'){
      if(def.transport==='multipart'){options.body=new FormData();options.body.append('file',new Blob(['fixture']),'fixture.txt');}
      else options.body={fixture_extra:'kept'};
    }
    const response=await client.call(name,options);
    const last=requests.at(-1);
    assert.equal(last.init.method,def.method,name);
    assert.equal(last.url.searchParams.get('fixture_extra'),'kept',name);
    assert.equal(response.status,200,name);
    for(const [key,value]of Object.entries(def.defaultQuery??{}))if(value!==null&&value!==undefined)assert.equal(last.url.searchParams.get(key),String(value),name);
  }
  assert.equal(requests.length,http.filter(d=>d.transport!=='sse').length);
});

test('external services require explicit base and never inherit API auth or metadata',async()=>{
  const name=Object.keys(ENDPOINTS).find(k=>ENDPOINTS[k].base!=='api');
  assert.ok(name);
  const seen=[];const config={getAccessToken:()=>{throw new Error('API token must not be read');},headers:{'X-Device-Id':'fixture-api-device'}};
  const noBase=makeClient(async()=>{throw new Error('no fetch');},config);
  await assert.rejects(noBase.call(name,{path:{appId:'fixture-app'}}),/Explicit serviceBases/);
  const service=ENDPOINTS[name].base;
  const client=makeClient(async(url,init)=>{seen.push({url,init});return json({result:{}});},{...config,serviceBases:{[service]:'https://external.invalid'},serviceHeaders:{[service]:{'X-External-Key':'fixture-key'}}});
  await client.call(name,{path:{appId:'fixture-app'},body:{fixture:1}});
  assert.equal(seen[0].init.headers.has('authorization'),false);
  assert.equal(seen[0].init.headers.has('x-device-id'),false);
  assert.equal(seen[0].init.headers.get('x-external-key'),'fixture-key');
  assert.equal(seen[0].init.credentials,'omit');
});

test('caller auth override is case-insensitive; false proxy toggle omits mode',async()=>{
  let seen;const client=makeClient(async(url,init)=>{seen=init;return json({result:true});},{getAccessToken:()=>{throw new Error('override should win');}});
  await client.toggleProxy(false,'AUTO_DELIVERY',{headers:{authorization:'Bearer fixture-override'}});
  assert.equal(seen.headers.get('Authorization'),'Bearer fixture-override');
  assert.deepEqual(JSON.parse(seen.body),{enabled:false});
});

test('multipart upload uses result.file_id even if data exists; download stays binary',async()=>{
  const requests=[];
  const client=makeClient(async(url,init)=>{
    requests.push({url:new URL(url),init});
    if(new URL(url).pathname.endsWith('/upload'))return json({code:0,data:{file_id:'wrong'},result:{file_id:'fixture-right'}});
    return new Response(new Uint8Array([0,255,1]),{headers:{'Content-Type':'application/octet-stream'}});
  });
  const result=await client.uploadFile(new Blob(['fixture']),'fixture.txt',{headers:{'Content-Type':'application/json'}});
  assert.equal(result.data.file_id,'fixture-right');
  assert.equal(requests[0].init.headers.has('content-type'),false);
  assert.ok(requests[0].init.body instanceof FormData);
  assert.equal(requests[0].init.body.get('file').name,'fixture.txt');
  const download=await client.downloadFile('fixture-id');
  assert.deepEqual(new Uint8Array(await download.data.arrayBuffer()),new Uint8Array([0,255,1]));
  assert.equal(requests[1].url.searchParams.get('fileId'),'fixture-id');
  const bad=makeClient(async()=>json({code:0,result:{}}));
  await assert.rejects(bad.uploadFile(new Blob(['x']),'x.txt'),ProtocolError);
});

test('builders separate card metadata.parent from top-level context and preserve wire alias',()=>{
  const request=buildModeSelection({cardMessageId:'101',wireId:'CONFIRM_BEFORE_CONTACT',title:' fixture option ',context:{parent:202,conversation_id:'303'}});
  assert.equal(request.metadata.parent,'101');assert.equal(request.metadata.style,'CONFIRM_BEFORE_CONTACT');
  assert.equal(request.parent,202);assert.equal(request.conversation_id,303);
  assert.equal(request.content.parts[0].text,'fixture option');
  assert.equal(toProxyMode('CONFIRM_BEFORE_CONTACT'),'DELIVERY_AFTER_CONFIRM');
  const noContext=buildModeSelection({cardMessageId:101,wireId:'AUTO_CHAT',title:'fixture'});
  assert.equal(Object.hasOwn(noContext,'parent'),false);
  assert.equal(normalizeServerId('9007199254740993'),undefined);
  assert.equal(normalizeServerId('local_12'),undefined);
});

test('ordinary text, recommend, resume and hidden job command retain distinct templates',()=>{
  const ordinary=buildDouziText(' fixture ',{systemHints:[],quotedText:'引用',metadata:{client_feature:'local',diagnosis_trigger_method:'tap',custom:1}});
  assert.deepEqual(ordinary.metadata.system_hints,[]);
  assert.equal(ordinary.content.content_type,'multi_part');
  assert.equal(ordinary.metadata.client_feature,undefined);assert.equal(ordinary.metadata.custom,1);
  const hidden=buildAgentJobChat({messageId:11,jobIds:[12,13],context:{parent:21,conversation_id:22}});
  assert.deepEqual(hidden.content.parts,[{content_type:'agent_job_chat',message_id:11,job_ids:[12,13]}]);
  assert.equal(hidden.parent,21);assert.equal(hidden.metadata.is_visually_hidden_from_conversation,true);
  assert.equal(hidden.metadata.system_hints,undefined);assert.equal(hidden.taskId,undefined);
  const recommend=buildRecommendText('fixture',{currentCondition:{city:'fixture-city'}});
  assert.equal(recommend.agent_hint.conversionType,'RECOMMEND');assert.equal(recommend.author.role,'user');
  assert.equal(recommend.metadata?.system_hints,undefined);
  const resume=buildResumeOptimizationText('fixture',{resumeRevisionId:31,selectedPath:'/experience/0',selectedPathName:'经历',selectedText:'  原句  '});
  assert.equal(resume.agent_hint.conversionRelatedId,31);assert.equal(resume.metadata.style,'resume_part_select');
  assert.deepEqual(resume.metadata.selected_text,{path:'/experience/0',path_name:'经历',text:'原句'});
  assert.deepEqual(resume.metadata.selected_path,['/experience/0']);
  assert.deepEqual(resume.metadata.selected_path_name,['经历']);
  assert.equal(resume.metadata.platform,undefined);
  const init=buildResumeOptimizationInit({resumeRevisionId:31});
  assert.equal(init.content.content_type,'resume_polish_init');assert.equal(init.author,undefined);
});

test('recommend quotes use text-first parts and preserve agent-specific metadata',()=>{
  for(const [type,style,tag]of [['list','quote_poslist_select','<poslist>'],['text','quote_text_select','<user__selection>'],['job','quote_jobdetail_select','<jobcard job-id="12">']]){
    const request=buildRecommendText('fixture',{quote:{type,text:'引用',jobId:12},metadata:{client_feature:'explicit-caller-field'}});
    assert.equal(request.content.parts[0].content_type,'text');
    assert.equal(request.content.parts[1].content_type,'browser_text');
    assert.ok(request.content.parts[1].content.startsWith(tag));
    assert.equal(request.metadata.style,style);assert.equal(request.metadata.platform,undefined);
    assert.equal(request.metadata.client_feature,'explicit-caller-field');
  }
  assert.equal(buildRecommendText('fixture').metadata,undefined);
});
