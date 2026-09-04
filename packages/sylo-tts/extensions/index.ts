/**
 * sylo-tts — local Kokoro / Orpheus text-to-speech.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { loadTtsConfig, resolveSynthOptions, type TtsSynthOverrides } from './config.ts'
import { asRecord, runPythonScript } from './python-runner.ts'
import { listCatalogVoices, resolveVoice, defaultVoiceIdFromCatalog } from './voice-catalog.ts'

type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'audio'; mimeType: string; data: string }

function toolError(text: string): { content: ToolContentBlock[] } {
  return { content: [{ type: 'text', text }] }
}

function pickVoiceId(requested: unknown, configDefault: string): string {
  const fallback = configDefault.trim() || defaultVoiceIdFromCatalog()
  const requestedId =
    typeof requested === 'string' && requested.trim() ? requested.trim() : fallback
  return resolveVoice(requestedId)?.id ?? defaultVoiceIdFromCatalog()
}

function synthOverridesFromParams(params: Record<string, unknown>): TtsSynthOverrides {
  const out: TtsSynthOverrides = {}
  if (typeof params.kokoro_speed === 'number') out.kokoroSpeed = params.kokoro_speed
  if (typeof params.orpheus_temperature === 'number') {
    out.orpheusTemperature = params.orpheus_temperature
  }
  if (typeof params.orpheus_top_p === 'number') out.orpheusTopP = params.orpheus_top_p
  return out
}

function pythonArgsForVoice(
  voice: NonNullable<ReturnType<typeof resolveVoice>>,
  text: string,
  outPath: string,
  synth: ReturnType<typeof resolveSynthOptions>,
): string[] {
  const args = ['--backend', voice.backend, '--text', text, '--out', outPath]
  if (voice.backend === 'kokoro') {
    args.push('--kokoro-voice', voice.kokoroVoice ?? 'am_michael')
    if (voice.kokoroLang) args.push('--kokoro-lang', voice.kokoroLang)
    args.push('--kokoro-speed', String(synth.kokoroSpeed))
  } else if (voice.backend === 'orpheus') {
    args.push('--orpheus-voice', voice.orpheusVoice ?? 'leo')
    args.push('--orpheus-temperature', String(synth.orpheusTemperature))
    args.push('--orpheus-top-p', String(synth.orpheusTopP))
  }
  return args
}

export default function register(api: ExtensionAPI): void {
  const catalogSummary = listCatalogVoices()
    .map((v) => `${v.id} (${v.label})`)
    .join('; ')

  api.registerTool({
    name: 'sylo_tts_speak',
    description:
      'Convert text to natural speech (local WAV). Normalizes text before calling. ' +
      'Uses configured default voice unless voice_id is set. Voices: ' +
      catalogSummary,
    parameters: Type.Object({
      text: Type.String({ description: 'Text to speak (already normalized spelling/grammar).' }),
      voice_id: Type.Optional(
        Type.String({
          description:
            'Catalog voice id (e.g. kokoro-am_michael, orpheus-leo). Omit for extension default.',
        }),
      ),
      kokoro_speed: Type.Optional(
        Type.Number({
          description: 'Kokoro speech rate (0.5–2.0; 1.0 = normal). Ignored for Orpheus voices.',
        }),
      ),
      orpheus_temperature: Type.Optional(
        Type.Number({
          description: 'Orpheus temperature (0.3–1.2; lower = steadier). Ignored for Kokoro.',
        }),
      ),
      orpheus_top_p: Type.Optional(
        Type.Number({
          description: 'Orpheus top_p (0.7–1.0). Ignored for Kokoro.',
        }),
      ),
    }),
    promptSnippet:
      'Use sylo_tts_speak when the operator wants text read aloud. Pass normalized text only. ' +
      'Do not reply with prose after success — the audio player is the deliverable.',
    async execute(_id, params) {
      const config = loadTtsConfig()
      const text = typeof params.text === 'string' ? params.text.trim() : ''
      if (!text) return toolError('text is required')

      const voiceId = pickVoiceId(params.voice_id, config.defaultVoiceId)
      const voice = resolveVoice(voiceId)
      if (!voice) {
        return toolError(`Unknown voice_id "${voiceId}". Known: ${catalogSummary}`)
      }

      const synth = resolveSynthOptions(config, synthOverridesFromParams(params))

      const tmpDir = mkdtempSync(join(tmpdir(), 'sylo-tts-'))
      const outPath = join(tmpDir, `${randomUUID()}.wav`)

      const ran = await runPythonScript(
        'tts_synthesize.py',
        pythonArgsForVoice(voice, text, outPath, synth),
        config.pythonPath,
      )
      if (!ran.ok) {
        rmSync(tmpDir, { recursive: true, force: true })
        return toolError(ran.error)
      }

      const data = asRecord(ran.data)
      if (!data || data.ok !== true) {
        rmSync(tmpDir, { recursive: true, force: true })
        const err = typeof data?.error === 'string' ? data.error : 'TTS failed'
        return toolError(err)
      }

      const wavPath = typeof data.wavPath === 'string' ? data.wavPath : outPath
      let b64 = ''
      try {
        b64 = readFileSync(wavPath).toString('base64')
      } catch (err) {
        rmSync(tmpDir, { recursive: true, force: true })
        const msg = err instanceof Error ? err.message : String(err)
        return toolError(`Could not read WAV: ${msg}`)
      }

      const durationMs = typeof data.durationMs === 'number' ? data.durationMs : undefined
      const durNote = durationMs != null ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''

      return {
        content: [
          { type: 'text', text: `Speech (${voice.label})${durNote}` },
          { type: 'audio', mimeType: 'audio/wav', data: b64 },
        ],
      }
    },
  })
}
