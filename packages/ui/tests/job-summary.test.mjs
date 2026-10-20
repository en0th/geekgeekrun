import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const compiled = await build({ entryPoints: [new URL('../src/main/flow/OPEN_SETTING_WINDOW/utils/db/worker/job-summary.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' })
const { summarizeJobs, cleanDescription } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const row = (encryptJobId, description, extra = {}) => ({ encryptJobId, description, ...extra })

test('JD summary counts documents, aliases and whole skill names, never raw occurrences', () => {
  const summary = summarizeJobs([row('a', 'JavaScript JS Python python PYTHON；Node.js、C++、.NET'), row('a', 'Java'),
    row('b', 'Java SQL；google rusted，dockerized 不是技能'), row('c', null)])
  assert.deepEqual([summary.sampledJobs, summary.withDescription, summary.missingDescription], [3, 2, 1])
  for (const name of ['Java', 'JavaScript', 'Python', 'Node.js', 'C++', '.NET', 'SQL'])
    assert.deepEqual(summary.skills.find(s => s.term === name), { term: name, jobs: 1, percent: 50 })
  for (const name of ['Go', 'Rust', 'Docker']) assert.equal(summary.skills.find(s => s.term === name), undefined)
})

test('JD text cleanup excludes markup, scripts, contacts and recruiting boilerplate', () => {
  const text = '<p>熟练 Python &amp; SQL</p><script>Java Java</script><style>Rust</style> https://example.com/Go hr@example.com'
  assert.equal(cleanDescription(text), '熟练 Python & SQL')
  assert.equal(cleanDescription('&#x3c;script&#x3e;Java&#x3c;/script&#x3e;'), '')
  const summary = summarizeJobs([row('a', text), row('b', '熟练 岗位职责 公司 团队 数据仓库 数据仓库 数据仓库'), row('c', '<br> &nbsp;')])
  assert.equal(summary.withDescription, 2)
  assert.deepEqual(summary.skills.map(s => s.term).sort(), ['Python', 'SQL'])
  assert.ok(summary.terms.every(s => !['公司', '团队', '熟练', 'python', 'sql'].includes(s.term)))
  assert.ok(summary.terms.every(s => s.jobs === 1))
})

test('empty samples and unknown historical dates remain explicit', () => {
  const empty = summarizeJobs([])
  assert.deepEqual([empty.withDescription, empty.skills.length, empty.terms.length], [0, 0, 0])
  const summary = summarizeJobs([row('a', '', { discoveryOrigin: 'legacy' }),
    row('b', 'Python', { discoveryOrigin: 'import', firstSeenAt: '2026-10-19 00:00:00.000' }),
    row('c', 'Python', { discoveryOrigin: 'capture', firstSeenAt: '2026-10-20 00:00:00.000' })])
  assert.deepEqual(summary.origins, { capture: 1, import: 1, legacy: 1 })
  assert.equal(summary.unknownFirstSeen, 1)
  assert.equal(summary.firstSeenFrom, '2026-10-19 00:00:00.000')
  assert.equal(summary.firstSeenTo, '2026-10-20 00:00:00.000')
})

test('versioned aliases and Chinese skill phrases do not leak into the general word list', () => {
  const summary = summarizeJobs([row('a', 'Vue3、python3、ASP.NET；机器学习、机器学习、数据可视化')])
  assert.deepEqual(summary.skills.map(s => s.term).sort(), ['.NET', 'Python', 'Vue', '数据可视化', '机器学习'].sort())
  assert.deepEqual(summary.terms, [])
})
