import { AuthSessionManager, ZhijueAuthClient, ZhijueAIClient, TaskDeliveryClient, BossHttpClient, BossImClient,
  buildDouziText, bindPendingDelivery, bindDeliveryRecord, enrichDeliveryRecords, idValue, requireRows, scopedId,
  ProtocolError, RuntimeAssociationRequiredError, SessionChangedError } from '@recovered/zhijue-ai-sdk';
import type { JsonRecord, ScopedId, RuntimeAssociation, PendingDeliverySelection, ConfirmationOutcome,
  BossImOptions, BossWebSocketFactory, CaptchaProof, LoginOutcome } from '@recovered/zhijue-ai-sdk';

export interface WorkflowOptions {
  client:ZhijueAIClient;
  sessions:AuthSessionManager;
  auth:ZhijueAuthClient;
  phone:string;
  code:string;
  platform?:'ios'|'android'|'other';
  /** Optional: acquired from the actual captcha provider before requesting SMS. */
  captchaProof?:CaptchaProof;
  question:string;
  chatText:string;
  startTime?:number;
  endTime?:number;
  signal?:AbortSignal;
  poll?:{attempts:number;intervalMs:number};
  selectTask:(rows:readonly JsonRecord[],messages:readonly JsonRecord[])=>ScopedId<'AiTaskId'>|undefined;
  selectResult:(rows:readonly JsonRecord[])=>ScopedId<'AiTaskResultId'>|undefined;
  /** Unknown R->P link: caller supplies observed association; never cast R.id to P.id. */
  selectPendingForAiResult:(context:{conversation:ScopedId<'AiConversationId'>;task:ScopedId<'AiTaskId'>;result:ScopedId<'AiTaskResultId'>;pendingRows:readonly JsonRecord[];login:LoginOutcome})=>Promise<{id:ScopedId<'PendingResultId'>;association:RuntimeAssociation}>;
  /** Unknown confirmation->record link: confirmation does not return a proven recordId. */
  selectDeliveryRecordForConfirmation:(context:{pending:PendingDeliverySelection;confirmation:ConfirmationOutcome;records:readonly JsonRecord[]})=>Promise<{id:ScopedId<'DeliveryRecordId'>;association:RuntimeAssociation}>;
  webSocketFactory:BossWebSocketFactory;
  /** Testing/alternate explicit transport boundary; default uses the recovered MQTT client. */
  imFactory?:(options:BossImOptions)=>Pick<BossImClient,'connect'|'sendText'|'disconnect'>;
  cmid?:string;
  onStage?:(stage:string)=>void;
}
export class WorkflowStageError extends Error {
  readonly confirmationOutcome:'not_attempted'|'unknown'|'accepted';
  constructor(readonly stage:string,cause:unknown,readonly progress:{confirmationAttempted:boolean;confirmationAccepted:boolean;chatQueued:boolean;brokerAcked:boolean}) {
    super(`Workflow stopped at ${stage}`,{cause});this.name='WorkflowStageError';
    this.confirmationOutcome=progress.confirmationAccepted?'accepted':progress.confirmationAttempted?'unknown':'not_attempted';
  }
}
function object(value:unknown):JsonRecord{return value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:{};}
function rowById(rows:readonly JsonRecord[],id:string,label:string):JsonRecord{
  const row=rows.find(item=>String(item.id)===id);if(!row)throw new ProtocolError(`${label} selector returned an ID outside the fetched rows`);return row;
}
async function wait(delay:number,signal?:AbortSignal):Promise<void>{
  signal?.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal?.reason);};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},delay);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
async function poll<T>(load:()=>Promise<T>,ready:(value:T)=>boolean,policy:{attempts:number;intervalMs:number},signal?:AbortSignal):Promise<T>{
  if(!Number.isSafeInteger(policy.attempts)||policy.attempts<1||policy.attempts>100||!Number.isFinite(policy.intervalMs)||policy.intervalMs<0||policy.intervalMs>60000)throw new TypeError('Invalid bounded polling policy');
  for(let attempt=0;;attempt++){
    signal?.throwIfAborted();const result=await load();if(ready(result))return result;
    if(attempt+1>=policy.attempts)throw new ProtocolError('The requested task/result was not available within the bounded read attempts');
    await wait(policy.intervalMs,signal);
  }
}

