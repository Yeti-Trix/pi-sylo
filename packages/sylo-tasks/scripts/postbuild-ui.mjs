import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'skills/tasks/routes/tasks/fallback.md')
fs.copyFileSync(path.join(root, 'ui/fallback.md'), dest)
console.log('[sylo-tasks] copied ui/fallback.md →', dest)