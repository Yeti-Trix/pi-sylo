import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  filterCompanionSendAttachments,
  isCompanionManagedUploadPath,
  sanitizeCompanionUploadBasename,
  writeCompanionUpload,
} from './companion-upload.js'

test('sanitizeCompanionUploadBasename strips path segments', () => {
  assert.equal(sanitizeCompanionUploadBasename('../../evil.png'), 'evil.png')
})

test('writeCompanionUpload stores under userData companion folder', () => {
  const userData = mkdtempSync(join(tmpdir(), 'sylo-companion-upload-'))
  try {
    const written = writeCompanionUpload(userData, Buffer.from('hello'), 'photo.jpg')
    assert.ok(isCompanionManagedUploadPath(userData, written.path))
    assert.equal(written.name, 'photo.jpg')
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('filterCompanionSendAttachments rejects paths outside upload dir', () => {
  const userData = mkdtempSync(join(tmpdir(), 'sylo-companion-filter-'))
  try {
    const written = writeCompanionUpload(userData, Buffer.from('x'), 'note.txt')
    const kept = filterCompanionSendAttachments(userData, [
      { path: written.path, name: written.name },
      { path: 'C:\\Windows\\System32\\cmd.exe', name: 'cmd.exe' },
    ])
    assert.equal(kept.length, 1)
    assert.equal(kept[0]?.path, written.path)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})
