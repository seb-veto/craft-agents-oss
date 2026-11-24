import { getWorkspaces } from '@craft-agent/shared/config'
import { RPC_CHANNELS, type ReviewDetail, type ReviewsQueue } from '@craft-agent/shared/protocol'
import type { RequestContext, RpcServer } from '../../transport/types'
import { workspaceGitHubTokenCandidates } from '../../services/pr-watch/workspace-credentials'
import { REVIEWS_GITHUB_HOST } from '../../services/reviews/github'
import { createReviewsService, validateReviewRef } from '../../services/reviews/service'

export const HANDLED_CHANNELS = [RPC_CHANNELS.reviews.LIST, RPC_CHANNELS.reviews.GET] as const

export function registerReviewsHandlers(server: RpcServer, {
  workspaceRoot = (id: string) => getWorkspaces().find(workspace => workspace.id === id)?.rootPath,
  reviews = createReviewsService({ candidates: root => workspaceGitHubTokenCandidates(REVIEWS_GITHUB_HOST, root) }),
} = {}): void {
  function rootFor(ctx: RequestContext, workspaceId: unknown): string {
    if (typeof workspaceId !== 'string' || !workspaceId || ctx.workspaceId !== workspaceId) {
      throw new Error('Reviews workspace does not match the connected workspace.')
    }
    const root = workspaceRoot(workspaceId)
    if (!root) throw new Error('Reviews workspace not found.')
    return root
  }
  server.handle(RPC_CHANNELS.reviews.LIST, async (ctx, workspaceId: unknown, includeTeams: unknown): Promise<ReviewsQueue> => {
    const root = rootFor(ctx, workspaceId)
    if (typeof includeTeams !== 'boolean') throw new Error('Expected includeTeams to be a boolean.')
    return reviews.list(root, includeTeams)
  })
  server.handle(RPC_CHANNELS.reviews.GET, async (ctx, workspaceId: unknown, ref: unknown): Promise<ReviewDetail> => {
    const root = rootFor(ctx, workspaceId)
    return reviews.get(root, validateReviewRef(ref))
  })
}
