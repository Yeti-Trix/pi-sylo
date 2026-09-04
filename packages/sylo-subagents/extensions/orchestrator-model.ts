/** Pi CLI flags for the Sylo orchestrator model (Settings → Model), passed via broker env. */
export function orchestratorModelCliArgs(): { provider?: string; modelId?: string; args: string[] } {
  const provider = process.env.SYLO_MODEL_PROVIDER?.trim() ?? ''
  const modelId = process.env.SYLO_MODEL_ID?.trim() ?? ''
  if (provider && modelId) {
    return { provider, modelId, args: ['--provider', provider, '--model', modelId] }
  }
  if (modelId) {
    return { modelId, args: ['--model', modelId] }
  }
  return { args: [] }
}
