import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const outfile = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-hire-')),
  'job-hire-status.mjs'
)
await build({
  entryPoints: [path.join(here, '../src/main/features/job-hire-status.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent'
})
const { parseJobDetailStatus } = await import(pathToFileURL(outfile).href)

const page = (banner) => `<html><body><div id="main">${banner}</div></body></html>`

test('an open job page counts as hiring', () => {
  assert.equal(
    parseJobDetailStatus(
      page('<div class="job-banner"><div class="name"><h1>前端工程师</h1></div></div>')
    ),
    1
  )
})

test('the 职位已关闭 label marks the job closed', () => {
  assert.equal(
    parseJobDetailStatus(
      page('<div class="job-banner"><div class="job-status"><span>职位已关闭</span></div></div>')
    ),
    2
  )
})

test('a missing page means the job was deleted', () => {
  assert.equal(parseJobDetailStatus('<html><body><p>您访问的页面不存在</p></body></html>'), 3)
})

test('pages that do not tell (verification, blank) are unknown', () => {
  assert.equal(parseJobDetailStatus(''), null)
  assert.equal(
    parseJobDetailStatus('<html><body><div class="verify">请完成验证</div></body></html>'),
    null
  )
})
