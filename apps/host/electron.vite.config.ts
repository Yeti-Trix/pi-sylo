import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        formats: ['cjs'],
      },
      rollupOptions: {
        output: {
          // Host package.json has "type":"module"; .js would be loaded as ESM and break require().
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    publicDir: resolve(__dirname, 'test-fixtures'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@skill-builder': resolve(__dirname, '../../packages/skill-builder'),
      },
    },
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 9240,
      strictPort: true,
    },
  },
})
