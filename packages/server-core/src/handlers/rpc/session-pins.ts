import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadSessionPins, updateSessionPins, type SessionPinAction } from '@craft-agent/shared/sessions'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [RPC_CHANNELS.sessionPins.GET, RPC_CHANNELS.sessionPins.UPDATE] as const

export function registerSessionPinsHandlers(server: RpcServer, deps: HandlerDeps): void {
  function workspaceFor(workspaceId: string, callerWorkspaceId: string | null) {
    if (typeof workspaceId !== 'string') throw new Error('Workspace ID required')
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (callerWorkspaceId && getWorkspaceByNameOrId(callerWorkspaceId)?.id !== workspace.id) throw new Error('Workspace does not match this client')
    return workspace
  }
  server.handle(RPC_CHANNELS.sessionPins.GET, async (ctx, workspaceId: string) => {
    const workspace = workspaceFor(workspaceId, ctx.workspaceId)
    return loadSessionPins(workspace.rootPath)
  })
  server.handle(RPC_CHANNELS.sessionPins.UPDATE, async (ctx, workspaceId: string, action: SessionPinAction) => {
    const workspace = workspaceFor(workspaceId, ctx.workspaceId)
    if (!action || typeof action !== 'object' || typeof action.sessionId !== 'string') throw new Error('Invalid pin action')
    await deps.sessionManager.waitForSessionsLoaded()
    // A pin can only target a session belonging to this workspace. Unpin also permits stale IDs.
    if (action.type !== 'unpin') {
      const session = await deps.sessionManager.getSession(action.sessionId)
      if (!session || session.workspaceId !== workspace.id) throw new Error('Session not found in this workspace')
    }
    const ids = updateSessionPins(workspace.rootPath, action)
    pushTyped(server, RPC_CHANNELS.sessionPins.CHANGED, { to: 'workspace', workspaceId: workspace.id }, workspace.id, ids)
    return ids
  })
}
