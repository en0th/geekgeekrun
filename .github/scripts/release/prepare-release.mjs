// Decides whether a push to master should produce a new UI release, bumps the version and
// writes user-facing release notes summarised by Claude.
//
// Usage: node prepare-release.mjs [--dry-run]
//   --dry-run  print the decision and notes, don't touch any file
//
// Env:
//   ANTHROPIC_API_KEY      enables the Claude summary; without it the notes fall back to a
//                          grouped change list and the release is created as a draft
//   RELEASE_NOTES_MODEL    optional model override (default claude-opus-5-5)
//   GITHUB_REPOSITORY      owner/repo, used for compare links
//   GITHUB_OUTPUT          set by Actions; decisions are written here
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'

const DRY_RUN = process.argv.includes('--dry-run')
const MODEL = process.env.RELEASE_NOTES_MODEL || 'claude-opus-5-5'
// keeps the request comfortably small; larger diffs keep their stat line but lose the patch
const MAX_PATCH_CHARS = 400_000
const TAG_PREFIX = 'ui-v'
const VERSION_COMMIT_RE = /^ui-v\d+\.\d+\.\d+(-[\w.]+)?$/

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
const repoRoot = git('rev-parse', '--show-toplevel')
process.chdir(repoRoot)

const UI_PACKAGE_JSON = 'packages/ui/package.json'
const BUILD_INFO_JSON = 'packages/ui/src/common/build-info.json'

