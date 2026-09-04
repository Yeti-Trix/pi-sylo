import assert from 'node:assert/strict'
import test from 'node:test'

import {
  injectVisionFallbackDescriptions,
  rewriteAttachmentBlockForVisionFallback,
  TEXT_AFTER_ATTACHMENTS_SEP,
  USER_ATTACHMENT_PREAMBLE,
} from './chat-user-attachment-prompt.ts'

const sampleMessage = [
  USER_ATTACHMENT_PREAMBLE,
  'Use only the absolute paths in the list below.',
  '- C:\\images\\house.png  (name: house.png)',
  `${TEXT_AFTER_ATTACHMENTS_SEP}What kind of roof is this?`,
].join('\n')

test('rewriteAttachmentBlockForVisionFallback replaces disk-read hints', () => {
  const out = rewriteAttachmentBlockForVisionFallback(sampleMessage, 'ollama/kimi-k2.7-code:cloud')
  assert.match(out, /do NOT call read on image paths/i)
  assert.match(out, /kimi-k2.7-code:cloud/)
  assert.doesNotMatch(out, /tools should read from disk/i)
  assert.match(out, /house\.png/)
  assert.match(out, /What kind of roof is this\?/)
})

test('injectVisionFallbackDescriptions inserts prose before operator question', () => {
  const out = injectVisionFallbackDescriptions(
    sampleMessage,
    'Aerial photo shows a multi-gable roof.',
    'ollama/kimi-k2.7-code:cloud',
  )
  assert.match(out, /do NOT call read on image paths/i)
  assert.match(out, /multi-gable roof/)
  const sep = out.indexOf(TEXT_AFTER_ATTACHMENTS_SEP)
  assert.ok(sep > 0)
  assert.ok(out.indexOf('multi-gable roof') < sep)
  assert.ok(out.indexOf('What kind of roof') > sep)
})
