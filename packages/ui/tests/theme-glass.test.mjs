import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { sidebarGlassPresentation } from '../src/renderer/src/page/Ux/glass-support.js'
import { nativeWindowMaterial } from '../src/common/window-material.mjs'

test('Win10 and early Win11 never request unsupported native backgroundMaterial', () => {
  for (const release of ['10.0.19041', '10.0.19045', '10.0.22000', '', 'unknown']) {
    const material = nativeWindowMaterial('win32', release)
    assert.equal(material.backgroundMaterial, undefined)
    assert.equal(material.backgroundColor, '#ffffff')
  }
})
test('Win11 22H2+ retains native acrylic; macOS retains sidebar vibrancy', () => {
  for (const release of ['10.0.22621', '10.0.22631', '10.0.26100'])
    assert.equal(nativeWindowMaterial('win32', release).backgroundMaterial, 'acrylic')
  assert.equal(nativeWindowMaterial('darwin', '24.0.0').vibrancy, 'sidebar')
  assert.equal(nativeWindowMaterial('linux', '6.8.0').backgroundColor, '#ffffff')
})
test('Win10 receives renderer frost independently of native glass', () => {
  assert.deepEqual(sidebarGlassPresentation({ nativeGlass: false, supportsBackdrop: true }),
    { nativeGlass: false, effect: 'frosted', refracted: false })
})
test('native hosts keep the existing refraction enhancement', () => {
  assert.equal(sidebarGlassPresentation({ nativeGlass: true, supportsBackdrop: true }).effect, 'refracted')
})
test('missing CSS backdrop support has a readable static fallback', () => {
  for (const nativeGlass of [false, true])
    assert.equal(sidebarGlassPresentation({ nativeGlass, supportsBackdrop: false }).effect, 'static')
})
test('reduced transparency overrides even native glass', () => {
  for (const nativeGlass of [false, true])
    assert.equal(sidebarGlassPresentation({ nativeGlass, supportsBackdrop: true, reduceTransparency: true }).effect, 'static')
})

const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
const theme = read('../src/renderer/src/style/app-theme.css')
const tokens = Object.fromEntries([...theme.matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)].map(m => [m[1], m[2]]))
const luminance = color => color.slice(1).match(/../g).map(v => {
  const n = parseInt(v, 16) / 255
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
}).reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0)
const whiteContrast = color => 1.05 / (luminance(color) + 0.05)
for (const family of ['primary', 'success', 'warning', 'danger', 'info']) {
  test(`${family} button labels and semantic text retain readable contrast`, () => {
    for (const suffix of ['', '-dark-2']) {
      const token = `--el-color-${family}${suffix}`
      assert.ok(whiteContrast(tokens[token]) >= 4.5, `${token} contrasts with white`)
    }
    for (const suffix of ['3', '5', '7', '8', '9']) assert(tokens[`--el-color-${family}-light-${suffix}`])
  })
}
test('theme is globally imported after Element Plus, including teleported confirmations', () => {
  const entry = read('../src/renderer/src/main.ts')
  assert(entry.indexOf("import './style/app-theme.css'") > entry.indexOf("import 'element-plus/dist/index.css'"))
  assert.ok(whiteContrast(tokens['--ggr-primary-hover']) >= 4.5)
})
test('footer and runtime card no longer hardcode a competing button palette', () => {
  const css = read('../src/renderer/src/page/Ux/ux.css')
  assert(!/--el-button-(?:bg|border|hover-bg|active-bg)-color:\s*#/.test(css))
  assert(css.includes('.ux-shell.is-glass .ux-nav'))
  assert(!css.includes('.ux-shell:not(.is-vibrant) .ux-glass-backdrop'))
})
test('ending, deleting and replacing a database use explicit danger confirmation', () => {
  const ui = read('../src/renderer/src/page/Ux/index.js')
  for (const label of ['结束任务', '终止并开始', '删除', '恢复并重启'])
    assert(new RegExp(`"${label}",\\s*\\{ danger: true \\}`).test(ui), label)
  assert(ui.includes('el-button--danger ggr-danger-confirm'))
})
test('toast colours use the same semantic tokens as buttons and notices', () => {
  const toast = read('../src/renderer/src/features/Toast/ToastStack.vue')
  for (const role of ['primary', 'success', 'warning', 'danger']) assert(toast.includes(`var(--el-color-${role})`))
  assert(!/#(?:34c759|0a84ff|ff9f0a|ff3b30)/i.test(toast))
})
