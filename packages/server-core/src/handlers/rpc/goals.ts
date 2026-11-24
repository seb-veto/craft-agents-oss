import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { createGoalSchema, goalIdSchema, userActionSchema } from '@craft-agent/shared/goals'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { RequestContext } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { getGoalService, type GoalService } from '../../goals/service'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.goals.GET,
  RPC_CHANNELS.goals.GET_ONE,
  RPC_CHANNELS.goals.CREATE,
  RPC_CHANNELS.goals.ACTION,
] as const

/** These endpoints are human renderer controls. Agent tools must use GoalService.forSession instead. */
export function registerGoalsHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  resolveWorkspace: (id: string) => { id: string; rootPath: string } | null = getWorkspaceByNameOrId,
): () => void {
  const subscriptions = new Map<string, () => void>()
  function service(ctx: RequestContext, value: unknown): { goals: GoalService; workspaceId: string } {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid workspace ID')
    const workspace = resolveWorkspace(value)
    if (!workspace) throw new Error('Workspace not found')
    if (ctx.workspaceId && ctx.workspaceId !== workspace.id) throw new Error('Goals workspace does not match the connected client')
    const goals = getGoalService(workspace.rootPath)
    if (!subscriptions.has(workspace.id)) {
      subscriptions.set(workspace.id, goals.subscribe(list =>
        pushTyped(server, RPC_CHANNELS.goals.CHANGED, { to: 'workspace', workspaceId: workspace.id }, workspace.id, list)))
    }
    return { goals, workspaceId: workspace.id }
  }
  server.handle(RPC_CHANNELS.goals.GET, (ctx, workspaceId: unknown) => service(ctx, workspaceId).goals.list())
  server.handle(RPC_CHANNELS.goals.GET_ONE, (ctx, workspaceId: unknown, goalId: unknown) => service(ctx, workspaceId).goals.get(goalIdSchema.parse(goalId)))
  server.handle(RPC_CHANNELS.goals.CREATE, (ctx, workspaceId: unknown, value: unknown) => {
    const { goals, workspaceId: id } = service(ctx, workspaceId)
    const input = createGoalSchema.parse(value)
    if (input.ownerSessionId) {
      if (!deps.sessionManager.getSessions(id).some(session => session.id === input.ownerSessionId)) {
        throw new Error('Goal owner session must exist in this workspace')
      }
    }
    return goals.create(input)
  })
  server.handle(RPC_CHANNELS.goals.ACTION, (ctx, workspaceId: unknown, goalId: unknown, action: unknown) =>
    service(ctx, workspaceId).goals.userAction(goalIdSchema.parse(goalId), userActionSchema.parse(action)))
  return () => {
    for (const unsubscribe of subscriptions.values()) unsubscribe()
    subscriptions.clear()
  }
}
