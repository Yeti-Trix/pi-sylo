import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type PiSpawnInvocation = {
  command: string
  args: string[]
  shell?: boolean
}

/** Resolve how to spawn a child `pi` CLI from the Sylo broker. */
export function resolvePiSpawn(piArgs: string[]): PiSpawnInvocation {
  const envCli = process.env.SYLO_PI_CLI?.trim()
  if (envCli) {
    return { command: envCli, args: piArgs, shell: process.platform === 'win32' }
  }

  try {
    const require = createRequire(import.meta.url)
    const pkgJson = require.resolve('@earendil-works/pi-coding-agent/package.json')
    const cliJs = join(dirname(pkgJson), 'dist/cli.js')
    if (existsSync(cliJs)) {
      return { command: process.execPath, args: [cliJs, ...piArgs] }
    }
  } catch {
    /* fall through */
  }

  return { command: 'pi', args: piArgs, shell: process.platform === 'win32' }
}
