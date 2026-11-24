import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

import { registerAuthHandlers } from './auth'
import { registerAutomationsHandlers } from './automations'
import { registerDecisionsHandlers } from './decisions'
import { registerFilesHandlers } from './files'
import { registerSessionPinsHandlers } from './session-pins'
import { registerLabelsHandlers } from './labels'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerResourcesHandlers } from './resources'
import { registerOnboardingHandlers } from './onboarding'
import { cleanupSessionFileWatchForClient, registerSessionsHandlers } from './sessions'
export { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { cleanupPrWatchForClient, registerPrWatchHandlers } from './pr-watch'
import { registerReviewsHandlers } from './reviews'
import { registerCodingReposHandlers } from './coding-repos'
import { registerServerHandlers } from './server'
import type { ServerHandlerContext } from '../../bootstrap/headless-start'
export type { ServerHandlerContext } from '../../bootstrap/headless-start'
export { getHealthCheck } from './server'
import { registerSettingsHandlers } from './settings'
import { registerProjectsHandlers } from './projects'
import { registerGoalsHandlers } from './goals'
export { registerGoalsHandlers } from './goals'
export { GoalService, configureGoalRuntime, getGoalService } from '../../goals/service'
export type { GoalRuntime } from '../../goals/service'
import { registerPagesHandlers } from './pages'
import { registerDocumentsHandlers } from './documents'
import { registerSkillsHandlers } from './skills'
import { registerSourcesHandlers } from './sources'
import { registerStatusesHandlers } from './statuses'
import { registerSystemCoreHandlers } from './system'
import { registerTasksHandlers } from './tasks'
import { registerTransferHandlers } from './transfer'
import { registerWorkspaceCoreHandlers } from './workspace'
import { registerMessagingHandlers } from './messaging'

export function registerCoreRpcHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
): void {
  registerAuthHandlers(server, deps)
  registerAutomationsHandlers(server, deps)
  registerDecisionsHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerSessionPinsHandlers(server, deps)
  registerLabelsHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerOAuthHandlers(server, deps)
  registerOnboardingHandlers(server, deps)
  registerResourcesHandlers(server, deps)
  registerSessionsHandlers(server, deps)
  if (serverCtx) registerServerHandlers(server, deps, serverCtx)
  registerSettingsHandlers(server, deps)
  registerProjectsHandlers(server, deps)
  registerPagesHandlers(server, deps)
  registerGoalsHandlers(server, deps)
  registerDocumentsHandlers(server, deps)
  registerPrWatchHandlers(server, deps)
  registerReviewsHandlers(server)
  registerCodingReposHandlers(server, deps)
  registerSkillsHandlers(server, deps)
  registerSourcesHandlers(server, deps)
  registerStatusesHandlers(server, deps)
  registerSystemCoreHandlers(server, deps)
  registerTasksHandlers(server, deps)
  registerTransferHandlers(server)
  registerWorkspaceCoreHandlers(server, deps)
  registerMessagingHandlers(server, deps)
}

/** Per-client server state to drop when a client disconnects (session file watches, PR watches). */
export function cleanupRpcClientResources(clientId: string): void {
  cleanupSessionFileWatchForClient(clientId)
  cleanupPrWatchForClient(clientId)
}
