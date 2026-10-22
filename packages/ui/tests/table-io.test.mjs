import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')
const Module = require('node:module')
const filename = fileURLToPath(new URL('./table-io-fixture.cjs', import.meta.url))
const output = await build({ entryPoints: [fileURLToPath(new URL('../src/renderer/src/features/RunDataTable/io.ts', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent' })
const compiled = new Module(filename)
compiled.filename = filename
compiled.paths = Module._nodeModulePaths(path.dirname(filename))
compiled._compile('const electron={ipcRenderer:{invoke:(...args)=>globalThis.__ggrIoInvoke(...args)}};\n' + output.outputFiles[0].text, filename)
const io = compiled.exports
const sample = { encryptJobId: '00123', jobName: '工程师 C++', companyName: '测试公司',
  salaryDesc: '150-250元/天', salaryUnit: 'day', salaryAmountLow: 150, salaryAmountHigh: 250 }

async function roundTrip(t, format) {
  const previous = globalThis.__ggrIoInvoke
  let saved
  globalThis.__ggrIoInvoke = async (channel, payload) => {
    assert.equal(channel, 'save-file-with-dialog')
    saved = payload
    return { canceled: false, filePath: '/isolated-fixture/export.' + format }
  }
  t.after(() => { globalThis.__ggrIoInvoke = previous })
  await io.exportRows('jobLibrary', [sample], format)
  const file = new File([saved.content], 'sample.' + format)
  const parsed = await io.parseImportFile('jobLibrary', file)
  assert.equal(parsed.rows.length, 1)
  for (const [key, value] of Object.entries(sample)) assert.equal(parsed.rows[0][key], value, `${format}: ${key}`)
  return parsed
}

test('JSON import/export and clipboard text keep identifiers and salary units', async t => {
  await roundTrip(t, 'json')
  assert.equal(io.rowsToTsv(['名称'], [['第一行\t第二行\n']]), '名称\n第一行 第二行 ')
})

test('the deferred spreadsheet library preserves CSV and XLSX round trips', async t => {
  await roundTrip(t, 'csv')
  await roundTrip(t, 'xlsx')
})
