import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Plugin } from 'vite'

// Opt-in build evidence, kept outside the shipped renderer. Never copy module source.
export function rendererBuildReport(destination: string): Plugin {
  if (!path.isAbsolute(destination)) throw new Error('Renderer report path must be absolute')
  return {
    name: 'renderer-build-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).flatMap(chunk => {
        if (chunk.type !== 'chunk') return []
        return [{
        file: chunk.fileName, entry: chunk.isEntry, facade: chunk.facadeModuleId,
        bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length,
        imports: chunk.imports, dynamicImports: chunk.dynamicImports,
        modules: Object.entries(chunk.modules).map(([id, info]) => ({
          id: path.relative(process.cwd(), id), bytes: info.renderedLength,
        })).sort((a, b) => b.bytes - a.bytes),
        }]
      }).sort((a, b) => b.bytes - a.bytes)
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
      fs.writeFileSync(destination, JSON.stringify({ chunks }, null, 2), { mode: 0o600 })
    },
  }
}
