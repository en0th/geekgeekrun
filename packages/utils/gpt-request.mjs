import OpenAI from "openai";

// Request body fields that switch thinking (reasoning) mode on OpenAI-compatible APIs.
// Only providers known to accept them are covered; others keep their model default.
const THINKING_PARAMS = [
  [/(^|\.)deepseek\.com$/i, (on) => ({ thinking: { type: on ? "enabled" : "disabled" } })],
  [/(^|\.)volces\.com$/i, (on) => ({ thinking: { type: on ? "enabled" : "disabled" } })],
  // DashScope only allows thinking in streamed calls, so here it can only be switched off
  [/(^|\.)aliyuncs\.com$/i, (on) => (on ? {} : { enable_thinking: false })],
];

export function thinkingParams(baseURL, thinking) {
  if (typeof thinking !== "boolean") return {};
  let host;
  try {
    host = new URL(baseURL).hostname;
  } catch {
    return {};
  }
  const match = THINKING_PARAMS.find(([re]) => re.test(host));
  return match ? match[1](thinking) : {};
}

// model ids offered by an OpenAI-compatible provider (GET {baseURL}/models)
export async function listModels({ baseURL, apiKey, timeout = 15000 }) {
  const openai = new OpenAI({ baseURL, apiKey, timeout, maxRetries: 0 });
  const ids = [];
  for await (const model of openai.models.list()) {
    if (model?.id) ids.push(String(model.id));
  }
  return [...new Set(ids)].sort();
}

export async function completes(
  {
    baseURL,
    apiKey,
    model,
    timeout = 120000,
    maxRetries = 3,
    // true / false switches thinking mode where the provider supports it; undefined leaves it alone
    thinking
  },
  messages
) {
  const openai = new OpenAI({
    baseURL,
    apiKey,
    timeout,
    maxRetries,
  });

  const body = (extra) => ({
    messages,
    model,
    frequency_penalty: 0,
    // reasoning tokens count towards max_tokens, so only lift the cap when thinking was switched on
    ...(thinking === true && Object.keys(extra).length ? {} : { max_tokens: 100 }),
    temperature: 0.1,
    ...extra
  });
  const extra = thinkingParams(baseURL, thinking);
  let completion;
  try {
    completion = await openai.chat.completions.create(body(extra));
  } catch (err) {
    // a model that doesn't know the thinking field may reject it; retry once without it
    if (err?.status !== 400 || !Object.keys(extra).length) throw err;
    console.log("request with thinking params rejected, retrying without them", err?.message);
    completion = await openai.chat.completions.create(body({}));
  }

  console.log(completion.choices[0].message.content);
  return completion;
}
