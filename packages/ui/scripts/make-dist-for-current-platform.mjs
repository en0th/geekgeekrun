import builder from 'electron-builder'
import url from 'node:url'
import path from 'node:path'
import { buildTargetListMapByPlatform, osPlatformToBuildCommandMap } from './vars/os.mjs'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export function getBuildParameters(platform = process.platform, arch = process.arch) {
  const buildTargets = buildTargetListMapByPlatform[platform]
  const platformKeyForBuildParameter = osPlatformToBuildCommandMap[platform]
  if (!buildTargets?.length || !platformKeyForBuildParameter) {
    throw new Error('Cannot build for platform: ' + platform)
  }
  const buildParameter = {
    publish: 'never',
    projectDir: path.join(__dirname, '..'),
    // An object is merged with the auto-discovered YAML, duplicating extraResources.
    config: path.join(__dirname, '../electron-builder.yml')
  }
  buildParameter[platformKeyForBuildParameter] = buildTargets.map((it) => `${it}:${arch}`)
  return buildParameter
}

export default async function makeDistForCurrentPlatform() {
  return await builder.build(getBuildParameters())
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  makeDistForCurrentPlatform().catch(error => { console.error(error); process.exitCode = 1 })
}
