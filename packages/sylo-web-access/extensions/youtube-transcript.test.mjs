import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatYouTubeTranscriptMarkdown,
  parseYouTubeTranscriptPayload,
  parseYouTubeVideoId,
  youTubeWatchUrl,
} from './youtube-transcript.ts'

test('parseYouTubeVideoId accepts common URL shapes', () => {
  assert.equal(parseYouTubeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(
    parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
    'dQw4w9WgXcQ',
  )
  assert.equal(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
  assert.equal(
    parseYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    'dQw4w9WgXcQ',
  )
  assert.equal(parseYouTubeVideoId('not-a-url'), null)
})

test('parseYouTubeTranscriptPayload and markdown formatter', () => {
  const payload = parseYouTubeTranscriptPayload({
    ok: true,
    video_id: 'dQw4w9WgXcQ',
    watch_url: youTubeWatchUrl('dQw4w9WgXcQ'),
    language_code: 'en',
    language: 'English',
    is_generated: false,
    segment_count: 2,
    plain_text: 'Hello world',
  })
  assert.ok(payload)
  const md = formatYouTubeTranscriptMarkdown(payload)
  assert.match(md, /Hello world/)
  assert.match(md, /youtube\.com\/watch\?v=dQw4w9WgXcQ/)
})
