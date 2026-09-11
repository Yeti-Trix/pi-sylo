/**
 * Does OLLAMA_CONTEXT_LENGTH (a local serving limit) also cap `:cloud` models?
 *
 * Sylo clamps a model's declared contextWindow to the local server limit. That is correct
 * for local models, where the limit sizes the KV cache in VRAM, but cloud models are served
 * remotely. This sends a prompt larger than the local limit and reports whether it is
 * accepted, so the clamp is decided by evidence rather than assumption.
 *
 * Run: node apps/host/scripts/probe-cloud-context.mjs <model> [approxTokens]
 */
const ORIGIN = process.env.OLLAMA_ORIGIN ?? 'http://127.0.0.1:11434'
const MODEL = process.argv[2]
const TARGET_TOKENS = Number(process.argv[3] ?? 140000)

if (!MODEL) {
  console.error('usage: node probe-cloud-context.mjs <model> [approxTokens]')
  process.exit(2)
}

// A distinctive sentence repeated to a known size. Repetitive text tokenizes densely, so
// build from varied numbered lines to keep the chars-per-token ratio closer to real prose.
function filler(approxTokens) {
  const lines = []
  let tokens = 0
  for (let i = 0; tokens < approxTokens; i++) {
    lines.push(
      `Line ${i}: inventory record ${i * 7919} for warehouse bay ${(i % 97) + 1}, ` +
        `status nominal, checked by operator ${(i % 53) + 1}.`,
    )
    tokens += 28
  }
  return lines.join('\n')
}

const haystack = filler(TARGET_TOKENS)
// A needle at the very end verifies the tail of the prompt survived rather than being
// silently truncated, which is the failure mode that matters.
const prompt =
  `${haystack}\n\nThe secret pass phrase is "harbor-lantern-4417".\n\n` +
  'Reply with only the secret pass phrase stated above.'

console.log(`model         : ${MODEL}`)
console.log(`prompt chars  : ${prompt.length.toLocaleString('en-US')}`)
console.log(`target tokens : ~${TARGET_TOKENS.toLocaleString('en-US')}\n`)

const started = Date.now()
let res
try {
  res = await fetch(`${ORIGIN}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      max_tokens: 32,
    }),
  })
} catch (e) {
  console.log(`RESULT: request failed outright — ${e.message}`)
  process.exit(1)
}

const text = await res.text()
const ms = Date.now() - started

if (!res.ok) {
  console.log(`RESULT: REJECTED (HTTP ${res.status}) after ${ms} ms`)
  console.log(text.slice(0, 500))
  // Only a size-related refusal says anything about the context window. Auth, billing,
  // and missing-model errors are rejections for unrelated reasons and must not be read
  // as evidence about the limit.
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    console.log('\n=> INCONCLUSIVE: refused for account/billing reasons before the prompt')
    console.log('   size was ever evaluated. This says nothing about the context window.')
  } else if (res.status === 404) {
    console.log('\n=> INCONCLUSIVE: model not available on this server.')
  } else {
    console.log('\n=> Rejected on size; the limit DOES apply, so keep clamping this model.')
  }
} else {

  const json = JSON.parse(text)
  const promptTokens = json.usage?.prompt_tokens ?? 0
  const reply = json.choices?.[0]?.message?.content ?? ''
  const recalled = reply.includes('harbor-lantern-4417')

  console.log(`RESULT: ACCEPTED after ${ms} ms`)
  console.log(`prompt_tokens counted by server : ${promptTokens.toLocaleString('en-US')}`)
  console.log(`recalled the tail pass phrase   : ${recalled ? 'YES' : 'NO'}`)
  console.log(`reply: ${reply.slice(0, 120).replace(/\n/g, ' ')}`)

  if (promptTokens > 131072 && recalled) {
    console.log('\n=> Served well past the local 131,072 limit with the tail intact;')
    console.log('   the local clamp must NOT be applied to this model.')
  } else if (!recalled) {
    console.log('\n=> Accepted but the tail was lost — silent truncation. Keep the clamp.')
  }
}
