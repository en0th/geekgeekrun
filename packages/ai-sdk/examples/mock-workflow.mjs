import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AuthSessionManager, ZhijueAIClient, ZhijueAuthClient, scopedId } from '../dist/index.js';
import { runFullWorkflow } from '../dist-examples/full-workflow.js';

const json=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const canonicalQuery=query=>Object.fromEntries(Object.entries(query??{}).map(([key,value])=>[key,String(value)]));

/** Fully offline. Http/IM shapes are synthetic; associations are harness metadata. */
export async function runMockWorkflow(overrides={}) {
  const fixture=JSON.parse(await readFile(new URL('./fixtures/e2e.json',import.meta.url),'utf8'));
  overrides.mutateFixture?.(fixture);
  const tokens=fixture.id_tokens;
  const expected=fixture.steps.filter(step=>step.kind==='http_json'||step.kind==='http_sse');
  let cursor=0,connected=false,disconnects=0;
  const requests=[],imSends=[],stages=[];
  const sessions=new AuthSessionManager({now:()=>1700000000000});
  const client=new ZhijueAIClient({baseUrl:'https://offline-sdk.invalid',auth:sessions,fetch:async(url,init)=>{
    const uri=new URL(url),body=init.body?JSON.parse(init.body):undefined;
    if(uri.pathname==='/wapi/user/auth/phone/login')return json({code:0,result:{status:'success',userId:tokens.app_user.value,accessToken:'MOCK_ONLY_APP_ACCESS',accessExpiresIn:7200}});
    if(uri.pathname==='/wapi/user/info')return json({code:0,result:{id:tokens.app_user.value,identity:'GEEK'}});
    const step=expected[cursor++];assert.ok(step,`Unexpected mock request ${uri.pathname}`);
    assert.equal(uri.pathname,step.request.path);assert.equal(init.method,step.request.method);
    assert.deepEqual(Object.fromEntries(uri.searchParams),canonicalQuery(step.request.query));
    assert.deepEqual(body,step.request.body);
    requests.push({step:step.id,method:init.method,path:uri.pathname,query:Object.fromEntries(uri.searchParams),body});
    await overrides.beforeResponse?.(step,{sessions,requests});
    if(step.kind==='http_sse')return new Response(step.response.wire,{status:step.response.status,headers:{'Content-Type':'text/event-stream'}});
    return new Response(JSON.stringify(step.response.body),{status:step.response.status,headers:{'Content-Type':'application/json'}});
  }});
  const auth=new ZhijueAuthClient(client,sessions,{now:()=>1700000000000});
  const defaultPending=async context=>{
    assert.equal(context.result.value,String(tokens.ai_result_R.value));assert.equal(context.task.value,String(tokens.task_T.value));
    return {id:scopedId('PendingResultId',tokens.pending_P.value),association:{source:'synthetic-fixture',evidence:'Mock-only R->P association, supplied outside the response'}};
  };
  const defaultRecord=async context=>{
    assert.equal(context.pending.pendingId.value,String(tokens.pending_P.value));
    return {id:scopedId('DeliveryRecordId',tokens.delivery_record_K.value),association:{source:'synthetic-fixture',evidence:'Mock-only confirmation->record association, supplied outside the response'}};
  };
  const imFactory=options=>{
    assert.equal(options.credentials.zpUserId,String(tokens.zp_self.value));
    return {
      async connect(){if(overrides.imConnectError)throw overrides.imConnectError;connected=true;},
      sendText(input){
        assert.equal(connected,true);assert.equal(input.to,String(tokens.boss_peer_final.value));
        assert.equal(input.text,fixture.steps.find(step=>step.id==='boss_send_text').arguments.text);
        assert.deepEqual(Object.keys(input).sort(),['cmid','text','to']);imSends.push(input);
        const packet=fixture.steps.find(step=>step.id==='boss_ack').packet;
        const ack={state:'brokerAck',packetId:packet.messageIdentifier,cmid:String(packet.cmid),mid:String(packet.mid)};
        overrides.mutateAck?.(ack);
        return {state:'queued',packetId:packet.messageIdentifier,cmid:input.cmid,
          brokerReceived:Promise.resolve({state:'broker_received',packetId:packet.messageIdentifier,extended:true,cmid:input.cmid}),
          brokerAck:Promise.resolve(ack),read:new Promise(()=>{})};
      },
      disconnect(){connected=false;disconnects++;},
    };
  };
  try{
    const result=await runFullWorkflow({client,sessions,auth,phone:'MOCK_ONLY_PHONE',code:'MOCK_ONLY_SMS',platform:'ios',
      question:fixture.steps.find(step=>step.id==='ai_send').request.body.content.parts[0].text,
      chatText:fixture.steps.find(step=>step.id==='boss_send_text').arguments.text,
      startTime:1700000000000,endTime:1700086400000,poll:{attempts:1,intervalMs:0},
      selectTask:()=>scopedId('AiTaskId',tokens.task_T.value),selectResult:()=>scopedId('AiTaskResultId',tokens.ai_result_R.value),
      selectPendingForAiResult:Object.hasOwn(overrides,'selectPendingForAiResult')?overrides.selectPendingForAiResult:defaultPending,
      selectDeliveryRecordForConfirmation:Object.hasOwn(overrides,'selectDeliveryRecordForConfirmation')?overrides.selectDeliveryRecordForConfirmation:defaultRecord,
      webSocketFactory:()=>{throw new Error('No real WebSocket is allowed in this example');},imFactory,cmid:String(tokens.boss_client_cmid.value),
      onStage:stage=>{stages.push(stage);overrides.onStage?.(stage,{sessions});},
    });
    assert.equal(cursor,expected.length);assert.equal(disconnects,1);
    return {result,requests,imSends,stages,fixture};
  }catch(error){Object.defineProperty(error,'mockContext',{value:{requests,imSends,stages,disconnects,session:sessions.snapshot()}});throw error;}
  finally{client.dispose();sessions.clear();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {result,requests}=await runMockWorkflow();
  console.log(JSON.stringify({synthetic:true,network:'injected offline fixtures only',requests:requests.length,ids:result.ids,
    confirmation:result.confirmation.status,resumeAttachmentReceipt:result.confirmation.resumeAttachmentReceipt,
    chat:result.chat,unknowns:result.unknowns},null,2));
}
