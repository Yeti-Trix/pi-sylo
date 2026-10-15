import React, { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '../lib/cn'
import { btnGhostSm, card, mutedText, panelTitle } from './ui-classes'

type PerfEntry = { at: number; scope: string; detail: string; ms?: number }

type ConvProbeRow = {
  conversationId: string
  title: string
  rows: number
  payloadKb: number
  dbMs?: number
  biggestRowKb: number
}

type ConvProbeResult = { ok: true; rows: ConvProbeRow[]; totalMs: number } | { ok: false; error: string }

type EncodeProbeResult =
  | {
      ok: true
      syntheticImage: { width: number; height: number; sourceKb: number }
      readDecodeMs: number
      resizeJpegMs: number
      base64Ms: number
      totalMs: number
      encodedKb: number
      reencoded: boolean
    }
  | { ok: false; error: string }

const POLL_MS = 5000

function fmtTime(at: number): string {
  return new Date(at).toLocaleTimeString('en-US', { hour12: false })
}

/**
 * Freeze diagnostics for the two reported lags (work-computer report): chat
 * switching and image/file sends. Shows the main process's own [perf] ring
 * buffer (what was actually loading) plus two synthetic, read-only probes.
 */
export function PerfProbeCard(): React.ReactElement {
  const [log, setLog] = useState<PerfEntry[]>([])
  const [convProbe, setConvProbe] = useState<ConvProbeResult | null>(null)
  const [encodeProbe, setEncodeProbe] = useState<EncodeProbeResult | null>(null)
  const [convBusy, setConvBusy] = useState(false)
  const [encodeBusy, setEncodeBusy] = useState(false)
  const mountedRef = useRef(true)

  const reloadLog = useCallback(async () => {
    try {
      const rows = await window.sylo.perf.recent(120)
      if (mountedRef.current) setLog(rows)
    } catch {
      /* main not connected yet */
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void reloadLog()
    const t = window.setInterval(() => void reloadLog(), POLL_MS)
    return () => {
      mountedRef.current = false
      window.clearInterval(t)
    }
  }, [reloadLog])

  const runConvProbe = useCallback(async () => {
    setConvBusy(true)
    try {
      const r = await window.sylo.perf.probeConversationLoad()
      if (mountedRef.current) setConvProbe(r)
    } finally {
      if (mountedRef.current) setConvBusy(false)
      void reloadLog()
    }
  }, [reloadLog])

  const runEncodeProbe = useCallback(async () => {
    setEncodeBusy(true)
    try {
      const r = await window.sylo.perf.probeImageEncode()
      if (mountedRef.current) setEncodeProbe(r)
    } finally {
      if (mountedRef.current) setEncodeBusy(false)
      void reloadLog()
    }
  }, [reloadLog])

  const copyReport = useCallback(() => {
    const lines = log.map((e) => `${fmtTime(e.at)} ${e.scope}${e.ms != null ? ` ${e.ms}ms` : ''} — ${e.detail}`)
    window.navigator.clipboard.writeText(lines.join('\n') || 'no perf entries').catch(() => {})
  }, [log])

  return (
    <div className={cn(card, 'mb-3')}>
      <h3 className={cn(panelTitle, 'mb-1 mt-0')}>Freeze diagnostics — chat switching & image sends</h3>
      <p className={cn(mutedText, 'mb-3 text-[0.8rem]')}>
        For the reported “the app freezes while something is loading when I switch chats / paste pictures and
        press Enter.” Switch a chat or send an image, then look here: the log names the stage (chat.load = the
        conversation DB read, chat.focusSession = the agent session rebind, chat.sendPrepare = the sync image
        encode, image.encode = one image). Big numbers = that stage on this machine.
      </p>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhostSm} disabled={convBusy} onClick={() => void runConvProbe()}>
          {convBusy ? 'Probing…' : 'Probe: heaviest chat timelines'}
        </button>
        <button type="button" className={btnGhostSm} disabled={encodeBusy} onClick={() => void runEncodeProbe()}>
          {encodeBusy ? 'Probing…' : 'Probe: image-encode cost (synthetic)'}
        </button>
        <button type="button" className={btnGhostSm} onClick={() => void reloadLog()}>
          Refresh log
        </button>
        <button type="button" className={btnGhostSm} onClick={copyReport}>
          Copy report
        </button>
      </div>

      <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {convProbe ?
          <div className="rounded-md border border-border p-2 text-[0.78rem]">
            <div className="font-semibold">Heaviest timelines ({convProbe.ok ? convProbe.totalMs : ''}ms total)</div>
            {convProbe.ok ?
              <ol className="m-0 list-decimal pl-5" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {convProbe.rows.map((r) => (
                  <li key={r.conversationId} className="mb-1">
                    <span className="font-medium">{r.title || '(untitled)'}</span>
                    <span className="text-text-secondary">
                      {' '}
                      — {r.rows} rows · {r.payloadKb}KB payload
                      {r.dbMs != null ? ` · ${r.dbMs}ms db read` : ''} · biggest row {r.biggestRowKb}KB
                    </span>
                  </li>
                ))}
              </ol>
            : <span className="text-red-400">{convProbe.error}</span>}
          </div>
        : null}
        {encodeProbe ?
          <div className="rounded-md border border-border p-2 text-[0.78rem]">
            <div className="font-semibold">
              Image-encode probe — {encodeProbe.ok ? `synthetic ${encodeProbe.syntheticImage.width}×${encodeProbe.syntheticImage.height}` : 'failed'}
            </div>
            {encodeProbe.ok ?
              <div>
                <div>read + decode: <span className="font-medium">{encodeProbe.readDecodeMs}ms</span></div>
                <div>resize + JPEG: <span className="font-medium">{encodeProbe.resizeJpegMs}ms</span></div>
                <div>base64: <span className="font-medium">{encodeProbe.base64Ms}ms</span></div>
                <div>
                  total: <span className="font-medium">{encodeProbe.totalMs}ms</span> → {encodeProbe.encodedKb}KB payload
                  {encodeProbe.reencoded ? ' (resized/re-encoded)' : ' (passthrough)'}
                </div>
                <div className={cn(mutedText, 'mt-1 text-[0.72rem]')}>
                  ≈ the app-wide stall when pressing Enter with an image like this. Runs for every image, every send.
                </div>
              </div>
            : <span className="text-red-400">{encodeProbe.error}</span>}
          </div>
        : null}
      </div>

      <div className="mt-3">
        <div className={cn(mutedText, 'mb-1 text-[0.74rem] font-semibold uppercase tracking-wide')}>
          Recent perf log (main process)
        </div>
        <div
          className="rounded-md border border-border bg-bg-primary p-2 font-mono text-[0.72rem] leading-relaxed"
          style={{ maxHeight: 260, overflowY: 'auto' }}
        >
          {log.length === 0 ?
            <span className={mutedText}>No entries yet — switch chats or send an attachment, then refresh.</span>
          : log.slice().reverse().map((e, i) => (
              <div key={`${e.at}-${i}`} className="whitespace-pre-wrap break-all">
                <span className="text-text-secondary">{fmtTime(e.at)}</span>{' '}
                <span className="text-accent">{e.scope}</span>
                {e.ms != null ? <span className="font-semibold"> {e.ms}ms</span> : null} — {e.detail}
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}