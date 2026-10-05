import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInline, parseMarkdown } from '../src/renderer/src/page/Ux/markdown.js'

test('inline bold, code and links become tokens, never HTML', () => {
  assert.deepEqual(parseInline('a **b** `c` [d](https://x.y/z) <img src=x>'), [
    { type: 'text', text: 'a ' },
    { type: 'strong', text: 'b' },
    { type: 'text', text: ' ' },
    { type: 'code', text: 'c' },
    { type: 'text', text: ' ' },
    { type: 'link', text: 'd', href: 'https://x.y/z' },
    { type: 'text', text: ' <img src=x>' }
  ])
})

test('bare URLs are links; trailing Chinese punctuation is left out', () => {
  assert.deepEqual(parseInline('完整变更：https://github.com/a/b/compare/x...y（0.18 → 0.19）'), [
    { type: 'text', text: '完整变更：' },
    { type: 'link', text: 'https://github.com/a/b/compare/x...y', href: 'https://github.com/a/b/compare/x...y' },
    { type: 'text', text: '（0.18 → 0.19）' }
  ])
})

test('javascript: links are not links', () => {
  assert.deepEqual(parseInline('[x](javascript:alert(1))'), [{ type: 'text', text: '[x](javascript:alert(1))' }])
})

test('release notes split into headings, paragraphs, lists and rules', () => {
  const blocks = parseMarkdown('## 更新概要\n0.19.0 新增\n任务队列\n\n## 新功能\n- **队列**：说明\n- 第二项\n\n---\n感谢')
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['h', 'p', 'h', 'ul', 'hr', 'p']
  )
  assert.equal(blocks[0].level, 2)
  assert.equal(blocks[1].inline[0].text, '0.19.0 新增 任务队列')
  assert.equal(blocks[3].items.length, 2)
  assert.deepEqual(blocks[3].items[0][0], { type: 'strong', text: '队列' })
})
