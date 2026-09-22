import { spawn, type ChildProcess } from 'node:child_process'

/**
 * A child is still alive until it reports an exit code or a fatal signal.
 *
 * `proc.killed` cannot answer this: it only records that a signal was *delivered*, so
 * it is already true right after a SIGTERM the child ignored — which is why the old
 * SIGKILL fallbacks, all gated on `!proc.killed`, never ran.
 */
export function isProcAlive(proc: ChildProcess): boolean {
  return proc.exitCode === null && proc.signalCode === null
}

function signalKill(proc: ChildProcess, sigkillAfterMs: number): void {
  try {
    proc.kill('SIGTERM')
  } catch {
    return
  }
  const escalate = setTimeout(() => {
    if (!isProcAlive(proc)) return
    try {
      proc.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }, sigkillAfterMs)
  escalate.unref()
}

/**
 * Kill a child Pi CLI **and everything under it**.
 *
 * `proc.kill()` alone is not enough on Windows: the CLI is reached through a shell
 * (`pi.cmd` → `node`), so the signal takes out cmd.exe while the real agent — and
 * whatever it spawned, e.g. a `find /` walking every drive — keeps running and keeps
 * the inherited stdio pipes open. `close` then never fires and the run is stranded as
 * "running" with an idle GPU.
 *
 * Order matters: signalling the shell first *orphans* the tree, because taskkill cannot
 * enumerate the children of a process that has already exited. So taskkill walks the
 * tree first, and a signal is only the fallback for when it could not run.
 *
 * On POSIX the shell usually `exec`s the CLI in place, so the signal reaches the agent
 * itself. A grandchild it spawned can still outlive it; killing a process group would
 * need the child spawned `detached`, which is a spawn-site change, not one for here.
 */
export function killSubagentTree(proc: ChildProcess, sigkillAfterMs = 5000): void {
  const pid = proc.pid
  if (process.platform !== 'win32' || pid === undefined) {
    signalKill(proc, sigkillAfterMs)
    return
  }

  let taskkill: ChildProcess
  try {
    taskkill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } catch {
    signalKill(proc, sigkillAfterMs)
    return
  }

  const fallback = (): void => {
    if (isProcAlive(proc)) signalKill(proc, sigkillAfterMs)
  }
  taskkill.on('error', fallback)
  taskkill.on('exit', (code) => {
    if (code !== 0) fallback()
  })
  taskkill.unref()

  const escalate = setTimeout(fallback, sigkillAfterMs)
  escalate.unref()
}