/** Explicit example: running it can log in, confirm a delivery and send text.
 * No top-level network work. The shipped mock runner uses synthetic transports.
 * A runtime association is required at the two unproven backend joins.
 */
export async function runFullWorkflow(options:WorkflowOptions){
  const {client,sessions,auth}=options;
  let stage='login';const progress={confirmationAttempted:false,confirmationAccepted:false,chatQueued:false,brokerAcked:false};
  let im:Pick<BossImClient,'connect'|'sendText'|'disconnect'>|undefined;
  let unsubscribe=()=>{};
  const enter=(next:string)=>{stage=next;options.onStage?.(next);options.signal?.throwIfAborted();};
  try{
    if(options.captchaProof){enter('sms_code');await auth.sendPhoneCode(options.phone,options.captchaProof,{signal:options.signal});}
    enter('login');const login=await auth.loginWithPhoneCode(options.phone,options.code,{platform:options.platform,signal:options.signal});
    if(login.authorizationRequired===true)throw new RuntimeAssociationRequiredError('Explicit BOSS data authorization before this example');
    const epoch=login.sessionEpoch,scope={sessionEpoch:epoch,signal:options.signal};
    const assertAccount=()=>sessions.assertCurrent({sessionEpoch:epoch});
    unsubscribe=sessions.onSessionChange(current=>{if(current!==epoch)im?.disconnect();});
    const appUser=scopedId('AppUserId',login.login.data?.userId);
    enter('ai_conversation');assertAccount();
    const stream=client.userSay(buildDouziText(options.question),{signal:options.signal});
    let conversation:ScopedId<'AiConversationId'>|undefined;
    const messages:JsonRecord[]=[];
    for await(const event of stream){
      assertAccount();
      const data=object(event.data);
      if(event.event==='create_conversation')conversation=scopedId('AiConversationId',data.id);
      if(event.event==='delta'&&data.o==='add'){
        const message=object(data.v);if(message.id!==undefined){
          scopedId('AiMessageId',message.id);messages.push(message);
          if(message.conversation_id!==undefined){const cid=scopedId('AiConversationId',message.conversation_id);if(conversation&&conversation.value!==cid.value)throw new ProtocolError('SSE conversation scope changed');conversation=cid;}
        }
      }
    }
    if((await stream.completion).termination!=='done'||!conversation)throw new ProtocolError('AI stream did not provide a confirmed logical DONE/conversation context');
    const C=conversation,delivery=new TaskDeliveryClient(client),policy=options.poll??{attempts:10,intervalMs:1000};
    enter('task_query');
    let task:ScopedId<'AiTaskId'>|undefined;
    const taskRows=await poll(async()=>requireRows(await delivery.tasks(C,scope),'task/list'),rows=>!!(task=options.selectTask(rows,messages)),policy,options.signal);
    if(!task)throw new ProtocolError('No task was selected');
    const T:ScopedId<'AiTaskId'>=task,taskRow=rowById(taskRows,idValue('AiTaskId',T),'Task');
    const sourceMessage=scopedId('AiMessageId',taskRow.messageId||taskRow.message_id);
    if(!messages.some(row=>String(row.id)===sourceMessage.value))throw new ProtocolError('Task messageId was not in the observed conversation messages');
    enter('task_results');let result:ScopedId<'AiTaskResultId'>|undefined;
    const resultRows=await poll(async()=>requireRows(await delivery.results(T,scope),'result/list'),rows=>!!(result=options.selectResult(rows)),policy,options.signal);
    if(!result)throw new ProtocolError('No result was selected');
    const R:ScopedId<'AiTaskResultId'>=result,resultRow=rowById(resultRows,idValue('AiTaskResultId',R),'Result');
    if(resultRow.taskId!==undefined&&scopedId('AiTaskId',resultRow.taskId).value!==T.value)throw new ProtocolError('Result taskId disagrees with the queried task');
    enter('result_read');await delivery.readResult(R,scope);
    enter('pending_query');const pendingRows=requireRows(await delivery.pending({...scope,startTime:options.startTime,endTime:options.endTime}),'pending results');
    if(!options.selectPendingForAiResult)throw new RuntimeAssociationRequiredError('AI result -> pending confirmation row');
    const pendingChoice=await options.selectPendingForAiResult({conversation:C,task:T,result:R,pendingRows,login});assertAccount();
    const pending=bindPendingDelivery(pendingRows,pendingChoice.id,{taskId:T,resultId:R},pendingChoice.association,scope);
    enter('confirm_delivery');assertAccount();progress.confirmationAttempted=true;
    const confirmation=await delivery.confirm(pending,scope);progress.confirmationAccepted=true;
    enter('delivery_status');const statusRows=requireRows(await delivery.status(pending.jobId,scope),'delivery status');
    // Status lookup is separate evidence; do not use its id as a BOSS conversation.
    enter('delivery_records');const records=requireRows(await delivery.records('manual',scope),'delivery records');
    if(!options.selectDeliveryRecordForConfirmation)throw new RuntimeAssociationRequiredError('confirmation -> delivery record');
    const recordChoice=await options.selectDeliveryRecordForConfirmation({pending,confirmation,records});assertAccount();
    const selectedRaw=rowById(records,idValue('DeliveryRecordId',recordChoice.id),'Delivery record');
    const enrichmentJob=scopedId('DeliveryZpJobId',selectedRaw.zpJobId||object(selectedRaw.jobSnapshot).jobId);
    enter('record_enrichment');const enriched=requireRows(await delivery.lookupRecordJob(enrichmentJob,scope),'delivery enrichment');
    const matching=enriched.find(row=>String(row.zpJobId||object(row.jobSnapshot).jobId)===enrichmentJob.value);
    if(!matching)throw new RuntimeAssociationRequiredError('delivery record job -> independently fetched enrichment');
    const selected=bindDeliveryRecord(enrichDeliveryRecords([selectedRaw],enriched),recordChoice.id,pending,recordChoice.association);
    enter('peer_lookup');const boss=new BossHttpClient(client);
    const peer=await boss.resolvePeer({jobId:selected.jobId.value,friendId:selected.initialPeer.value},scope);
    // App takes the first lookup row; this example additionally validates job membership.
    if(!peer.record||String(object(peer.record.jobSnapshot).jobId??peer.record.zpJobId)!==selected.jobId.value)throw new RuntimeAssociationRequiredError('job lookup -> final BOSS peer');
    const finalPeer=scopedId('BossPeerUid',peer.friendId);
    enter('im_credentials');const credentials=await boss.getCredentials({...scope,forceRefresh:false});assertAccount();
    const zpSelf=scopedId('ZpUserId',credentials.zpUserId);
    const imOptions:BossImOptions={credentials,webSocketFactory:options.webSocketFactory,ackTimeoutMs:10000};
    im=options.imFactory?options.imFactory(imOptions):new BossImClient(imOptions);
    enter('await_connack');await im.connect();assertAccount();
    enter('boss_history');const history=await boss.history({userId:zpSelf.value,friendId:finalPeer.value},scope);
    if(history.code!==0)throw new ProtocolError(`BOSS history was unavailable (${history.code}); no text was sent by this example`);
    enter('boss_send');assertAccount();
    const sent=im.sendText({to:finalPeer.value,text:options.chatText,...(options.cmid?{cmid:options.cmid}:{})});progress.chatQueued=true;
    const cmid=scopedId('BossClientMessageId',sent.cmid);
    enter('await_extended_ack');const ack=await sent.brokerAck;assertAccount();
    if(ack.packetId!==sent.packetId||scopedId('BossClientMessageId',ack.cmid).value!==cmid.value)throw new ProtocolError('Extended ACK packetId/cmid disagrees with the submitted message');
    const serverMid=scopedId('BossServerMessageId',ack.mid);progress.brokerAcked=true;
    return {ids:{appUser,conversation:C,sourceMessage,task:T,result:R,pending:pending.pendingId,pendingJob:pending.jobId,pendingBoss:pending.bossId,record:selected.id,recordJob:selected.jobId,initialPeer:selected.initialPeer,finalPeer,zpSelf,cmid,serverMid},
      confirmation,statusRows,history,chat:{state:'brokerAck' as const,ack,read:'unknown' as const},
      unknowns:['AI result -> pending row and confirmation -> record were supplied by explicit runtime callbacks','ADD_FRIEND/DELIVERED do not expose a resume attachment receipt in this response','Extended PUBACK is a protocol receipt; human read and ultimate business delivery remain separate']};
  }catch(error){throw new WorkflowStageError(stage,error,{...progress});}
  finally{unsubscribe();im?.disconnect();}
}
