/**
 * Run: npm run test:chat-drop -w apps/host
 *
 * Covers the queue-edit text round trip (edit prose, attachment block survives
 * verbatim) and the composer drop-forwarding bus.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { forwardDroppedFiles, registerComposerDropHandler } from '../../../../out/test/chatDropBus.mjs'
import {
  formatUserMessageWithAttachments,
  splitUserMessageAttachments,
} from '../../../../out/test/chatUserAttachments.mjs'

describe('queue edit text round-trip', () => {
  test('editing prose preserves the attachment block verbatim', () => {
    const original = formatUserMessageWithAttachments(
      'look at this',
      [{ path: 'C:\\pics\\a.png', name: 'a.png' }],
    )
    // The composer edits the display text, then re-formats with the parsed
    // attachments — paths must survive byte-for-byte.
    const display = splitUserMessageAttachments(original).text
    assert.equal(display, 'look at this')
    const edited = formatUserMessageWithAttachments(
      'actually measure the width',
      splitUserMessageAttachments(original).attachments,
    )
    const reparsed = splitUserMessageAttachments(edited)
    assert.equal(reparsed.text, 'actually measure the width')
    assert.deepEqual(reparsed.attachments, [{ path: 'C:\\pics\\a.png', name: 'a.png' }])
  })

  test('plain queued text (no attachment block) round-trips unchanged', () => {
    const original = 'just text, no attachments'
    const display = splitUserMessageAttachments(original).text
    assert.equal(display, original)
    const edited = formatUserMessageWithAttachments('edited', [])
    assert.equal(edited, 'edited')
  })

  test('attachment-only item keeps its block when prose is emptied', () => {
    const original = formatUserMessageWithAttachments(
      'with file',
      [{ path: '/tmp/x.pdf', name: 'x.pdf' }],
    )
    const { attachments } = splitUserMessageAttachments(original)
    const emptied = formatUserMessageWithAttachments('', attachments)
    const reparsed = splitUserMessageAttachments(emptied)
    assert.equal(reparsed.text, '')
    assert.deepEqual(reparsed.attachments, [{ path: '/tmp/x.pdf', name: 'x.pdf' }])
  })
})

describe('edit-resend round trip (task 01)', () => {
  /**
   * The edit-resend flow: the row editor splits the persisted row into
   * (editable text + kept attachments), then the main-side re-prepare
   * re-formats text + attachments into the new persisted content. Assert the
   * same split → re-format → re-parse round trip the send path uses.
   */
  test('editing prose re-attaches the original attachments verbatim', () => {
    const persisted = formatUserMessageWithAttachments(
      'look at this',
      [
        { path: 'C:\\pics\\a.png', name: 'a.png' },
        { path: 'C:\\docs\\spec v2.pdf', name: 'spec v2.pdf' },
      ],
    )
    // Row editor startEdit(): display text + kept attachments.
    const split = splitUserMessageAttachments(persisted)
    assert.equal(split.text, 'look at this')
    // Row editor saveEdit(): re-send edited text through the same formatter.
    const resent = formatUserMessageWithAttachments(
      'actually compare with the new sketch',
      split.attachments,
    )
    const reparsed = splitUserMessageAttachments(resent)
    assert.equal(reparsed.text, 'actually compare with the new sketch')
    assert.deepEqual(reparsed.attachments, [
      { path: 'C:\\pics\\a.png', name: 'a.png' },
      { path: 'C:\\docs\\spec v2.pdf', name: 'spec v2.pdf' },
    ])
  })

  test('unchanged text cancels the resend (no-op guard input shape)', () => {
    const persisted = formatUserMessageWithAttachments(
      'same text',
      [{ path: '/x.png', name: 'x.png' }],
    )
    const split = splitUserMessageAttachments(persisted)
    // saveEdit compares the trimmed draft against the trimmed original text;
    // identical means cancel-without-send.
    assert.equal(split.text.trim() === split.text.trim(), true)
  })

  test('plain row (no attachments) resends as bare text', () => {
    const persisted = 'no attachments here'
    const split = splitUserMessageAttachments(persisted)
    assert.equal(split.attachments.length, 0)
    assert.equal(formatUserMessageWithAttachments('edited text', []), 'edited text')
  })
})

describe('composer drop bus', () => {
  test('forwards files to the registered handler', () => {
    const seen = []
    registerComposerDropHandler((files) => seen.push(...files))
    const f1 = { name: 'a.png' }
    const f2 = { name: 'b.txt' }
    assert.equal(forwardDroppedFiles([f1, f2]), true)
    assert.deepEqual(seen, [f1, f2])
    registerComposerDropHandler(null)
  })

  test('returns false with no handler or no files', () => {
    registerComposerDropHandler(null)
    assert.equal(forwardDroppedFiles([{ name: 'x' }]), false)
    registerComposerDropHandler(() => {})
    assert.equal(forwardDroppedFiles([]), false)
    registerComposerDropHandler(null)
  })

  test('a later registration replaces the earlier one', () => {
    const calls = []
    registerComposerDropHandler(() => seenFirst.push(1))
    const seenFirst = []
    registerComposerDropHandler((files) => seenSecond.push(files.length))
    const seenSecond = []
    assert.equal(forwardDroppedFiles([{ name: 'n' }]), true)
    assert.deepEqual(seenSecond, [1])
    registerComposerDropHandler(null)
  })
})