// changes outside these paths (workflows, docs, ...) don't ship a new app version
const RELEASE_RELEVANT_PATHS = [/^packages\//, /^package\.json$/, /^pnpm-lock\.yaml$/]
const PATCH_EXCLUDES = [
  ':(exclude)pnpm-lock.yaml',
  ':(exclude)**/package-lock.json',
  ':(exclude)**/tests/**',
  ':(exclude)packages/ui/src/common/build-info.json'
]

const AREA_NAMES = [
  [/^packages\/ui\/src\/renderer\//, '桌面端界面'],
  [/^packages\/ui\//, '桌面端'],
  [/^packages\/geek-auto-start-chat-with-boss\//, '自动开聊'],
  [/^packages\/run-core-of-geek-auto-start-chat-with-boss\//, '运行核心'],
  [/^packages\/sqlite-plugin\//, '本地数据'],
  [/^packages\/dingtalk-plugin\//, '钉钉通知'],
  [/^packages\/laodeng\//, '浏览器插件'],
  [/^packages\/([^/]+)\//, '其他模块']
]

// ---------- collect ----------

function findBaseCommit() {
  // every release, manual or automatic, is a commit named after its tag (ui-vX.Y.Z)
  const [hash, subject] = git(
    'log',
    '-1',
    '--format=%H%x1f%s',
    '--extended-regexp',
    `--grep=^${TAG_PREFIX}[0-9]+\\.[0-9]+\\.[0-9]+`
  ).split('\x1f')
  if (!hash || !VERSION_COMMIT_RE.test(subject)) {
    throw new Error('找不到上一个版本提交（ui-vX.Y.Z），无法确定本次发布的变更范围')
  }
  return { hash, version: subject.slice(TAG_PREFIX.length) }
}

function collectCommits(base) {
  const raw = git('log', `${base}..HEAD`, '--format=%H%x1f%P%x1f%an%x1f%s%x1f%b%x1e')
  return raw
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, parents, author, subject, body] = entry.split('\x1f')
      return {
        hash,
        isMerge: parents.trim().split(/\s+/).length > 1,
        author,
        subject: subject.trim(),
        body: (body ?? '').replace(/^Co-Authored-By:.*$/gim, '').trim()
      }
    })
    .filter((c) => !VERSION_COMMIT_RE.test(c.subject))
}

function changedFiles(base) {
  return git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean)
}

function collectDiff(base) {
  const stat = git('diff', '--stat=200', base, 'HEAD', '--', '.', ...PATCH_EXCLUDES)
  const files = git('diff', '--name-only', base, 'HEAD', '--', '.', ...PATCH_EXCLUDES)
    .split('\n')
    .filter(Boolean)
  // add patches smallest first so one huge generated file can't crowd out the rest
  const patches = files
    .map((file) => ({ file, patch: git('diff', base, 'HEAD', '--', file) }))
    .sort((a, b) => a.patch.length - b.patch.length)
  let budget = MAX_PATCH_CHARS
  const included = []
  const omitted = []
  for (const p of patches) {
    if (p.patch.length <= budget) {
      included.push(p.patch)
      budget -= p.patch.length
    } else {
      omitted.push(p.file)
    }
  }
  return { stat, patch: included.join('\n'), omitted }
}

// ---------- version ----------

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  if (!m) throw new Error(`无法解析版本号：${v}`)
  return m.slice(1, 4).map(Number)
}

function decideBump(commits) {
  // markers only count in subject lines, so a commit body that merely mentions one doesn't apply it
  const text = commits.map((c) => c.subject).join('\n')
  const explicit = [...text.matchAll(/\[release:(major|minor|patch)\]/gi)].map((m) =>
    m[1].toLowerCase()
  )
  for (const level of ['major', 'minor', 'patch']) {
    if (explicit.includes(level)) return level
  }
  const isFeature = (s) => /^(feat|feature|add)\b/i.test(s) || /新增|增加|新功能/.test(s)
  return commits.some((c) => !c.isMerge && isFeature(c.subject)) ? 'minor' : 'patch'
}

function bumpVersion(version, level) {
  const [major, minor, patch] = parseVersion(version)
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

function writeVersion(version) {
  // same fields as packages/ui/scripts/steps/increase-package-version.mjs
  const pkg = JSON.parse(fs.readFileSync(UI_PACKAGE_JSON, 'utf8'))
  pkg.version = version
  fs.writeFileSync(UI_PACKAGE_JSON, JSON.stringify(pkg, null, 2))
  const info = JSON.parse(fs.readFileSync(BUILD_INFO_JSON, 'utf8'))
  info.name = pkg.name
  info.version = version
  info.buildVersion = typeof info.buildVersion === 'number' ? info.buildVersion + 1 : 1
  info.buildTime = Date.now()
  info.buildHash = git('rev-parse', 'HEAD')
  fs.writeFileSync(BUILD_INFO_JSON, JSON.stringify(info, null, 2))
}

// ---------- notes ----------

const SYSTEM_PROMPT = `你是「GeekGeekRun（BOSS 炸弹）」的发布说明撰写者。GeekGeekRun 是一款帮助求职者在 BOSS 直聘上自动筛选职位、自动开聊的桌面应用，用户大多不是程序员。

你会收到两个版本之间的提交记录、变更文件统计和代码差异，请据此写一份面向用户的中文发布说明。

要求：
- 先读懂代码差异，再写说明。提交信息只是线索，以代码实际改动为准；不要编造代码里没有的功能。
- 不要逐条罗列提交，也不要出现提交哈希、分支名、文件路径或函数名。把相关改动合并成用户能感知的变化来描述，说清楚「改了什么、对用户有什么用、怎么用」。
- 纯内部的改动（重构、依赖、构建脚本、测试）只在确实影响用户时简要提一句，否则归入「其他改进」一行带过或省略。
- 如果有需要用户注意的事项（新增或变化的设置项、默认行为变化、数据会被修改或删除的操作、兼容性），单独列出。
- 语气平实、准确，不要营销腔，不要使用表情符号。

输出格式（Markdown，只输出正文，不要额外的开场白或结语；某一节没有内容就整节省略）：

## 更新概要
用一到两句话概括这个版本最重要的变化。

## 新功能
- **功能名称**：说明

## 问题修复
- 说明

## 改进
- 说明

## 注意事项
- 说明`

function buildUserContent({ fromVersion, toVersion, commits, diff }) {
  const commitText = commits
    .map((c) => {
      const lines = [`- ${c.isMerge ? '[合并] ' : ''}${c.subject}（作者：${c.author}）`]
      if (c.body) lines.push(c.body.replace(/^/gm, '    '))
      return lines.join('\n')
    })
    .join('\n')
  const omittedText = diff.omitted.length
    ? `\n以下文件的差异过大未附上，只能参考上面的统计和提交记录：\n${diff.omitted.map((f) => `- ${f}`).join('\n')}\n`
    : ''
  return `版本：${fromVersion} → ${toVersion}

<commits>
${commitText}
</commits>

<diff_stat>
${diff.stat}
</diff_stat>
${omittedText}
<diff>
${diff.patch}
</diff>`
}

async function summariseWithClaude(input) {
  const client = new Anthropic()
  // server-side fallback re-runs a declined request on another model inside the same call
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserContent(input) }]
  })
  if (response.stop_reason === 'refusal') {
    throw new Error(`模型拒绝生成发布说明：${response.stop_details?.category ?? 'unknown'}`)
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('发布说明超出长度上限被截断')
  }
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  if (!text) throw new Error('模型没有返回发布说明')
  return text
}

// used only when Claude isn't available; the release is created as a draft for manual editing
function fallbackNotes({ commits, files }) {
  const areas = new Map()
  for (const file of files) {
    const area = AREA_NAMES.find(([re]) => re.test(file))?.[1]
    if (area) areas.set(area, (areas.get(area) ?? 0) + 1)
  }
  const subjects = commits.filter((c) => !c.isMerge).map((c) => c.subject)
  return [
    '> 自动总结不可用（未配置 ANTHROPIC_API_KEY 或调用失败），以下为按模块整理的草稿，请编辑后再发布。',
    '',
    '## 涉及模块',
    ...[...areas].map(([area, n]) => `- ${area}（${n} 个文件）`),
    '',
    '## 待整理的改动',
    ...subjects.map((s) => `- ${s}`)
  ].join('\n')
}

function footer({ baseHash, fromVersion, toVersion, commits }) {
  const repo = process.env.GITHUB_REPOSITORY
  // merge commits only record who merged, not who wrote the change
  const contributors = [...new Set(commits.filter((c) => !c.isMerge).map((c) => c.author))].filter(
    (a) => a && !/\[bot\]$/.test(a)
  )
  // blank line first: a `---` right under a text line would turn that line into a heading
  const lines = ['', '', '---']
  if (contributors.length) lines.push(`感谢本版本的贡献者：${contributors.join('、')}`, '')
  if (repo) {
    lines.push(
      `完整变更：https://github.com/${repo}/compare/${baseHash.slice(0, 12)}...${TAG_PREFIX}${toVersion}（${fromVersion} → ${toVersion}）`
    )
  }
  return lines.join('\n')
}

// ---------- output ----------

function setOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT
  for (const [key, value] of Object.entries(outputs)) {
    const str = String(value)
    if (file) {
      const delimiter = `EOF_${crypto.randomUUID()}`
      fs.appendFileSync(file, `${key}<<${delimiter}\n${str}\n${delimiter}\n`)
    }
    if (!file || DRY_RUN) {
      console.log(`\n===== ${key} =====\n${str}`)
    }
  }
}

