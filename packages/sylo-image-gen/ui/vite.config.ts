import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// D1 hardening (§8 step 9): the committed route bundle must always be the
// production transform. Vite derives isProduction from process.env.NODE_ENV
// BEFORE config mode is considered, so an inherited NODE_ENV=development once
// leaked a dev bundle (jsxDEV calls + absolute source-path embeds) into this
// shipped directory. Pinning the env here (the config function runs before
// resolveConfig) makes `vite build` prod-safe regardless of the invoking env.
process.env.NODE_ENV = 'production'

export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../skills/image-gen/routes/images'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
})