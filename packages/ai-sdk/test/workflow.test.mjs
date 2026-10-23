import test from 'node:test';
import assert from 'node:assert/strict';
import { runMockWorkflow } from '../examples/mock-workflow.mjs';
import { scopedId, idValue, idNumber, IdNamespaceError, RuntimeAssociationRequiredError, SessionChangedError, ConfirmationRejectedError, TaskDeliveryClient, ZhijueAIClient, AuthSessionManager, bindPendingDelivery } from '../dist/index.js';

test('complete offline login/AI/task/pending/confirm/record/BOSS flow uses distinct ID namespaces',async()=>{
  const {result,requests,imSends}=await runMockWorkflow();
  assert.equal(result.ids.result.value,'30201');assert.equal(result.ids.pending.value,'40201');
  assert.equal(result.ids.appUser.value,'10101');assert.equal(result.ids.zpSelf.value,'70401');
  assert.equal(result.ids.pendingJob.value,'50101');assert.equal(result.ids.recordJob.value,'60201');
  assert.equal(result.ids.initialPeer.value,'60301');assert.equal(result.ids.finalPeer.value,'70301');
  const confirm=requests.find(request=>request.step==='confirm_delivery');
  assert.equal(confirm.body.messageId,40201);assert.equal(confirm.body.jobDetail.jobId,50101);assert.equal(confirm.body.taskId,undefined);
  const history=requests.find(request=>request.step==='boss_history');assert.equal(history.body.friendId,70301);assert.equal(history.body.userId,70401);
  assert.equal(imSends.length,1);assert.equal(imSends[0].to,'70301');
  assert.equal(imSends[0].text,'你好，这是离线模拟消息');
  assert.equal(result.chat.state,'brokerAck');assert.equal(result.chat.read,'unknown');assert.equal(result.confirmation.resumeAttachmentReceipt,'unknown');
});

test('missing R->P runtime association stops before confirmation',async()=>{
  await assert.rejects(runMockWorkflow({selectPendingForAiResult:undefined}),error=>error.cause instanceof RuntimeAssociationRequiredError&&error.mockContext.requests.every(request=>request.step!=='confirm_delivery')&&error.confirmationOutcome==='not_attempted');
});

test('missing confirmation->record mapping preserves accepted outcome and sends no IM text',async()=>{
  await assert.rejects(runMockWorkflow({selectDeliveryRecordForConfirmation:undefined}),error=>error.cause instanceof RuntimeAssociationRequiredError&&error.confirmationOutcome==='accepted'&&error.mockContext.imSends.length===0);
});

test('ID namespace mismatches fail even when their primitive values coincide',async()=>{
  assert.throws(()=>idValue('AiTaskId',scopedId('AiTaskResultId',30101)),IdNamespaceError);
  assert.throws(()=>idNumber('PendingResultId',scopedId('AiTaskResultId',40201)),IdNamespaceError);
  assert.throws(()=>scopedId('BossServerMessageId',9007199254740992),TypeError);
  assert.equal(scopedId('BossServerMessageId','18446744073709551615').value,'18446744073709551615');
  let requests=0;const client=new ZhijueAIClient({baseUrl:'https://offline.invalid',fetch:async()=>{requests++;throw new Error('not expected');}});
  assert.throws(()=>new TaskDeliveryClient(client).results(scopedId('PendingResultId',30101)),IdNamespaceError);assert.equal(requests,0);client.dispose();
});

test('confirmation code0 alone or ADD_FRIEND under another code is not accepted or retried',async()=>{
  for(const [code,status]of [[0,'FAILED'],[200,'ADD_FRIEND']]){
    await assert.rejects(runMockWorkflow({mutateFixture:fixture=>{const step=fixture.steps.find(step=>step.id==='confirm_delivery');step.response.body={code,result:{status}};}}),error=>error.cause instanceof ConfirmationRejectedError&&error.mockContext.requests.filter(request=>request.step==='confirm_delivery').length===1&&error.mockContext.imSends.length===0);
  }
});

test('peer lookup cannot silently accept a row for an unrelated job',async()=>{
  await assert.rejects(runMockWorkflow({mutateFixture:fixture=>{fixture.steps.find(step=>step.id==='lookup_peer').response.body.result[0].jobSnapshot.jobId=99999;}}),error=>error.cause instanceof RuntimeAssociationRequiredError&&error.mockContext.imSends.length===0);
});

test('account change before chat submission disconnects and prevents sending',async()=>{
  await assert.rejects(runMockWorkflow({onStage:(stage,{sessions})=>{if(stage==='boss_send')sessions.setSession({accessToken:'MOCK_OTHER',expiresAt:1700100000000,userId:99999});}}),error=>error.cause instanceof SessionChangedError&&error.mockContext.imSends.length===0);
});

