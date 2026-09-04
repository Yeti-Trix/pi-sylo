import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(
  process.env.APPDATA.replace(/\\/g, '/'),
  '@sylo/host/sylo-data/sylo.sqlite',
)
const newPath = 'C:\\Github\\sylo-user'

const db = new Database(dbPath, { readonly: false, timeout: 10000 })
db.pragma('journal_mode = WAL')

// Read current primary workspace row
const row = db
  .prepare('SELECT id, name, pi_cwd FROM workspaces ORDER BY sort_order ASC, created_at ASC LIMIT 1')
  .get()

console.log('Current primary workspace:')
console.log(JSON.stringify(row, null, 2))

if (!row) {
  console.error('No workspace row found!')
  process.exit(1)
}

if (row.pi_cwd === newPath) {
  console.log('Already pointing at ' + newPath + ' — nothing to do.')
  process.exit(0)
}

// Update pi_cwd
db.prepare('UPDATE workspaces SET pi_cwd = ? WHERE id = ?').run(newPath, row.id)

// Verify
const updated = db
  .prepare('SELECT id, name, pi_cwd FROM workspaces WHERE id = ?')
  .get(row.id)
console.log('Updated:')
console.log(JSON.stringify(updated, null, 2))

db.close()
console.log('Done.')