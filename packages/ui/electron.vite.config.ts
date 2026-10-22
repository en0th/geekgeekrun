import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { presetUno, presetAttributify, presetIcons } from 'unocss'
import transformerDirective from '@unocss/transformer-directives'
import Replace from 'unplugin-replace/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { rendererBuildReport } from './scripts/renderer-build-report'

process.env = { ...process.env, ...loadEnv(process.env.NODE_ENV!, process.cwd()) }
const mainPlugins = [
  externalizeDepsPlugin({
    exclude: [
      '@geekgeekrun/utils',
      'find-chrome-bin',
      '@geekgeekrun/launch-bosszhipin-login-page-with-preload-extension'
    ]
  })
]
const preloadPlugins = [externalizeDepsPlugin()]
const rendererPlugins = [
  vue(),
  Components({ dts: false, dirs: [], resolvers: [ElementPlusResolver({ importStyle: false })] }),
  UnoCSS({
    presets: [presetUno(), presetAttributify(), presetIcons()],
    transformers: [transformerDirective()]
  }),
  ...(process.env.GEEKGEEKRUN_RENDERER_REPORT
    ? [rendererBuildReport(process.env.GEEKGEEKRUN_RENDERER_REPORT)] : [])
]
if (process.env.NODE_ENV) {
  ;[mainPlugins, preloadPlugins, rendererPlugins].forEach((pluginList) => {
    pluginList.push(
      Replace({
        delimiters: ['', ''],
        sourcemap: true,
        include: ['**'],
        values: [
          {
            find: /process.env.NODE_ENV/g,
            replacement: `'${process.env.NODE_ENV}'` as string
          }
        ]
      })
    )
  })
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: []
      },
      minify: process.env.NODE_ENV === 'development' ? undefined : 'terser',
      watch: process.env.NODE_ENV === 'development' ? {} : undefined
    },
    plugins: mainPlugins
  },
  preload: {
    plugins: preloadPlugins,
    build: {
      minify: process.env.NODE_ENV === 'development' ? undefined : 'terser',
      watch: process.env.NODE_ENV === 'development' ? {} : undefined
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: rendererPlugins,
    build: {
      rollupOptions: {
        output: {
          // Only the async chart view imports this renderer; keep its cache separate.
          manualChunks(id) {
            if (id.replace(/\\/g, '/').includes('/node_modules/zrender/')) return 'chart-renderer'
            return undefined
          }
        }
      },
      minify: process.env.NODE_ENV === 'development' ? undefined : 'terser'
    }
  }
})