test('history1000 and handshake failure remain separate from successful confirmation',async()=>{
  await assert.rejects(runMockWorkflow({mutateFixture:fixture=>{fixture.steps.find(step=>step.id==='boss_history').response.body={code:1000,result:null};}}),error=>error.stage==='boss_history'&&error.confirmationOutcome==='accepted'&&error.mockContext.imSends.length===0);
  await assert.rejects(runMockWorkflow({imConnectError:new Error('fixture CONNACK rejected')}),error=>error.stage==='await_connack'&&error.confirmationOutcome==='accepted'&&error.mockContext.imSends.length===0);
});

test('mismatched extended ACK is not a delivery success and no text is replayed',async()=>{
  await assert.rejects(runMockWorkflow({mutateAck:ack=>{ack.cmid='1700000000999';}}),error=>error.stage==='await_extended_ack'&&error.progress.chatQueued&&error.progress.brokerAcked===false&&error.mockContext.imSends.length===1);
});

test('report pending branch reads result.detail, joins explicit ids, and skips empty-list requests',async()=>{
  for(const ids of [[40201,40202],[]]){
    const requests=[];const client=new ZhijueAIClient({baseUrl:'https://offline.invalid',fetch:async(url)=>{
      const uri=new URL(url);requests.push(uri);
      return new Response(JSON.stringify({code:0,result:uri.pathname.endsWith('/by-id')?{detail:{pendingConfirmedTaskResultIdList:ids}}:[]}),{headers:{'Content-Type':'application/json'}});
    }});
    const outcome=await new TaskDeliveryClient(client).pendingByReport(scopedId('DailyReportId',40101));
    assert.equal(requests[0].searchParams.get('id'),'40101');
    if(ids.length){assert.equal(requests[1].searchParams.get('ids'),'40201,40202');assert.equal(requests.length,2);}else{assert.equal(requests.length,1);assert.equal(outcome.pending,null);}
    client.dispose();
  }
});

test('an independently bound pending selection cannot be submitted after changing accounts',async()=>{
  const sessions=new AuthSessionManager({now:()=>1000});sessions.setSession({accessToken:'A',expiresAt:100000,userId:1});let requests=0;
  const client=new ZhijueAIClient({baseUrl:'https://offline.invalid',auth:sessions,fetch:async()=>{requests++;throw new Error('No request expected');}});
  const delivery=new TaskDeliveryClient(client),rows=[{id:40201,content:{job_info:{jobId:50101,bossId:50201}}}];
  const source={taskId:scopedId('AiTaskId',30101),resultId:scopedId('AiTaskResultId',30201)},proof={source:'synthetic-fixture',evidence:'explicit mock association'};
  const selected=delivery.bindPending(rows,scopedId('PendingResultId',40201),source,proof);
  sessions.setSession({accessToken:'B',expiresAt:100000,userId:2});await assert.rejects(delivery.confirm(selected),SessionChangedError);assert.equal(requests,0);
  const unbound=bindPendingDelivery(rows,scopedId('PendingResultId',40201),source,proof);
  await assert.rejects(delivery.confirm(unbound),RuntimeAssociationRequiredError);assert.equal(requests,0);client.dispose();
});

test('task snake_case aliases and packet ID correlation remain explicit at the example boundary',async()=>{
  const success=await runMockWorkflow({mutateFixture:fixture=>{const row=fixture.steps.find(step=>step.id==='task_list').response.body.result[0];row.message_id=row.messageId;delete row.messageId;}});
  assert.equal(success.result.ids.sourceMessage.value,'20301');
  await assert.rejects(runMockWorkflow({mutateAck:ack=>{ack.packetId=999;}}),error=>error.stage==='await_extended_ack'&&error.progress.brokerAcked===false&&error.mockContext.imSends.length===1);
});

test('record enrichment uses zpJobId before snapshot job ID and merges before routing',async()=>{
  const {result,requests}=await runMockWorkflow({mutateFixture:fixture=>{
    fixture.steps.find(step=>step.id==='delivery_records').response.body.result[0].jobSnapshot.jobId=77777;
    const enriched=fixture.steps.find(step=>step.id==='enrich_record').response.body.result[0];enriched.zpJobId=60201;enriched.jobSnapshot.jobId=88888;
    const lookup=fixture.steps.find(step=>step.id==='lookup_peer');lookup.request.body.ids=[88888];lookup.response.body.result[0].zpJobId=88888;lookup.response.body.result[0].jobSnapshot.jobId=88888;
  }});
  assert.deepEqual(requests.find(request=>request.step==='enrich_record').body.ids,[60201]);
  assert.deepEqual(requests.find(request=>request.step==='lookup_peer').body.ids,[88888]);assert.equal(result.ids.recordJob.value,'88888');
});
