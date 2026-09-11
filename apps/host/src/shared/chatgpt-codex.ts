/** Pi provider id for ChatGPT Plus/Pro via OpenAI Codex OAuth (not the paid API). */
export const CHATGPT_CODEX_PROVIDER = 'openai-codex'

/** Default Codex model after a successful ChatGPT sign-in. Vision-capable. */
export const CHATGPT_CODEX_DEFAULT_MODEL = 'gpt-5.4'

/**
 * Built-in Pi catalog for `openai-codex` (tool-calling Codex models on
 * chatgpt.com/backend-api). Keep in step with `@earendil-works/pi-ai`
 * `OPENAI_CODEX_MODELS` when upgrading Pi.
 */
export const CHATGPT_CODEX_MODELS: ReadonlyArray<{
  id: string
  name: string
  vision: boolean
}> = [
  { id: 'gpt-5.4', name: 'GPT-5.4', vision: true },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', vision: true },
  { id: 'gpt-5.5', name: 'GPT-5.5', vision: true },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', vision: true },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', vision: true },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', vision: true },
  { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', vision: false },
]

export const SYLO_MODEL_PROVIDERS = [
  'ollama',
  'openai-codex',
  'openai',
  'anthropic',
  'groq',
  'openrouter',
] as const

export type SyloModelProvider = (typeof SYLO_MODEL_PROVIDERS)[number]

export const SYLO_MODEL_PROVIDER_LABELS: Record<SyloModelProvider, string> = {
  ollama: 'Ollama',
  'openai-codex': 'ChatGPT OAuth',
  openai: 'OpenAI API',
  anthropic: 'Anthropic',
  groq: 'Groq',
  openrouter: 'OpenRouter',
}

export type ChatgptAuthStatus = {
  connected: boolean
  accountId: string | null
}

const DEVICE_CODE_LOGIN_METHOD = 'device_code'
const BROWSER_LOGIN_METHOD = 'browser'

/** Prefer device-code OAuth (Hermes-style) over localhost callback on :1455. */
export function pickChatgptLoginMethod(
  options: ReadonlyArray<{ id: string; label?: string }>,
): string {
  const ids = options.map((o) => o.id)
  if (ids.includes(DEVICE_CODE_LOGIN_METHOD)) return DEVICE_CODE_LOGIN_METHOD
  if (ids.includes(BROWSER_LOGIN_METHOD)) return BROWSER_LOGIN_METHOD
  return ids[0] ?? ''
}

export function chatgptAuthStatusFromCredential(cred: unknown): ChatgptAuthStatus {
  if (!cred || typeof cred !== 'object') return { connected: false, accountId: null }
  const rec = cred as { type?: unknown; access?: unknown; refresh?: unknown; accountId?: unknown }
  if (rec.type !== 'oauth') return { connected: false, accountId: null }
  const hasToken =
    (typeof rec.access === 'string' && rec.access.trim() !== '') ||
    (typeof rec.refresh === 'string' && rec.refresh.trim() !== '')
  if (!hasToken) return { connected: false, accountId: null }
  const accountId = typeof rec.accountId === 'string' && rec.accountId.trim() !== '' ? rec.accountId.trim() : null
  return { connected: true, accountId }
}

export type ChatgptLoginEvent =
  | { type: 'device_code'; userCode: string; verificationUri: string; expiresInSeconds?: number }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'progress'; message: string }
  | { type: 'info'; message: string }
