import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { completes, thinkingParams } from '../gpt-request.mjs'

test('thinking params are only sent to providers known to accept them', () => {
  assert.deepEqual(thinkingParams('https://api.deepseek.com/v1', true), { thinking: { type: 'enabled' } })
  assert.deepEqual(thinkingParams('https://api.deepseek.com/v1', false), { thinking: { type: 'disabled' } })
  assert.deepEqual(thinkingParams('https://ark.cn-beijing.volces.com/api/v3', true), { thinking: { type: 'enabled' } })
  assert.deepEqual(thinkingParams('https://dashscope.aliyuncs.com/compatible-mode/v1', true), {})
  assert.deepEqual(thinkingParams('https://dashscope.aliyuncs.com/compatible-mode/v1', false), { enable_thinking: false })
  assert.deepEqual(thinkingParams('http://127.0.0.1:11434/v1', true), {})
  assert.deepEqual(thinkingParams('https://api.deepseek.com/v1', undefined), {})
  assert.deepEqual(thinkingParams('not a url', true), {})
})

// a local OpenAI-compatible server; `respond` decides each reply from the request body
async function withServer(respond, run) {
  const bodies = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = JSON.parse(raw)
      bodies.push(body)
      const [status, payload] = respond(body, bodies.length)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    return await run(`http://127.0.0.1:${server.address().port}/v1`, bodies)
  } finally {
    server.close()
  }
}
const ok = { id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '{"response":"hi"}' }, finish_reason: 'stop' }] }
const call = (baseURL, extra = {}) =>
  completes({ baseURL, apiKey: 'k', model: 'm', timeout: 5000, maxRetries: 0, ...extra }, [{ role: 'user', content: 'hi' }])

test('unknown providers keep the 100 token cap even with thinking on', async () => {
  await withServer(() => [200, ok], async (url, bodies) => {
    await call(url, { thinking: true })
    assert.equal(bodies[0].max_tokens, 100)
    assert.equal(bodies[0].thinking, undefined)
  })
})

test('retries the configured number of times on server errors', async () => {
  await withServer((_, n) => (n < 3 ? [500, { error: { message: 'busy' } }] : [200, ok]), async (url, bodies) => {
    const res = await call(url, { maxRetries: 3 })
    assert.equal(res.choices[0].message.content, '{"response":"hi"}')
    assert.equal(bodies.length, 3)
  })
})

test('a 400 without thinking params is not retried', async () => {
  await withServer(() => [400, { error: { message: 'bad' } }], async (url, bodies) => {
    await assert.rejects(call(url, { maxRetries: 3 }))
    assert.equal(bodies.length, 1)
  })
})

// route api.deepseek.com to the local server so the provider-specific path is exercised
import dns from 'node:dns'
async function asDeepSeek(run) {
  const original = dns.lookup
  dns.lookup = (host, options, callback) => {
    if (typeof options === 'function') [callback, options] = [options, {}]
    if (host !== 'api.deepseek.com') return original(host, options, callback)
    return options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4)
  }
  try {
    return await run()
  } finally {
    dns.lookup = original
  }
}
const deepseekUrl = (url) => url.replace('127.0.0.1', 'api.deepseek.com')

test('DeepSeek gets the thinking param and no token cap when thinking is on', async () => {
  await withServer(() => [200, ok], (url, bodies) =>
    asDeepSeek(async () => {
      await call(deepseekUrl(url), { thinking: true })
      assert.deepEqual(bodies[0].thinking, { type: 'enabled' })
      assert.equal(bodies[0].max_tokens, undefined)
      await call(deepseekUrl(url), { thinking: false })
      assert.deepEqual(bodies[1].thinking, { type: 'disabled' })
      assert.equal(bodies[1].max_tokens, 100)
    })
  )
})

test('a rejected thinking param is dropped and the cap restored on a single retry', async () => {
  await withServer(
    (body) => (body.thinking ? [400, { error: { message: 'unknown field thinking' } }] : [200, ok]),
    (url, bodies) =>
      asDeepSeek(async () => {
        const res = await call(deepseekUrl(url), { thinking: true, maxRetries: 3 })
        assert.equal(res.choices[0].message.content, '{"response":"hi"}')
        assert.equal(bodies.length, 2)
        assert.equal(bodies[1].thinking, undefined)
        assert.equal(bodies[1].max_tokens, 100)
      })
  )
})
