import { useCallback, useEffect, useState } from 'react'

import { bridge } from '../bridge'

const HOST_EVENT_KIND = 'sylo-skill-bridge-event'

/** Active workspace Pi cwd — initial RPC + host push when sidebar workspace changes. */
export function useResolvedWorkspace(): {
  workspaceDir: string
  refreshWorkspace: () => Promise<void>
} {
  const [workspaceDir, setWorkspaceDir] = useState('')

  const refreshWorkspace = useCallback(async () => {
    try {
      const ws = await bridge.workspaceResolvedPiCwd()
      setWorkspaceDir(typeof ws === 'string' ? ws.trim() : '')
    } catch {
      setWorkspaceDir('')
    }
  }, [])

  useEffect(() => {
    void refreshWorkspace()
  }, [refreshWorkspace])

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as {
        kind?: string
        event?: string
        payload?: { piCwd?: string }
      }
      if (d?.kind !== HOST_EVENT_KIND || d?.event !== 'workspaceChanged') return
      const cwd = typeof d.payload?.piCwd === 'string' ? d.payload.piCwd.trim() : ''
      setWorkspaceDir(cwd)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  return { workspaceDir, refreshWorkspace }
}