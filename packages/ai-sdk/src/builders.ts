import { normalizeCardMode } from './modes.js';
import type { AgentType, ChatContent, ChatPart, ConversationContext, Id, JsonRecord, ModeWireId, UserSayRequest } from './types.js';

/** Sc-compatible top-level ID conversion. Metadata IDs are deliberately separate. */
export function normalizeServerId(value: unknown): number | undefined {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim()))) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
function session(context: ConversationContext = {}): ConversationContext {
  const parent = normalizeServerId(context.parent);
  const conversation_id = normalizeServerId(context.conversation_id);
  if (parent === undefined) return {};
  return { parent, ...(conversation_id === undefined ? {} : {conversation_id}) };
}
function metadata(input: JsonRecord = {}, platform = 'APP'): JsonRecord {
  const copy: JsonRecord = {...input, platform};
  delete copy.client_feature;
  delete copy.diagnosis_trigger_method;
  return copy;
}
export interface TextOptions {
  context?: ConversationContext;
  metadata?: JsonRecord;
  platform?: string;
  systemHints?: string[];
  quotedText?: string;
  quoteStyle?: string;
  jobId?: number;
  quickReplyValue?: unknown;
  fileInfo?: ChatPart;
}
export function buildTextContent(text: string, options: Pick<TextOptions,'quotedText'|'quickReplyValue'|'fileInfo'> = {}): ChatContent {
  const parts: ChatPart[] = [];
  if (options.quotedText) parts.push({content_type:'browser_text', content:`<user__selection>${options.quotedText}</user__selection>`, quote_source:'', workspace:'chat'});
  if (options.fileInfo) parts.push(options.fileInfo);
  parts.push({content_type:'text', text, ...(options.quickReplyValue ? {value:options.quickReplyValue} : {})});
  return {content_type:options.fileInfo ? 'multimodal_text' : options.quotedText ? 'multi_part' : 'text', parts};
}
/** Ordinary text/file template, not the App's UI/store/market-context orchestration. */
export function buildDouziText(text: string, options: TextOptions = {}): UserSayRequest {
  text = text.trim();
  if (!text && !options.fileInfo?.file_id) throw new TypeError('Nonempty text or uploaded file_id required');
  const meta: JsonRecord = {system_hints:options.systemHints ?? ['deep_job_match']};
  if (options.quotedText) {
    meta.selected_text = {text:options.quotedText};
    meta.style = options.quoteStyle || 'quote_text_select';
    if (typeof options.jobId === 'number' && options.jobId > 0) meta.job_id = options.jobId;
  }
  return {content:buildTextContent(text,options), metadata:metadata({...meta,...options.metadata},options.platform),
    ...session(options.context), agent_hint:{conversionType:'DOUZI'}};
}
export interface ModeSelectionOptions {
  cardMessageId: Id;
  wireId: ModeWireId;
  /** The raw option.title used for sending, not a translated UI caption. */
  title: string;
  context?: ConversationContext;
  platform?: string;
}
export function buildModeSelection(options: ModeSelectionOptions): UserSayRequest {
  if (!normalizeCardMode(options.wireId) || !options.title.trim() || !String(options.cardMessageId).trim()) throw new TypeError('Card ID, recognized wire ID and title required');
  return {content:{content_type:'text',parts:[{content_type:'text',text:options.title.trim()}]},
    metadata:metadata({parent:options.cardMessageId,style:options.wireId},options.platform),
    ...session(options.context),agent_hint:{conversionType:'DOUZI'}};
}
export interface AgentJobChatOptions {
  messageId: Id;
  jobIds: readonly number[];
  context?: ConversationContext;
  platform?: string;
}
export function buildAgentJobChat(options: AgentJobChatOptions): UserSayRequest {
  if (!options.jobIds.length || options.jobIds.some(id=>!Number.isSafeInteger(id)||id<=0)) throw new TypeError('Positive job IDs required');
  return {content:{content_type:'multi_part',parts:[{content_type:'agent_job_chat',message_id:options.messageId,job_ids:[...options.jobIds]}]},
    metadata:metadata({style:'agent_job_chat',is_visually_hidden_from_conversation:true},options.platform),
    ...session({...options.context,parent:options.context?.parent ?? options.messageId}), agent_hint:{conversionType:'DOUZI'}};
}
export interface RecommendOptions {
  context?: ConversationContext;
  metadata?: JsonRecord;
  currentCondition?: JsonRecord;
  quote?: {type:'list'|'text'|'job';text:string;normalizedText?:string;jobId?:Id};
}
export function buildRecommendText(text: string, options: RecommendOptions = {}): UserSayRequest {
  if (!text.trim()) throw new TypeError('Nonempty recommendation text required');
  const meta: JsonRecord = {...options.metadata};
  const parts: ChatPart[] = [{content_type:'text',text:text.trim()}];
  const quote = options.quote;
  if (quote?.text) {
    meta.selected_text = {text:quote.text};
    meta.style = quote.type === 'list' ? 'quote_poslist_select' : quote.type === 'text' ? 'quote_text_select' : 'quote_jobdetail_select';
    if (quote.jobId !== undefined) meta.job_id = quote.jobId;
    const content = quote.type === 'list' ? quote.normalizedText || `<poslist>${quote.text}</poslist>`
      : quote.type === 'text' ? quote.normalizedText || `<user__selection>${quote.text}</user__selection>`
      : typeof quote.normalizedText === 'string' && /<job(?:detail|card)\b/.test(quote.normalizedText) ? quote.normalizedText
      : `<jobcard job-id="${quote.jobId || ''}">\n${quote.text}\n</jobcard>`;
    parts.push({content_type:'browser_text',content,quote_source:'',workspace:'chat'});
  }
  return {content:{content_type:parts.length>1?'multi_part':'text',parts},
    ...(Object.keys(meta).length ? {metadata:meta} : {}), ...session(options.context),
    author:{role:'user'},agent_hint:{conversionType:'RECOMMEND'},
    current_condition:options.currentCondition ?? {}};
}
export interface ResumeOptions {
  resumeRevisionId: Id;
  context?: ConversationContext;
  /** A normalized single resume path; App section/alias lookup is caller owned. */
  selectedPath?: string;
  selectedPathName?: string;
  selectedText?: string;
  metadata?: JsonRecord;
}
function resumePayload(content: ChatContent, options: ResumeOptions, withAuthor: boolean): UserSayRequest {
  if (!String(options.resumeRevisionId).trim()) throw new TypeError('Resume revision ID required');
  const path = options.selectedPath || '';
  const text = options.selectedText?.trim();
  return {content,...session(options.context), ...(withAuthor ? {author:{role:'user'}} : {}),
    agent_hint:{conversionType:'RESUME_OPTIMIZATION',conversionRelatedId:options.resumeRevisionId},
    metadata:{...options.metadata,resume_revision_id:options.resumeRevisionId,style:'resume_part_select',
      selected_path:path?[path]:[],selected_path_name:options.selectedPathName?[options.selectedPathName]:[],
      ...(text && path ? {selected_text:{path,path_name:options.selectedPathName || '',text}} : {})}};
}
export function buildResumeOptimizationText(text: string, options: ResumeOptions): UserSayRequest {
  if (!text.trim()) throw new TypeError('Nonempty resume text required');
  return resumePayload(buildTextContent(text.trim()),options,true);
}
export function buildResumeOptimizationInit(options: ResumeOptions): UserSayRequest {
  return resumePayload({content_type:'resume_polish_init'},options,false);
}
export function agentProfile(agent?: AgentType | string): 'main'|'recommend'|'resume' {
  return agent === 'RECOMMEND' ? 'recommend' : agent === 'RESUME_OPTIMIZATION' ? 'resume' : 'main';
}
