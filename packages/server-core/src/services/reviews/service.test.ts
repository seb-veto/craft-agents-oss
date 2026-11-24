import { describe, expect, it, mock } from 'bun:test'
import type { TokenCandidate } from '../pr-watch/token-chain'
import type { ReviewFetch } from './github'
import { createReviewsService, validateReviewRef } from './service'

const root = '/fake/workspace'
const ref = { owner: 'octo-org', repo: 'test.repo', number: 7 }
const viewer = { login: 'octocat' }
const pr = {
  number: 7, title: 'Add docs', state: 'OPEN', isDraft: false,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z',
  additions: 12, deletions: 3, changedFiles: 2, reviewDecision: 'CHANGES_REQUESTED',
  headRefName: 'docs', baseRefName: 'main', author: { login: 'octocat' },
  repository: { owner: { login: ref.owner }, name: ref.repo },
  labels: { nodes: [{ name: 'documentation' }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
}
const file = { filename: 'README.md', status: 'modified', additions: 12, deletions: 3, patch: '@@ -1 +1 @@\n-old\n+new' }
const detail = { ...pr, body: 'What changed', timelineItems: { nodes: [] } }
const candidate = (id: string): TokenCandidate => ({ id, label: id, getToken: async () => `fake-${id}` })
const json = (data: unknown) => Response.json({ data })
const queues = (toReview: unknown[] = [], created: unknown[] = [], hasNextPage = false) => ({
  toReview: { nodes: toReview, pageInfo: { hasNextPage } },
  created: { nodes: created, pageInfo: { hasNextPage: false } },
})

function setup(fetch: ReviewFetch, list = [candidate('source')], timeoutMs?: number) {
  const candidates = mock(async (_root: string) => list)
  return { service: createReviewsService({ candidates, fetch, timeoutMs }), candidates }
}

function graphRequest(url: string, init: RequestInit): { query: string; variables: Record<string, unknown> } {
  expect(url).toBe('https://api.github.com/graphql')
  expect(init.method).toBe('POST')
  expect(init.redirect).toBe('error')
  expect(init.signal).toBeInstanceOf(AbortSignal)
  const body = JSON.parse(init.body as string)
  expect(body.query).toStartWith('query ')
  return body
}

describe('Reviews queues', () => {
  it('queries the viewer first, scopes both queues to that viewer, and preserves closed and draft authored PRs', async () => {
    const fetch = mock<ReviewFetch>(async (url, init) => {
      const { query, variables } = graphRequest(url, init)
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer fake-source')
      if (query.includes('ReviewsViewer')) return json({ viewer })
      expect(query.match(/first: 50\)/g)).toHaveLength(2)
      expect(variables).toEqual({
        review: 'is:pr is:open sort:updated-desc user-review-requested:@me',
        created: 'is:pr sort:updated-desc author:octocat',
      })
      return json(queues([pr, null, pr], [
        { ...pr, number: 1, state: 'CLOSED', isDraft: true, updatedAt: '2026-11-23T00:00:00Z' },
        { ...pr, number: 2, isDraft: true },
        { ...pr, number: 3, state: 'MERGED', updatedAt: '2026-11-22T00:00:00Z' },
      ], true))
    })
    const { service, candidates } = setup(fetch)
    const result = await service.list(root, false)
    expect(candidates).toHaveBeenCalledWith(root)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(result.viewer).toBe('octocat')
    expect(result.truncated).toBe(true)
    expect(result.created.map(item => item.state)).toEqual(['draft', 'closed', 'merged'])
    expect(result.toReview).toEqual([{
      ...ref, title: 'Add docs', url: 'https://github.com/octo-org/test.repo/pull/7', author: 'octocat',
      state: 'open', updatedAt: pr.updatedAt, createdAt: pr.createdAt, additions: 12, deletions: 3, changedFiles: 2,
      checks: 'failure', reviewDecision: 'changes_requested', labels: ['documentation'], headRef: 'docs', baseRef: 'main',
    }])
    expect(JSON.stringify(result)).not.toContain('fake-source')
  })

  it('includes team requests using the selected credential viewer and retries rejected credentials as a whole', async () => {
    const fetch = mock<ReviewFetch>(async (url, init) => {
      const { query, variables } = graphRequest(url, init)
      const denied = new Headers(init.headers).get('authorization') === 'Bearer fake-source'
      const login = denied ? 'first-user' : 'fallback-user'
      if (query.includes('ReviewsViewer')) return json({ viewer: { login } })
      expect(variables.review).toBe(`is:pr is:open sort:updated-desc review-requested:${login}`)
      expect(variables.created).toBe(`is:pr sort:updated-desc author:${login}`)
      if (denied) return Response.json({ errors: [{ type: 'FORBIDDEN', message: 'Never return this' }] })
      return json(queues())
    })
    const { service } = setup(fetch, [candidate('source'), candidate('gh')])
    expect(await service.list(root, true)).toEqual({ viewer: 'fallback-user', created: [], toReview: [], truncated: false })
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('bounds the queue and never returns raw upstream error text', async () => {
    const items = Array.from({ length: 51 }, (_, index) => ({ ...pr, number: index + 1 }))
    const { service } = setup(async (url, init) => graphRequest(url, init).query.includes('ReviewsViewer')
      ? json({ viewer }) : json(queues(items, [], true)))
    expect((await service.list(root, false)).toReview).toHaveLength(50)
    const { service: unavailable } = setup(async () => new Response('fake-source', { status: 401 }))
    await expect(unavailable.list(root, false)).rejects.toThrow('Connect or reconnect a GitHub source')
    const { service: offline } = setup(async () => { throw new Error('fake-source') })
    await expect(offline.list(root, false)).rejects.toThrow('Could not reach GitHub Reviews')
  })

  it('does not retry with other credentials on a rate limit', async () => {
    const fetch = mock<ReviewFetch>(async () => new Response(null, { status: 403, headers: { 'Retry-After': '60' } }))
    const { service } = setup(fetch, [candidate('source'), candidate('gh')])
    await expect(service.list(root, false)).rejects.toThrow('GitHub rate limit')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('Reviews detail', () => {
  it('returns overview, safe check URLs, submitted activity, and metadata for files with no patch', async () => {
    const fetch = mock<ReviewFetch>(async (url, init) => {
      if (url.endsWith('/graphql')) {
        const { variables } = graphRequest(url, init)
        expect(variables).toEqual(ref)
        return json({ repository: { pullRequest: {
          ...detail,
          commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING', contexts: { pageInfo: { hasNextPage: true }, nodes: [
            null,
            { __typename: 'CheckRun', name: 'Unit tests', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/octo-org/test.repo/actions/runs/1' },
            { __typename: 'StatusContext', context: 'Deploy', state: 'PENDING', targetUrl: 'javascript:alert(1)' },
          ] } } } }] },
          timelineItems: { pageInfo: { hasPreviousPage: true }, nodes: [
            { __typename: 'PullRequestReview', id: 'draft', state: 'PENDING', body: 'unsubmitted' },
            { __typename: 'PullRequestReview', id: 'r1', author: { login: 'reviewer' }, body: 'Looks good', state: 'APPROVED', submittedAt: '2026-11-03T00:00:00Z' },
            { __typename: 'IssueComment', id: 'c1', author: null, body: 'A comment', createdAt: '2026-11-02T00:00:00Z' },
          ] },
        } } })
      }
      expect(url).toBe('https://api.github.com/repos/octo-org/test.repo/pulls/7/files?per_page=20&page=1')
      expect(init.method).toBe('GET')
      expect(init.redirect).toBe('error')
      return Response.json([file, { filename: 'image.png', status: 'added', additions: 0, deletions: 0 }])
    })
    const result = await setup(fetch).service.get(root, ref)
    expect(result.body).toBe('What changed')
    expect(result.item.checks).toBe('pending')
    expect(result.checks).toEqual([
      { name: 'Unit tests', status: 'success', url: 'https://github.com/octo-org/test.repo/actions/runs/1' },
      { name: 'Deploy', status: 'pending' },
    ])
    expect(result.activity.map(event => [event.id, event.kind, event.state])).toEqual([['c1', 'comment', undefined], ['r1', 'review', 'approved']])
    expect(result.files[0]).toEqual({ path: 'README.md', status: 'modified', additions: 12, deletions: 3, patch: file.patch })
    expect(result.files[1]?.patch).toBeNull()
    expect(result.filesTruncated).toBe(false)
    expect(result.checksTruncated).toBe(true)
    expect(result.activityTruncated).toBe(true)
  })

  it('caps files and patch bytes, and never follows pagination links as URLs', async () => {
    const fetch = mock<ReviewFetch>(async (url, init) => {
      if (url.endsWith('/graphql')) return json({ repository: { pullRequest: { ...detail, changedFiles: 999 } } })
      expect(url).toStartWith('https://api.github.com/repos/')
      expect(init.redirect).toBe('error')
      const page = new URL(url).searchParams.get('page')
      return Response.json(Array.from({ length: 20 }, (_, index) => ({
        ...file, filename: `${page}-${index}`, patch: index === 0 ? 'ü'.repeat(128 * 1024) : 'ä'.repeat(16 * 1024),
      })), { headers: { Link: '<https://elsewhere.invalid/never-fetch>; rel="next"' } })
    })
    const result = await setup(fetch).service.get(root, ref)
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(result.files).toHaveLength(100)
    expect(result.files[0]?.patch).toBeNull()
    const patches = result.files.flatMap(f => f.patch ? [f.patch] : [])
    expect(patches).toHaveLength(32)
    expect(result.filesTruncated).toBe(true)
  })

  it('keeps overview if a file page exceeds the streamed response cap', async () => {
    let cancelled = false
    const fetch: ReviewFetch = async url => url.endsWith('/graphql')
      ? json({ repository: { pullRequest: detail } })
      : new Response(new ReadableStream({
          start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)) },
          cancel() { cancelled = true },
        }))
    const result = await setup(fetch).service.get(root, ref)
    expect(result.item.number).toBe(7)
    expect(result.files).toEqual([])
    expect(result.filesTruncated).toBe(true)
    expect(cancelled).toBe(true)
  })

  it('times out if the response body hangs', async () => {
    const fetch: ReviewFetch = async (_url, init) => new Response(new ReadableStream({
      start(controller) { init.signal?.addEventListener('abort', () => controller.error(new Error('upstream failure'))) },
    }))
    await expect(setup(fetch, undefined, 10).service.get(root, ref)).rejects.toThrow('request timed out')
  })

  it('rejects invalid coordinates before credentials or fetch and surfaces missing PRs safely', async () => {
    const fetch = mock<ReviewFetch>(async () => json({ repository: { pullRequest: null } }))
    const { service, candidates } = setup(fetch)
    for (const input of [null, { ...ref, owner: 'a/b' }, { ...ref, repo: '..' }, { ...ref, repo: 'foo%2fbar' }, { ...ref, repo: 'foo\n' },
      { ...ref, number: 0 }, { ...ref, number: 2 ** 31 }, { ...ref, number: 2.5 }, { ...ref, number: '7' }]) {
      expect(() => validateReviewRef(input)).toThrow('Expected a GitHub repository')
    }
    await expect(service.get(root, { ...ref, repo: 'https://evil.invalid' })).rejects.toThrow('Expected a GitHub repository')
    expect(candidates).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    await expect(service.get(root, ref)).rejects.toThrow('not found or inaccessible')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
