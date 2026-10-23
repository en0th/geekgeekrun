import { ZhijueAIClient, buildDouziText, buildModeSelection } from '../dist/index.js';
import type { AiSseEvent, ConversationContext, ModeWireId } from '../dist/index.js';

/** No top-level request. The caller supplies an authorized environment/session. */
export async function chatExample(
  baseUrl:string,
  getAccessToken:()=>Promise<string>,
  context:ConversationContext,
  onEvent:(event:AiSseEvent)=>void,
) {
  const client=new ZhijueAIClient({baseUrl,getAccessToken});
  const stream=client.userSay(buildDouziText('请分析求职方向',{context}));
  try {
    for await(const event of stream) onEvent(event);
  } finally {
    // eof/error differs from accepted DONE. A signal is not a policy ACK.
    const completion=await stream.completion;
    if(completion.termination!=='done') reportIncomplete(completion.termination);
  }
}

export function selectionExample(cardId:number,wireId:ModeWireId,title:string,context:ConversationContext) {
  return buildModeSelection({cardMessageId:cardId,wireId,title,context});
}

function reportIncomplete(termination:string):void {
  console.info('stream termination',termination);
}
