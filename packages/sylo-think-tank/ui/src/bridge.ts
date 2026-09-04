function hasDesktopNonce(): boolean {
  const nonce = (window as unknown as { __SYLO_NONCE__?: string }).__SYLO_NONCE__
  return typeof nonce === 'string' && nonce.length > 0
}

const BRIDGE_RPC_TIMEOUT_MS = 15_000

function rpcViaPostMessage<T>(op: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const reqId = `r-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg)
      reject(new Error(`Bridge RPC timed out (${op})`))
    }, BRIDGE_RPC_TIMEOUT_MS)
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as {
        kind?: string
        reqId?: string
        ok?: boolean
        result?: T
        error?: string
      }
      if (!d || d.kind !== 'sylo-skill-bridge-reply' || d.reqId !== reqId) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      if (d.ok) resolve(d.result as T)
      else reject(new Error(d.error || 'bridge_error'))
    }
    window.addEventListener('message', onMsg)
    window.parent.postMessage(
      {
        v: 1,
        kind: 'sylo-skill-bridge',
        nonce: (window as unknown as { __SYLO_NONCE__?: string }).__SYLO_NONCE__,
        reqId,
        op,
        payload: payload ?? {},
      },
      '*',
    )
  })
}

function rpc<T>(op: string, payload?: unknown): Promise<T> {
  if (hasDesktopNonce()) return rpcViaPostMessage<T>(op, payload)
  return Promise.reject(new Error('Think Tank route requires Sylo desktop host'))
}

export type ThinkTankSeatRow = {
  id: string
  label: string
  role?: 'debater' | 'moderator'
  agent: string
  model_provider: string
  model_id: string
  persona?: string
}

export type ThinkTankConfig = {
  debater_count: number
  seats: ThinkTankSeatRow[]
  min_cycles: number
  max_cycles: number
}

export type OllamaListResult = { baseUrl: string; models: string[] }

export const bridge = {
  configGet: () => rpc<ThinkTankConfig>('thinkTankConfigGet', {}),
  configSave: (values: Record<string, unknown>) =>
    rpc<{ ok: boolean }>('thinkTankConfigSave', { values }),
  sessionGet: (sessionId: string) => rpc<Record<string, unknown> | null>('thinkTankSessionGet', { sessionId }),
  pickReport: (sessionId: string, reportId: string) =>
    rpc<{ ok: boolean; selectedReportId: string }>('thinkTankPickReport', { sessionId, reportId }),
  listOllamaModels: () => rpc<OllamaListResult>('settingsOllamaListTags', {}),
}

export const BUNDLED_PERSONAS = [
  { id: 'think-tank-evidence', label: 'Evidence-first', hint: 'Facts and measurable criteria' },
  { id: 'think-tank-skeptic', label: 'Skeptic', hint: 'Failure modes and overconfidence' },
  { id: 'think-tank-moderator', label: 'Moderator', hint: 'Synthesize findings, surface gaps, decision brief' },
] as const

/** @deprecated use BUNDLED_PERSONAS */
export const BUNDLED_AGENTS = BUNDLED_PERSONAS.map((p) => p.id)

export const MODEL_PROVIDERS = [
  { value: '', label: 'Pi default (no override)' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'groq', label: 'Groq' },
] as const
