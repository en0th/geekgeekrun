import { IdNamespaceError } from './errors.js';

export type IdNamespace='AppUserId'|'AiConversationId'|'AiMessageId'|'AiTaskId'|'AiTaskResultId'|
  'PendingResultId'|'PendingJobId'|'PendingBossId'|'DailyReportId'|'ReportPendingResultId'|
  'DeliveryRecordId'|'DeliveryZpJobId'|'RecordBossUid'|'BossPeerUid'|'ZpUserId'|'BossClientMessageId'|'BossServerMessageId';
export interface ScopedId<K extends IdNamespace> {readonly namespace:K;readonly value:string;}
/** Runtime namespace tags supplement TypeScript and prevent accidental ID reuse. */
export function scopedId<K extends IdNamespace>(namespace:K,input:unknown):ScopedId<K> {
  if(typeof input==='number'&&(!Number.isSafeInteger(input)||input<=0))throw new TypeError(`${namespace} needs a positive safe integer or a lossless decimal string`);
  if(typeof input!=='number'&&typeof input!=='bigint'&&typeof input!=='string')throw new TypeError(`${namespace} must be numeric`);
  const text=String(input).trim();
  if(!/^\d+$/.test(text)||BigInt(text)<=0n)throw new TypeError(`${namespace} must be a positive decimal ID`);
  return Object.freeze({namespace,value:BigInt(text).toString()});
}
export function idValue<K extends IdNamespace>(namespace:K,id:ScopedId<NoInfer<K>>):string {
  if(!id||id.namespace!==namespace)throw new IdNamespaceError(namespace,id?.namespace??typeof id);
  return scopedId(namespace,id.value).value;
}
/** Only where the shipped JSON producer explicitly constructs a Number. */
export function idNumber<K extends IdNamespace>(namespace:K,id:ScopedId<NoInfer<K>>):number {
  const value=Number(idValue(namespace,id));
  if(!Number.isSafeInteger(value)||value<=0)throw new TypeError(`${namespace} exceeds the confirmed JSON Number range; do not round it`);
  return value;
}
