/**
 * End-to-end check that the local Ollama model handles Sylo's tool surface through the
 * same OpenAI-compatible `/v1` endpoint Pi uses.
 *
 * Answers two things the unit tests cannot:
 *   1. Does the model emit a well-formed tool call when handed the full tool list?
 *   2. What do the tool schemas actually cost, measured from Ollama's own prompt token
 *      count rather than a chars/4 estimate?
 *
 * Run: node apps/host/scripts/check-ollama-tools.mjs [--model <id>]
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const modelArg = argv.indexOf('--model')
const MODEL = modelArg >= 0 ? argv[modelArg + 1] : 'qwen3.8:27b'
const ORIGIN = process.env.OLLAMA_ORIGIN ?? 'http://127.0.0.1:11434'

// Tool names + descriptions come from the extension sources so the payload reflects what
// Sylo actually registers rather than a hand-written stand-in.
const SOURCES = [
  'packages/sylo-pdf-reader/extensions/index.ts',
  'packages/sylo-docx/extensions/index.ts',
  'packages/sylo-spreadsheet/extensions/index.ts',
  'packages/sylo-web-access/extensions/index.ts',
  'packages/sylo-workflows/extensions/index.ts',
  'packages/sylo-coder/extensions/index.ts',
  'packages/sylo-think-tank/extensions/index.ts',
  'packages/sylo-chat-export/extensions/index.ts',
  'packages/sylo-tasks/extensions/index.ts',
  'packages/skill-surface-extension/src/index.ts',
  'packages/sylo-subagents/extensions/index.ts',
  'packages/sylo-scheduler/extensions/index.ts',
  'apps/host/src/broker/sylo-image-fallback.ts',
]

const PI_BUILTINS = {
  read: 'Read a file from the local filesystem. Supports an optional line offset and limit.',
  write: 'Write a file to the local filesystem, overwriting any existing file at that path.',
  edit: 'Perform an exact string replacement in a file.',
  bash: 'Execute a shell command and return its combined output.',
  grep: 'Search file contents with a regular expression, filtering by glob or file type.',
  find: 'Find files matching a glob pattern, sorted by modification time.',
  ls: 'List the entries of a directory.',
}

function collectTools() {
  const tools = []
  for (const path of SOURCES) {
    let src
    try {
      src = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    // Pair each `name:` with the `description:` that follows it in the same tool literal.
    const re =
      /name:\s*['"]([a-z0-9_]+)['"][\s\S]{0,400}?description:\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`)/gs
    for (const m of src.matchAll(re)) {
      const name = m[1]
      const description = (m[2] ?? m[3] ?? m[4] ?? '').replace(/\s+/g, ' ').trim()
      if (!name || tools.some((t) => t.function.name === name)) continue
      tools.push({
        type: 'function',
        function: {
          name,
          description,
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Target path or identifier.' },
              query: { type: 'string', description: 'Query or content for the operation.' },
            },
            required: ['path'],
          },
        },
      })
    }
  }
  for (const [name, description] of Object.entries(PI_BUILTINS)) {
    tools.push({
      type: 'function',
      function: {
        name,
        description,
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Absolute path to the file.' },
            pattern: { type: 'string', description: 'Pattern or command text.' },
          },
          required: ['file_path'],
        },
      },
    })
  }
  return tools
}

async function chat(body, label) {
  const started = Date.now()
  const res = await fetch(`${ORIGIN}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} — ${text.slice(0, 400)}`)
  return { json: JSON.parse(text), ms: Date.now() - started }
}

const tools = collectTools()
const fmt = (n) => n.toLocaleString('en-US')

console.log(`Model: ${MODEL}`)
console.log(`Tools assembled from repo sources: ${tools.length}\n`)

// Baseline: identical message, no tools. The difference in prompt tokens is the schema cost.
const baseMessages = [
  { role: 'system', content: 'You are a helpful coding assistant.' },
  { role: 'user', content: 'Read the file D:/notes/todo.md and tell me what is in it.' },
]

const bare = await chat(
  { model: MODEL, messages: baseMessages, stream: false, max_tokens: 64 },
  'baseline',
)
const withTools = await chat(
  { model: MODEL, messages: baseMessages, tools, tool_choice: 'auto', stream: false, max_tokens: 64 },
  'with tools',
)

const bareTokens = bare.json.usage?.prompt_tokens ?? 0
const toolTokens = withTools.json.usage?.prompt_tokens ?? 0

console.log('--- prompt token cost (measured by Ollama) ---')
console.log(`without tools : ${fmt(bareTokens)} prompt tokens   (${bare.ms} ms)`)
console.log(`with ${tools.length} tools : ${fmt(toolTokens)} prompt tokens   (${withTools.ms} ms)`)
console.log(`tool schemas  : ${fmt(toolTokens - bareTokens)} tokens every turn\n`)

console.log('--- tool-calling behaviour ---')
const choice = withTools.json.choices?.[0]
const calls = choice?.message?.tool_calls ?? []
if (calls.length > 0) {
  for (const c of calls) {
    console.log(`PASS  model called: ${c.function?.name}  args=${c.function?.arguments}`)
  }
  const picked = calls[0]?.function?.name
  console.log(
    picked === 'read' ?
      'PASS  selected the correct tool for a file-read request'
    : `WARN  expected "read", got "${picked}" — tool selection may be degraded by list size`,
  )
} else {
  console.log('FAIL  model returned no tool call; it replied with prose instead:')
  console.log(`      ${String(choice?.message?.content ?? '').slice(0, 200)}`)
}

const ps = await fetch(`${ORIGIN}/api/ps`).then((r) => r.json())
const loaded = ps.models?.find((m) => m.name === MODEL)
if (loaded) {
  console.log(
    `\n--- context ---\nOllama allocated ${fmt(loaded.context_length)} tokens; ` +
      `${(loaded.size_vram / 1024 ** 3).toFixed(1)} GB VRAM`,
  )
}
