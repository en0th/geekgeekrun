import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aiRequestSettings,
  completionOptions,
  modelPair,
  validModels,
  AI_REQUEST_DEFAULTS
} from '../src/common/model-config.mjs'

const model = { model: 'deepseek-v4-pro', providerCompleteApiUrl: 'https://api.deepseek.com/v1', providerApiSecret: 'k', enabled: true }

test('existing models without request settings get timeout 120s, 3 retries and thinking on', () => {
  assert.deepEqual(aiRequestSettings({}), AI_REQUEST_DEFAULTS)
  const [primary, backup] = modelPair([model])
  assert.equal(primary.requestTimeoutSeconds, 120)
  assert.equal(primary.maxRetries, 3)
  assert.equal(primary.thinkingEnabled, true)
  assert.equal(backup.maxRetries, 3)
})

test('saved request settings are kept', () => {
  assert.deepEqual(aiRequestSettings({ requestTimeoutSeconds: 60, maxRetries: 0, thinkingEnabled: false }), {
    requestTimeoutSeconds: 60,
    maxRetries: 0,
    thinkingEnabled: false
  })
})

test('completion options carry the settings in the units completes() expects', () => {
  assert.deepEqual(completionOptions({ ...model, requestTimeoutSeconds: 90, maxRetries: 2, thinkingEnabled: false }), {
    baseURL: model.providerCompleteApiUrl,
    apiKey: 'k',
    model: 'deepseek-v4-pro',
    timeout: 90000,
    maxRetries: 2,
    thinking: false
  })
})

test('out of range request settings are rejected on save', () => {
  assert.equal(validModels([{ ...model, requestTimeoutSeconds: 120, maxRetries: 3 }]), '')
  assert.match(validModels([{ ...model, requestTimeoutSeconds: 5 }]), /请求超时/)
  assert.match(validModels([{ ...model, maxRetries: 11 }]), /重试次数/)
  assert.match(validModels([{ ...model, maxRetries: 1.5 }]), /重试次数/)
})
