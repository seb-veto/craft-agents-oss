import { expect, it, mock } from 'bun:test'
import { RPC_CHANNELS, type ReviewRef } from '@craft-agent/shared/protocol'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import { HANDLED_CHANNELS, registerReviewsHandlers } from './reviews'

it('registers only the two Reviews reads and checks workspace and arguments before using credentials', async () => {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle: (channel, handler) => { handlers.set(channel, handler) }, push: () => {}, invokeClient: async () => {},
    hasClientCapability: () => false, findClientsWithCapability: () => [],
  }
  const workspaceRoot = mock((id: string) => id === 'w1' ? '/fake/workspace' : undefined)
  const reviews = {
    list: mock(async (_root: string, _team: boolean) => ({ viewer: 'octocat', toReview: [], created: [], truncated: false })),
    get: mock(async (_root: string, ref: ReviewRef) => ({
      item: { ...ref, title: 'PR', author: 'octocat', url: '', state: 'open' as const, createdAt: '', updatedAt: '', additions: 0, deletions: 0,
        changedFiles: 0, checks: 'none' as const, reviewDecision: 'none' as const, labels: [], headRef: 'feature', baseRef: 'main' },
      body: '', files: [], filesTruncated: false, checks: [], activity: [],
    })),
  }
  registerReviewsHandlers(server, { workspaceRoot, reviews })
  expect([...handlers.keys()]).toEqual([...HANDLED_CHANNELS])
  const ctx: RequestContext = { workspaceId: 'w1', clientId: 'c1', webContentsId: null }
  const list = handlers.get(RPC_CHANNELS.reviews.LIST)!
  const get = handlers.get(RPC_CHANNELS.reviews.GET)!
  await expect(list(ctx, 'w2', true)).rejects.toThrow('does not match')
  await expect(get({ ...ctx, workspaceId: null }, 'w1', {})).rejects.toThrow('does not match')
  expect(workspaceRoot).not.toHaveBeenCalled()
  await expect(list({ ...ctx, workspaceId: 'gone' }, 'gone', false)).rejects.toThrow('workspace not found')
  await expect(list(ctx, 'w1', 'yes')).rejects.toThrow('includeTeams')
  await expect(get(ctx, 'w1', { owner: 'octo-org', repo: '..', number: 7 })).rejects.toThrow('Expected a GitHub repository')
  expect(reviews.list).not.toHaveBeenCalled()
  expect(reviews.get).not.toHaveBeenCalled()

  const ref = { owner: 'octo-org', repo: 'test.repo', number: 7 }
  expect((await list(ctx, 'w1', true)).viewer).toBe('octocat')
  expect((await get(ctx, 'w1', { ...ref, extra: 'not forwarded' })).item.number).toBe(7)
  expect(reviews.list).toHaveBeenCalledWith('/fake/workspace', true)
  expect(reviews.get).toHaveBeenCalledWith('/fake/workspace', ref)
})
