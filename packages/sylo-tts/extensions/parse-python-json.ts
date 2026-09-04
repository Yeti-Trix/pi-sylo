/** Parse JSON emitted by sylo-tts Python scripts (stdout may include log lines). */
export function parsePythonScriptJsonStdout(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim()
  if (!trimmed) {
    throw new Error('Python script produced no stdout')
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    const lines = trimmed.split(/\r?\n/)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim()
      if (!line?.startsWith('{')) continue
      try {
        return JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
    }

    const lastBrace = trimmed.lastIndexOf('{')
    if (lastBrace >= 0) {
      return JSON.parse(trimmed.slice(lastBrace)) as Record<string, unknown>
    }

    throw new Error(`Invalid JSON from Python script: ${trimmed.slice(0, 240)}`)
  }
}
