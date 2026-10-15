import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// D1 hardening (imagegen twin parity — its §8 step 9 note): the committed
// route bundle must always be the production transform. Vite derives
// isProduction from process.env.NODE_ENV BEFORE config mode is considered, so
// an inherited NODE_ENV=development could leak a dev bundle (jsxDEV calls +
// absolute source-path embeds) into this shipped directory. Pinning the env
// here (the config function runs before resolveConfig) makes `vite build`
// prod-safe regardless of the invoking env.
process.env.NODE_ENV = 'production'

export default defineConfig({
  root: resolve(__dirname),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../skills/video-gen/routes/videos'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
})