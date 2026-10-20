import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const testName = /\.test\.(?:mjs|cjs|js)$/

function testFiles(folder) {
  if (!fs.existsSync(folder)) return []
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(folder, entry.name)
    if (entry.isDirectory()) return testFiles(file)
    return entry.isFile() && testName.test(entry.name) ? [file] : []
  })
}

export function discoverTests(root = repositoryRoot, electron = false) {
  const packages = path.join(root, 'packages')
  const groups = electron
    ? [path.join(packages, 'sqlite-plugin/tests')]
    : fs.readdirSync(packages, { withFileTypes: true }).filter(entry => entry.isDirectory())
      .map(entry => path.join(packages, entry.name, 'tests'))
  const files = groups.flatMap(testFiles)
  if (electron && !files.length) throw Error('未找到 SQLite 原生回归测试集')
  if (electron) files.push(path.join(packages, 'ui/tests/favorites.test.mjs'))
  else files.push(...testFiles(path.join(root, '.github/scripts/release/tests')),
    ...testFiles(path.join(root, 'scripts/ci/tests')))
  if (!files.length || files.some(file => !fs.statSync(file).isFile())) throw Error('未找到完整的回归测试集')
  return [...new Set(files)].sort()
}

export function assertReport(file, { requireNative = false } = {}) {
  const text = fs.readFileSync(file, 'utf8')
  if (!/<testsuites?\b/.test(text) || !/<testcase\b/.test(text)) throw Error('测试报告为空或无效，不能视为通过')
  if (/<(?:failure|error)\b/.test(text)) throw Error('测试报告包含失败，不能视为通过')
  if (requireNative && (/<skipped\b/.test(text) || /\bskipped=["'][1-9]/.test(text))) {
    throw Error('CI 不允许跳过测试；请检查原生 SQLite 的运行时和 ABI')
  }
}
