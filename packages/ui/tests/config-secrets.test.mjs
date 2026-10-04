import test from 'node:test'
import assert from 'node:assert/strict'
const {
  redactLlmConfigList,
  restoreLlmSecrets,
  llmSecretsLostByHostChange,
  redactConfigForRenderer,
  keepAutoReminderSecrets
} = await import('../src/main/features/config-secrets.ts')

const saved = [
  { id: 'a', model: 'deepseek-v4-pro', providerCompleteApiUrl: 'https://api.deepseek.com/v1', providerApiSecret: 'sk-saved', enabled: true },
  { id: 'b', model: 'qwen', providerCompleteApiUrl: 'http://127.0.0.1:11434/v1', providerApiSecret: '', enabled: true }
]

test('the renderer copy has no keys, only whether one is saved', () => {
  const redacted = redactLlmConfigList(saved)
  assert.equal(JSON.stringify(redacted).includes('sk-saved'), false)
  assert.deepEqual(redacted.map((m) => m.hasProviderApiSecret), [true, false])
})

test('a blank key keeps the saved one for the same API host', () => {
  const [restored] = restoreLlmSecrets(redactLlmConfigList(saved), saved)
  assert.equal(restored.providerApiSecret, 'sk-saved')
  assert.equal('hasProviderApiSecret' in restored, false)
})

test('a newly typed key replaces the saved one', () => {
  const incoming = redactLlmConfigList(saved)
  incoming[0].providerApiSecret = 'sk-new'
  assert.equal(restoreLlmSecrets(incoming, saved)[0].providerApiSecret, 'sk-new')
})

test('a saved key is never sent to a different API host', () => {
  const incoming = redactLlmConfigList(saved)
  incoming[0].providerCompleteApiUrl = 'https://other.example.com/v1'
  assert.equal(restoreLlmSecrets(incoming, saved)[0].providerApiSecret, '')
  assert.equal(llmSecretsLostByHostChange(incoming, saved), true)
  assert.equal(llmSecretsLostByHostChange(redactLlmConfigList(saved), saved), false)
})

test('legacy entries without an id are matched by address and model', () => {
  const legacy = [{ model: 'm', providerCompleteApiUrl: 'https://api.deepseek.com', providerApiSecret: 'sk-old' }]
  const incoming = [{ id: 'fresh-uuid', model: 'm', providerCompleteApiUrl: 'https://api.deepseek.com', providerApiSecret: '' }]
  assert.equal(restoreLlmSecrets(incoming, legacy)[0].providerApiSecret, 'sk-old')
})

test('config for the renderer hides llm keys, the DingTalk token and the Gemini key', () => {
  const out = redactConfigForRenderer({
    'llm.json': saved,
    'dingtalk.json': { groupRobotAccessToken: 'ding-secret' },
    'boss.json': { autoReminder: { geminiApiKey: 'gem-secret', rechatLimitDay: 21 } }
  })
  const text = JSON.stringify(out)
  for (const secret of ['sk-saved', 'ding-secret', 'gem-secret']) assert.equal(text.includes(secret), false, secret)
  assert.equal(out['dingtalk.json'].hasGroupRobotAccessToken, true)
  assert.equal(out['boss.json'].autoReminder.hasGeminiApiKey, true)
  assert.equal(out['boss.json'].autoReminder.rechatLimitDay, 21)
})

test('writing autoReminder back keeps the Gemini key the page never saw', () => {
  const next = keepAutoReminderSecrets({ rechatLimitDay: 7, hasGeminiApiKey: true }, { geminiApiKey: 'gem-secret' })
  assert.deepEqual(next, { rechatLimitDay: 7, geminiApiKey: 'gem-secret' })
})
