import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const files = ['LAUNCH_BOSS_SITE/index.ts', 'READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts']
function syntax(file) {
  const source = fs.readFileSync(new URL('../src/main/flow/' + file, import.meta.url), 'utf8')
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}
function walk(node, visit) { visit(node); ts.forEachChild(node, child => walk(child, visit)) }
function compileFunction(node, source, globals = {}) {
  const js = ts.transpileModule('(' + node.getText(source) + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText
  return vm.runInNewContext(js, globals)
}

test('browser evaluate strings and callbacks remain executable JavaScript after type erasure', () => {
  let count = 0
  for (const file of files) {
    const source = syntax(file)
    walk(source, node => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) ||
          !['evaluate', 'evaluateHandle', 'waitForFunction'].includes(node.expression.name.text)) return
      const argument = node.arguments[0]
      if (!argument) return
      if (ts.isStringLiteralLike(argument)) { new vm.Script(argument.text); count++ }
      else if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
        assert.equal(typeof compileFunction(argument, source), 'function'); count++
      }
    })
  }
  assert.ok(count > 20)
  const source = syntax('READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts')
  let getFriends
  walk(source, node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'friendListData') {
      getFriends = node.initializer.expression.arguments[0]
    }
  })
  const list = [{ encryptJobId: 'fixture-job' }]
  assert.deepEqual(compileFunction(getFriends, source, {
    document: { querySelector: () => ({ __vue__: { list } }) }
  })(), list)
  assert.equal(compileFunction(getFriends, source, { document: { querySelector: () => null } })().length, 0)
})

test('both actual chat-record mappers retain image dimensions and sender IDs', () => {
  for (const file of files) {
    const source = syntax(file)
    let mapper
    walk(source, node => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'chatRecordList') {
        mapper = node.initializer.arguments[0]
      }
    })
    const map = compileFunction(mapper, source, {
      currentUserInfo: { encryptUserId: 'fixture-user' }, userInfo: { encryptUserId: 'fixture-user' },
      bossInfo: { encryptBossId: 'fixture-boss' }
    })
    const row = map({ mid: 7, type: 'image', style: 'sent', isSelf: true, text: '',
      image: { originImage: { url: 'https://fixture.invalid/image', width: 640, height: 480 } } })
    assert.equal(row.encryptFromUserId, 'fixture-user')
    assert.equal(row.encryptToUserId, 'fixture-boss')
    assert.equal(row.imageWidth, 640)
    assert.equal(row.imageHeight, 480)
  }
})
