export type TtsVoice = { id: string; label: string; backend: string }

function hasDesktopNonce(): boolean {
  const nonce = (window as unknown as { __SYLO_NONCE__?: string }).__SYLO_NONCE__
  return typeof nonce === 'string' && nonce.length > 0
}

function rpcViaPostMessage<T>(op: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const reqId = `r-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as {
        kind?: string
        reqId?: string
        ok?: boolean
        result?: T
        error?: string
      }
      if (!d || d.kind !== 'sylo-skill-bridge-reply' || d.reqId !== reqId) return
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
  return Promise.reject(new Error('Speech route requires Sylo desktop host'))
}

export type TtsGenerateResult = {
  wavPath: string
  durationMs: number
  voiceId: string
  voiceLabel: string
}

export type TtsGenerateArgs = {
  text: string
  voice_id?: string
  kokoro_speed?: number
  orpheus_temperature?: number
  orpheus_top_p?: number
}

export type SpeechGeneration = {
  id: string
  wavPath: string
  voiceLabel: string
  voiceId: string
  textPreview: string
  createdAt: number
}

export const bridge = {
  listVoices: () => rpc<TtsVoice[]>('ttsListVoices', {}),
  configGet: () => rpc<Record<string, unknown>>('ttsConfigGet', {}),
  configSave: (values: Record<string, unknown>) =>
    rpc<{ ok: boolean; restartNote?: string }>('ttsConfigSave', values),
  generate: (args: TtsGenerateArgs) => rpc<TtsGenerateResult>('ttsGenerate', args),
  saveAudio: (args: { sourcePath: string; suggestedName?: string }) =>
    rpc<{ path: string }>('ttsSaveAudio', args),
  readSkillData: (key: string) => rpc<unknown>('readSkillData', { key }),
  writeSkillData: (key: string, value: unknown) =>
    rpc<{ written: boolean }>('writeSkillData', { key, value }),
  deleteRouteClip: (wavPath: string) =>
    rpc<{ ok: boolean }>('ttsDeleteRouteClip', { wavPath }),
}

export function localFileUrl(absPath: string): string {
  const p = absPath.trim()
  if (!p) return ''
  return `sylo-file://preview?path=${encodeURIComponent(p)}`
}
