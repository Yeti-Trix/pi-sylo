import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import {
  collectManagedChatAttachmentPaths,
  isPasteManagedUploadPath,
  pasteImagesRoot,
  ensurePasteImagesDir,
} from './chat-owned-attachments.js'
import {
  isCompanionManagedUploadPath,
  writeCompanionUpload,
} from './companion/companion-upload.js'

test('collectManagedChatAttachmentPaths finds paste and companion paths', () => {
  const userData = mkdtempSync(join(tmpdir(), 'sylo-chat-att-'))
  try {
    const pasteDir = ensurePasteImagesDir(userData)
    const pastePath = join(pasteDir, 'paste-1.png')
    writeFileSync(pastePath, Buffer.from('x'))
    const uploaded = writeCompanionUpload(userData, Buffer.from('y'), 'doc.pdf')

    const content = [
      'Attached local files (absolute paths on this machine; contents are not copied into the message—tools should read from disk, e.g. docparser):',
      'Use only the absolute paths in the list below.',
      `- ${pastePath}  (name: paste-1.png)`,
      `- ${uploaded.path}  (name: doc.pdf)`,
      '',
      'Sylo image delivery (Pi native images channel):',
      JSON.stringify({
        modelVisionCapable: true,
        modelInput: ['text', 'image'],
        piImagesAttached: 1,
        encoded: [{ path: pastePath, mimeType: 'image/png', encodedBytes: 1, width: 1, height: 1, sourceBytes: 1, reencoded: false }],
        skipped: [],
      }),
    ].join('\n')

    const found = collectManagedChatAttachmentPaths(userData, [content])
    assert.ok(found.some((p) => isPasteManagedUploadPath(userData, p)))
    assert.ok(found.some((p) => isCompanionManagedUploadPath(userData, p)))
    assert.equal(found.length, 2)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('isPasteManagedUploadPath rejects paths outside paste dir', () => {
  const userData = mkdtempSync(join(tmpdir(), 'sylo-paste-check-'))
  try {
    mkdirSync(pasteImagesRoot(userData), { recursive: true })
    assert.equal(isPasteManagedUploadPath(userData, join(pasteImagesRoot(userData), 'a.png')), true)
    assert.equal(isPasteManagedUploadPath(userData, 'C:\\Windows\\System32\\a.png'), false)
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})
