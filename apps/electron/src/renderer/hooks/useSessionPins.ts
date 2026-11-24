import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { SessionPinAction } from '@craft-agent/shared/sessions'

export function useSessionPins(workspaceId: string | undefined) {
  const [state, setState] = useState<{ workspaceId?: string; ids: string[] }>({ ids: [] })
  const pushVersion = useRef(0)
  const current = useRef(workspaceId)
  current.current = workspaceId
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    // Subscribe before the read; a late initial response must not overwrite a newer push.
    let receivedPush = false
    const off = window.electronAPI.onPinnedSessionsChanged((id, ids) => {
      if (id !== workspaceId) return
      receivedPush = true
      pushVersion.current++
      if (active) setState({ workspaceId, ids })
    })
    window.electronAPI.getPinnedSessions(workspaceId).then(ids => {
      if (active && !receivedPush) setState({ workspaceId, ids })
    }).catch(error => {
      if (active) toast.error(`Could not load pinned chats: ${String(error)}`)
    })
    return () => { active = false; off() }
  }, [workspaceId])
  const update = useCallback(async (action: SessionPinAction) => {
    if (!workspaceId) return
    try {
      const version = pushVersion.current
      const ids = await window.electronAPI.updatePinnedSessions(workspaceId, action)
      if (current.current === workspaceId && pushVersion.current === version) setState({ workspaceId, ids })
    } catch (error) {
      toast.error(`Could not update pinned chats: ${String(error)}`)
    }
  }, [workspaceId])
  return { pinnedIds: state.workspaceId === workspaceId ? state.ids : [], update }
}
