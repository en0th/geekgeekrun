const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const transient = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST'])
const unsupportedDirectorySync = new Set(['EINVAL', 'EPERM', 'EACCES', 'ENOTSUP', 'EISDIR', 'EBADF'])

// Injectable I/O is used only by fault-injection tests; production uses the real filesystem.
function createAtomicFileIO({ io = fs, pause = sleep } = {}) {
  function syncDirectory(file) {
    let fd
    try { fd = io.openSync(path.dirname(file), 'r'); io.fsyncSync(fd) }
    catch (error) { if (!unsupportedDirectorySync.has(error.code)) throw error }
    finally { if (fd !== undefined) io.closeSync(fd) }
  }
  function bytes(value) {
    if (typeof value === 'string' || value instanceof Uint8Array) return Buffer.from(value)
    throw new TypeError('文件内容必须是文本或字节数组')
  }
  function stage(file, content, tag = randomUUID()) {
    io.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = file + '.' + tag + '.tmp'
    let fd, created = false
    try {
      fd = io.openSync(temporary, 'wx', 0o600)
      created = true
      io.writeFileSync(fd, content)
      io.fsyncSync(fd)
      io.closeSync(fd); fd = undefined
      return { file, temporary, content }
    } catch (error) {
      if (fd !== undefined) { try { io.closeSync(fd) } catch {} }
      if (created) cleanup({ temporary })
      throw error
    }
  }
  function publish(item, createOnly = false) {
    let committed = false
    try {
      if (createOnly) {
        // Unlike exists()+rename(), this cannot overwrite a concurrently saved setting.
        try { io.linkSync(item.temporary, item.file) }
        catch (error) { if (error.code === 'EEXIST') return false; throw error }
      } else {
        for (let attempt = 0; ; attempt++) {
          try { io.renameSync(item.temporary, item.file); break }
          catch (error) {
            if (!transient.has(error.code) || attempt >= 5) throw error
            pause(10 * (attempt + 1))
          }
        }
      }
      committed = true
      syncDirectory(item.file)
      return true
    } catch (error) {
      // Replacement succeeded but the directory sync failed: callers must not claim
      // the old version is still current. Batch rollback includes this file too.
      if (committed) error.atomicCommitted = true
      throw error
    }
  }
  function cleanup(item) {
    try { io.rmSync(item.temporary, { force: true }) }
    catch { console.warn('临时文件暂时无法清理：' + path.basename(item.temporary)) }
  }
  function writeFileAtomicSync(file, value, { createOnly = false } = {}) {
    const item = stage(file, bytes(value))
    try { return publish(item, createOnly) }
    finally { cleanup(item) }
  }
  function encodeJson(value) {
    const text = JSON.stringify(value)
    if (text === undefined) throw new TypeError('JSON 内容不能为空')
    return text
  }
  function writeJsonAtomicSync(file, value, options) {
    return writeFileAtomicSync(file, encodeJson(value), options)
  }
  function writeFilesAtomicSync(entries) {
    const files = entries.map(([file, value]) => ({ file: path.resolve(file), content: bytes(value) }))
    if (new Set(files.map(item => item.file)).size !== files.length) throw new Error('批量写入不能包含重复路径')
    const staged = [], published = [], batchId = randomUUID()
    try {
      // Read old bytes and prepare every new file before publishing any of them.
      for (const item of files) {
        let before = null
        try { before = io.readFileSync(item.file) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        const prepared = { ...stage(item.file, item.content, batchId), before }
        staged.push(prepared)
        // Reserve durable rollback bytes before any replacement. Recovery must not
        // need fresh disk space if a later rename fails after the disk has filled.
        if (before !== null) prepared.backup = stage(item.file, before, batchId + '.rollback')
      }
      for (const item of staged) {
        try { publish(item); published.push(item) }
        catch (error) { if (error.atomicCommitted) published.push(item); throw error }
      }
    } catch (error) {
      const rollbackErrors = []
      for (const item of published.reverse()) {
        try {
          // Do not knowingly roll back a newer writer's bytes.
          if (!io.readFileSync(item.file).equals(item.content)) throw new Error('检测到并发修改，未覆盖较新的文件')
          if (item.before === null) { io.unlinkSync(item.file); syncDirectory(item.file) }
          else publish(item.backup)
        } catch (rollbackError) {
          item.retainBackup = true
          rollbackErrors.push(rollbackError)
        }
      }
      if (rollbackErrors.length) {
        const recoveryFiles = staged.filter(item => item.retainBackup && item.backup && io.existsSync(item.backup.temporary)).map(item => item.backup.temporary)
        throw Object.assign(new AggregateError([error, ...rollbackErrors], '保存失败，部分回滚未能完成；已保留可用的回滚副本，请检查文件后重试'), { recoveryFiles })
      }
      throw error
    } finally {
      for (const item of staged) {
        cleanup(item)
        if (item.backup && !item.retainBackup) cleanup(item.backup)
      }
    }
  }
  return { writeFileAtomicSync, writeJsonAtomicSync, writeFilesAtomicSync }
}

module.exports = { ...createAtomicFileIO(), createAtomicFileIO }
