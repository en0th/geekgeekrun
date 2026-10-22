import buildSqlitePlugin from './steps/build-sqlite-plugin.mjs'
try { buildSqlitePlugin() }
catch (error) {
  console.error('SQLite plugin build failed:', error)
  process.exitCode = 1
}
