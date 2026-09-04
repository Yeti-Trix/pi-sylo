import assert from 'node:assert/strict'
import test from 'node:test'

test('rewriteToolResultForTextOnlySeat strips images when no image model configured', async () => {
  const { rewriteToolResultForTextOnlySeat } = await import('./seat-image-fallback.ts')
  const content = [
    { type: 'text', text: 'PDF page preview' },
    { type: 'image', data: 'abc123', mimeType: 'image/png' },
  ]
  const out = await rewriteToolResultForTextOnlySeat({
    content,
    modelId: '',
    provider: 'ollama',
    ollamaOrigin: 'http://127.0.0.1:11434',
  })
  assert.ok(out)
  assert.equal(out.filter((b) => b.type === 'image').length, 0)
  assert.match(out[out.length - 1].text, /text-only/)
})

test('readSeatImageFallbackEnv reads broker env keys', async () => {
  const { readSeatImageFallbackEnv } = await import('./seat-image-fallback.ts')
  const env = readSeatImageFallbackEnv({
    SYLO_IMAGE_MODEL_ID: 'llava',
    SYLO_IMAGE_MODEL_PROVIDER: 'ollama',
    SYLO_OLLAMA_BASE_ORIGIN: 'http://localhost:11434',
  })
  assert.equal(env.modelId, 'llava')
  assert.equal(env.provider, 'ollama')
  assert.equal(env.ollamaOrigin, 'http://localhost:11434')
})
