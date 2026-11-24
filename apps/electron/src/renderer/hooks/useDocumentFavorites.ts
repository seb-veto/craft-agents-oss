import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceDocument } from '@craft-agent/shared/documents/types'

/** Stable alphabetic order: autosaving a document must not shuffle the sidebar. */
export function selectDocumentFavorites(documents: WorkspaceDocument[]): WorkspaceDocument[] {
  return documents.filter(document => document.favorite).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

/** Workspace-scoped sidebar favorites, refreshed by document saves in any connected window. */
export function useDocumentFavorites(workspaceId: string | null | undefined) {
  const [state, setState] = useState<{ workspaceId: string | null; documents: WorkspaceDocument[]; error: string | null }>({ workspaceId: null, documents: [], error: null })
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    if (!workspaceId) return
    const request = ++generation.current
    try {
      const documents = await window.electronAPI.getDocuments(workspaceId)
      if (request === generation.current) setState({ workspaceId, documents: selectDocumentFavorites(documents), error: null })
    } catch (error) {
      if (request === generation.current) setState(previous => ({ workspaceId, documents: previous.workspaceId === workspaceId ? previous.documents : [], error: error instanceof Error ? error.message : 'Unable to load favorites' }))
    }
  }, [workspaceId])
  useEffect(() => {
    if (!workspaceId) return
    let active = true
    void refresh()
    const unsubscribe = window.electronAPI.onDocumentsChanged(() => { if (active) void refresh() })
    return () => {
      active = false
      // Invalidate any request from the old workspace before the next effect starts.
      generation.current += 1
      unsubscribe()
    }
  }, [workspaceId, refresh])
  return {
    favorites: state.workspaceId === workspaceId ? state.documents : [],
    error: state.workspaceId === workspaceId ? state.error : null,
    refresh,
  }
}
