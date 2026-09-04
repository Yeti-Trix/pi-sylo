#!/usr/bin/env node
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const uiRoot = path.join(root, 'ui')

// Force production transform: when launched from the Sylo app (Rebuild &
// restart), NODE_ENV=development leaks in and the React JSX dev transform
// embeds absolute source paths (C:/Users/<operator>/...) into the built
// assets. Those assets get mirrored into test-fixtures — never ship them.
process.env.NODE_ENV = 'production'

execSync('vite build --config ui/vite.config.ts', { cwd: root, stdio: 'inherit' })

const dest = path.join(root, 'skills/sylo-workflows/routes/workflows/fallback.md')
fs.copyFileSync(path.join(uiRoot, 'fallback.md'), dest)
console.log('[sylo-workflows] copied ui/fallback.md ->', dest)