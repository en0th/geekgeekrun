import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import buildSqlitePlugin from '../scripts/steps/build-sqlite-plugin.mjs'

test('SQLite compilation targets its own directory without changing the caller cwd', () => {
  const before = process.cwd()
  let called = false
  buildSqlitePlugin({ spawnSync(command, args, options) {
    called = true
    assert.equal(process.cwd(), before)
    assert.equal(options.cwd, path.resolve(fileURLToPath(new URL('../../sqlite-plugin/', import.meta.url))))
    assert.deepEqual(args.slice(-2), ['run', 'build'])
    assert.ok(command)
    return { status: 0, signal: null }
  } })
  assert.equal(called, true)
  assert.equal(process.cwd(), before)
})

test('spawn errors, nonzero exits and termination signals cannot be reported as successful builds', () => {
  const before = process.cwd()
  for (const [result, expected] of [
    [{ error: new Error('pnpm unavailable') }, /pnpm unavailable/],
    [{ status: 2, signal: null }, /exit code 2/],
    [{ status: null, signal: 'SIGTERM' }, /signal SIGTERM/],
  ]) {
    assert.throws(() => buildSqlitePlugin({ spawnSync: () => result }), expected)
    assert.equal(process.cwd(), before)
  }
})

test('the actual postinstall lifecycle propagates a compiler failure and accepts a successful build', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-postinstall-'))
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }))
  const actual = JSON.parse(fs.readFileSync(new URL('../../sqlite-plugin/package.json', import.meta.url), 'utf8'))
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ private: true,
    scripts: { postinstall: actual.scripts.postinstall, build: 'node build.cjs' } }))
  fs.writeFileSync(path.join(folder, 'build.cjs'), 'process.exit(Number(process.env.GGR_FIXTURE_COMPILER_EXIT))')
  for (const code of [7, 0]) {
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'postinstall', '--silent'], {
      cwd: folder, env: { ...process.env, GGR_FIXTURE_COMPILER_EXIT: String(code) },
      shell: process.platform === 'win32', encoding: 'utf8', timeout: 15000,
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null)
    assert.equal(result.status === 0, code === 0, result.stderr)
  }
})
