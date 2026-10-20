import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { repositoryRoot, discoverTests, assertReport } from './test-suite.mjs'

const options = new Set(process.argv.slice(2))
for (const option of options) {
  if (!['--electron', '--require-native'].includes(option)) throw Error('未知测试选项：' + option)
}
const electron = options.has('--electron')
const requireNative = electron || options.has('--require-native')
if (!electron && Number(process.versions.node.split('.')[0]) < 24) throw Error('完整回归请使用 Node.js 24 或更新版本')
const require = createRequire(path.join(repositoryRoot, 'packages/ui/package.json'))
const executable = electron ? require('electron') : process.execPath
const reportDir = path.join(repositoryRoot, '.ci-reports')
const reportFile = path.join(reportDir, electron ? 'electron-native.xml' : 'regression.xml')
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-ci-runtime-'))
const env = { ...process.env, GEEKGEEKRUN_RUNTIME_DIR: runtime,
  GEEKGEEKRUN_TASK_CONFIG_FILE: '', GEEKGEEKRUN_COLLECT_AUDIT_DIR: '' }
// A runner invoked from a regression probe still starts an independent suite.
delete env.NODE_TEST_CONTEXT
if (electron) env.ELECTRON_RUN_AS_NODE = '1'
else delete env.ELECTRON_RUN_AS_NODE

function execute(args) {
  const child = spawnSync(executable, args, { cwd: repositoryRoot, env, stdio: 'inherit', timeout: 15 * 60 * 1000 })
  if (child.error) throw child.error
  if (child.status !== 0) throw Error(`测试进程失败（${child.signal || child.status}）`)
}

try {
  fs.mkdirSync(reportDir, { recursive: true })
  fs.rmSync(reportFile, { force: true })
  if (requireNative) {
    // Native test files intentionally skip when the ABI is unavailable for local
    // development. CI must fail before those skips could produce a green run.
    execute(['--input-type=commonjs', '-e', `
      const {createRequire}=require('node:module');
      const fromUi=createRequire(${JSON.stringify(path.join(repositoryRoot, 'packages/ui/package.json'))});
      const Database=fromUi('better-sqlite3');
      const db=new Database(':memory:');
      if(db.prepare('SELECT 1 AS ok').get().ok!==1)throw Error('SQLite preflight failed');
      db.close();
      const expected=${JSON.stringify(electron ? require('electron/package.json').version : null)};
      if(expected&&process.versions.electron!==expected)throw Error('Unexpected Electron version: '+process.versions.electron);
      console.log('SQLite preflight OK; Node '+process.versions.node+'; ABI '+process.versions.modules);
    `])
  }
  const files = discoverTests(repositoryRoot, electron)
  console.log(`${electron ? 'Electron 原生' : '完整'}回归：${files.length} 个测试文件`)
  execute(['--test', ...(electron ? ['--test-concurrency=1'] : ['--test-isolation=none']),
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=junit', '--test-reporter-destination=' + reportFile, ...files])
  assertReport(reportFile, { requireNative })
  console.log('回归通过，报告：' + path.relative(repositoryRoot, reportFile))
} finally {
  fs.rmSync(runtime, { recursive: true, force: true })
}