async function main() {
  // only the subject line: a body that merely mentions the marker must not skip the release
  const headSubject = git('log', '-1', '--format=%s')
  if (/\[(skip release|release skip)\]/i.test(headSubject)) {
    console.log('HEAD commit asks to skip the release')
    return setOutputs({ skip: true })
  }

  const base = findBaseCommit()
  const commits = collectCommits(base.hash)
  const files = changedFiles(base.hash)
  if (!commits.length || !files.some((f) => RELEASE_RELEVANT_PATHS.some((re) => re.test(f)))) {
    console.log(`no app changes since ${TAG_PREFIX}${base.version}, nothing to release`)
    return setOutputs({ skip: true })
  }

  const fromVersion = JSON.parse(fs.readFileSync(UI_PACKAGE_JSON, 'utf8')).version
  const level = decideBump(commits)
  const toVersion = bumpVersion(fromVersion, level)
  console.log(`${commits.length} commits since ${base.version}; ${level} bump ${fromVersion} -> ${toVersion}`)

  let notes
  let draft = false
  const input = { fromVersion, toVersion, commits, diff: collectDiff(base.hash) }
  if (input.diff.omitted.length) {
    console.log(`diff too large, patch omitted for: ${input.diff.omitted.join(', ')}`)
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      notes = await summariseWithClaude(input)
    } catch (err) {
      console.log(`::warning::生成发布说明失败，改为草稿发布：${err?.message ?? err}`)
    }
  } else {
    console.log('::warning::未配置 ANTHROPIC_API_KEY，发布说明为草稿，需要人工编辑后发布')
  }
  if (!notes) {
    notes = fallbackNotes({ commits, files })
    draft = true
  }
  notes += footer({ baseHash: base.hash, fromVersion, toVersion, commits })

  if (!DRY_RUN) writeVersion(toVersion)
  setOutputs({
    skip: false,
    version: toVersion,
    tag: `${TAG_PREFIX}${toVersion}`,
    bump: level,
    draft,
    notes
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
