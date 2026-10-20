import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ggr-login-process-'))
const outfile = path.join(folder, 'assistant.cjs')
await build({ entryPoints: [fileURLToPath(new URL('../src/main/window/cookieAssistantWindow.ts', import.meta.url))],
  outfile, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent', plugins: [{
    name: 'isolated-process-services', setup(builder) {
      builder.onResolve({ filter: /^electron$|node:child_process|^JSONStream$|utils\/toast$|browser-history$|config-with-browser-assistant$/ }, args => ({ path: args.path, namespace: 'login-process-fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'login-process-fixture' }, () => ({ contents: `
        export const app = globalThis.__ggrLoginProcess.app;
        export const ipcMain = globalThis.__ggrLoginProcess.ipc;
        export const BrowserWindow = globalThis.__ggrLoginProcess.Window;
        export const spawn = (...args) => globalThis.__ggrLoginProcess.spawn(...args);
        export const parse = () => new (require('node:stream').PassThrough)({objectMode:true});
        export const getLastUsedAndAvailableBrowser = async () => ({executablePath:'/fixture/chrome'});
        export const configWithBrowserAssistant = async () => {};
        export const sendToast = () => {};
      ` }))
    }
  }] })

test('login subprocess receives the application path in unpackaged production and development', async t => {
  t.after(() => { fs.rmSync(folder, { recursive: true, force: true }); delete globalThis.__ggrLoginProcess })
  const previousEnv = process.env.NODE_ENV
  t.after(() => { if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv })
  for (const mode of ['production', 'development']) for (const isPackaged of [false, true]) {
    process.env.NODE_ENV = mode
    const calls = []
    class Window extends EventEmitter {
      setAlwaysOnTop() {} focus() {} loadURL() {} show() {}
    }
    globalThis.__ggrLoginProcess = { app: { isPackaged, getAppPath: () => '/fixture/app' }, ipc: new EventEmitter(), Window,
      spawn: (...args) => { calls.push(args); const child = new EventEmitter(); child.stdio = [null, null, null, new PassThrough()]; return child } }
    const require = createRequire(import.meta.url)
    delete require.cache[require.resolve(outfile)]
    const { createCookieAssistantWindow } = require(outfile)
    createCookieAssistantWindow()
    const [launch] = globalThis.__ggrLoginProcess.ipc.listeners('launch-bosszhipin-login-page-with-preload-extension')
    await launch({})
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0][1], [...(isPackaged ? [] : ['/fixture/app']), '--mode=launchBossZhipinLoginPageWithPreloadExtension'])
  }
})
