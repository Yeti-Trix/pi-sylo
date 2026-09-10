/**
 * Crash forensics for the main process.
 *
 * Sylo previously had no `uncaughtException`, `unhandledRejection`, or
 * `render-process-gone` handler, and the launcher scripts truncate
 * `logs/sylo-dev*.log` on every start — so a crash after hours of use left no
 * evidence at all. This appends to a rotated log under `userData` that survives
 * restarts.
 *
 * Writes are event-driven, not periodic: nothing touches the disk unless something
 * actually goes wrong, or memory crosses a threshold it has not crossed before.
 */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'

const MAX_LOG_BYTES = 2 * 1024 * 1024

let logPath: string | null = null

function resolveLogPath(): string {
  if (logPath) return logPath
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  logPath = join(dir, 'crash.log')
  return logPath
}

function rotateIfNeeded(file: string): void {
  try {
    if (statSync(file).size < MAX_LOG_BYTES) return
    renameSync(file, `${file}.1`)
  } catch {
    /* first write, or a previous rotation left the file locked */
  }
}

/** MM-DD-YYYY HH:MM:SS in local time. */
function stamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}`
  return `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.stack ?? `${detail.name}: ${detail.message}`
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

/** Append one line to the crash log. Never throws — logging must not cause a crash. */
export function logCrashEvent(tag: string, detail: unknown): void {
  const line = `[${stamp()}] ${tag}: ${formatDetail(detail)}\n`
  try {
    const file = resolveLogPath()
    rotateIfNeeded(file)
    appendFileSync(file, line, 'utf8')
  } catch {
    /* disk full or userData unavailable — the console copy below is all we get */
  }
  console.error(`[sylo crash] ${tag}:`, detail)
}

function memoryMb(): number {
  return Math.round(process.memoryUsage().rss / (1024 * 1024))
}

/**
 * Record main-process memory only when it crosses a new high watermark band, so a
 * long session produces a handful of lines instead of a continuous write stream.
 */
function startMemoryWatermarkLog(): void {
  let watermarkMb = 1024
  const timer = setInterval(() => {
    const rss = memoryMb()
    if (rss < watermarkMb) return
    logCrashEvent('memory-watermark', `main process RSS ${rss} MB (threshold ${watermarkMb} MB)`)
    watermarkMb = rss + 512
  }, 60_000)
  timer.unref?.()
}

/**
 * Install process- and app-level crash handlers. Call before `app.whenReady()` so
 * failures during startup are captured too.
 */
export function installCrashHandlers(getMainWindow: () => BrowserWindow | null): void {
  process.on('uncaughtException', (err) => {
    // Deliberately not exiting: an unhandled rejection in one IPC handler should not
    // take down a window the operator has been working in for hours. The log is the
    // record of what actually went wrong.
    logCrashEvent('uncaughtException', err)
  })

  process.on('unhandledRejection', (reason) => {
    logCrashEvent('unhandledRejection', reason)
  })

  app.on('render-process-gone', (_event, _contents, details) => {
    logCrashEvent(
      'render-process-gone',
      `reason=${details.reason} exitCode=${details.exitCode}`,
    )
    // 'clean-exit' is a normal window teardown; anything else lost the UI.
    if (details.reason === 'clean-exit') return
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      logCrashEvent('render-process-gone', 'reloading renderer')
      win.reload()
    }
  })

  app.on('child-process-gone', (_event, details) => {
    logCrashEvent(
      'child-process-gone',
      `type=${details.type} name=${details.name ?? '?'} reason=${details.reason} exitCode=${details.exitCode}`,
    )
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('unresponsive', () => {
      logCrashEvent('unresponsive', `webContents ${contents.id} stopped responding`)
    })
    contents.on('responsive', () => {
      logCrashEvent('responsive', `webContents ${contents.id} recovered`)
    })
  })

  startMemoryWatermarkLog()
  logCrashEvent('startup', `Sylo main process started (pid ${process.pid}, RSS ${memoryMb()} MB)`)
}

/** Absolute path of the crash log, for the About/diagnostics surface. */
export function crashLogPath(): string {
  return resolveLogPath()
}
