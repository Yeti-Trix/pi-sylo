import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dest = path.join(root, 'skills/image-gen/routes/images/fallback.md')
const src = path.join(root, 'ui/fallback.md')

if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}