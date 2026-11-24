import type { ReviewDetail, ReviewFile, ReviewItem, ReviewRef, ReviewsQueue } from '@craft-agent/shared/protocol'
import { GitHubAuthError } from '../pr-watch/github-client'
import { TokenChain, type TokenCandidate } from '../pr-watch/token-chain'
import { createReviewsGitHub, ReviewResponseTooLarge, type ReviewFetch } from './github'
import { DETAIL_QUERY, MAX_QUEUE_ITEMS, QUEUES_QUERY, VIEWER_QUERY } from './queries'

const REQUEST_TIMEOUT_MS = 15_000
const FILES_PER_PAGE = 20
const MAX_FILE_PAGES = 5
const MAX_PATCH_BYTES = 128 * 1024
const TOTAL_PATCH_BYTES = 1024 * 1024
const encoder = new TextEncoder()

export function validateReviewRef(ref: unknown): ReviewRef {
  const { owner, repo, number } = (ref ?? {}) as Partial<ReviewRef>
  if (!validOwner(owner) || typeof repo !== 'string' || !repo.length || repo.length > 100
    || /[^\w.-]/.test(repo) || repo === '.' || repo === '..'
    || typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 2_147_483_647) {
    throw new Error('Expected a GitHub repository owner, repository name, and positive pull request number.')
  }
  return { owner, repo, number }
}

function validOwner(owner: unknown): owner is string {
  // Underscores support enterprise-managed accounts on github.com.
  return typeof owner === 'string' && owner.length <= 39 && /^[a-z0-9]/i.test(owner) && !/[^\w-]/.test(owner)
}

interface PageInfo { hasNextPage?: boolean; hasPreviousPage?: boolean }
interface Nodes<T> { nodes: (T | null)[]; pageInfo?: PageInfo }
interface GqlPr {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  createdAt: string
  updatedAt: string
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  headRefName: string
  baseRefName: string
  author: { login: string } | null
  repository: { owner: { login: string }; name: string }
  labels: Nodes<{ name: string }> | null
  commits: Nodes<{ commit: { statusCheckRollup: { state: string; contexts?: Nodes<GqlCheck> } | null } }>
}
type GqlCheck =
  | { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null }
interface GqlActivity {
  __typename: 'IssueComment' | 'PullRequestReview'
  id: string
  author: { login: string } | null
  body: string
  createdAt: string
  submittedAt?: string | null
  state?: string
}
interface GqlDetail extends GqlPr {
  body: string
  timelineItems: Nodes<GqlActivity>
}
interface RestFile {
  filename: string
  status: string
  additions: number
  deletions: number
  patch?: string
}

function rollup(pr: GqlPr) {
  return pr.commits.nodes[0]?.commit.statusCheckRollup
}

function summaryChecks(state?: string): ReviewItem['checks'] {
  if (state === 'FAILURE' || state === 'ERROR') return 'failure'
  if (state === 'SUCCESS') return 'success'
  return state ? 'pending' : 'none'
}

function mapItem(pr: GqlPr): ReviewItem {
  const ref = validateReviewRef({ owner: pr.repository.owner.login, repo: pr.repository.name, number: pr.number })
  return {
    ...ref,
    title: pr.title,
    url: `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
    author: pr.author?.login ?? 'ghost',
    state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.isDraft ? 'draft' : 'open',
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    checks: summaryChecks(rollup(pr)?.state),
    reviewDecision: pr.reviewDecision ? pr.reviewDecision.toLowerCase() as ReviewItem['reviewDecision'] : 'none',
    labels: pr.labels?.nodes.flatMap(label => label ? [label.name] : []) ?? [],
    headRef: pr.headRefName,
    baseRef: pr.baseRefName,
  }
}

function externalCheckUrl(value: string | null): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href
  } catch { /* invalid or unsafe check link */ }
}

function mapChecks(nodes: Nodes<GqlCheck> | undefined): ReviewDetail['checks'] {
  return nodes?.nodes.flatMap(check => {
    if (!check) return []
    const run = check.__typename === 'CheckRun'
    const url = externalCheckUrl(run ? check.detailsUrl : check.targetUrl)
    return [{ name: run ? check.name : check.context, status: (run ? check.conclusion ?? check.status : check.state).toLowerCase(), ...(url ? { url } : {}) }]
  }) ?? []
}

function mapActivity(nodes: Nodes<GqlActivity>): ReviewDetail['activity'] {
  return nodes.nodes.flatMap((event): ReviewDetail['activity'] => {
    if (!event || event.state === 'PENDING') return []
    return [{
      id: event.id,
      author: event.author?.login ?? 'ghost',
      body: event.body,
      createdAt: event.submittedAt ?? event.createdAt,
      kind: event.__typename === 'IssueComment' ? 'comment' : 'review',
      ...(event.state ? { state: event.state.toLowerCase() } : {}),
    }]
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function mapQueue(connection: Nodes<GqlPr>): ReviewItem[] {
  const items = new Map<string, ReviewItem>()
  for (const pr of connection.nodes.slice(0, MAX_QUEUE_ITEMS)) {
    if (!pr?.repository) continue
    const item = mapItem(pr)
    items.set(`${item.owner}/${item.repo}#${item.number}`.toLowerCase(), item)
  }
  return [...items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function loadFiles(api: ReturnType<typeof createReviewsGitHub>, item: ReviewItem) {
  const files: ReviewFile[] = []
  if (item.changedFiles === 0) return { files, filesTruncated: false }
  let remaining = TOTAL_PATCH_BYTES
  let patchesOmitted = false
  let hasNext = false
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    let result: Awaited<ReturnType<typeof api.files>>
    try {
      result = await api.files(item.owner, item.repo, item.number, FILES_PER_PAGE, page)
    } catch (error) {
      if (error instanceof ReviewResponseTooLarge) return { files, filesTruncated: true }
      throw error
    }
    if (!Array.isArray(result.data)) throw new Error('GitHub returned an unreadable Reviews files response.')
    for (const file of (result.data as RestFile[]).slice(0, FILES_PER_PAGE)) {
      let patch = typeof file.patch === 'string' ? file.patch : null
      if (patch !== null) {
        const size = encoder.encode(patch).byteLength
        if (size > MAX_PATCH_BYTES || size > remaining) {
          patchesOmitted = true
          patch = null // Never send a broken partial hunk.
        } else {
          remaining -= size
        }
      }
      files.push({ path: file.filename, status: file.status, additions: file.additions, deletions: file.deletions, patch })
    }
    // Only use Link to check if another page exists; never follow a server-provided URL.
    hasNext = /;\s*rel="next"/.test(result.headers.get('link') ?? '')
    if (!hasNext || !result.data.length) break
  }
  return { files, filesTruncated: hasNext || patchesOmitted || files.length < item.changedFiles }
}

interface ReviewsDeps {
  candidates: (workspaceRoot: string) => Promise<readonly TokenCandidate[]>
  fetch?: ReviewFetch
  timeoutMs?: number
}

export function createReviewsService(deps: ReviewsDeps) {
  async function withCredential<T>(workspaceRoot: string, action: (api: ReturnType<typeof createReviewsGitHub>) => Promise<T>, failure: string): Promise<T> {
    // New chain per invocation: do not retain workspace/identity decisions across requests.
    // A failed candidate restarts the whole operation, so a queue never mixes viewer identities.
    const signal = AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const candidates = await deps.candidates(workspaceRoot)
    const result = await new TokenChain().run('reviews', candidates, token => action(createReviewsGitHub(deps.fetch ?? fetch, token, signal)))
    if (!result) throw new Error(failure)
    return result.result
  }

  const connect = 'Connect or reconnect a GitHub source in this workspace, or run gh auth login --hostname github.com on the workspace server.'
  return {
    list(workspaceRoot: string, includeTeams: boolean): Promise<ReviewsQueue> {
      return withCredential(workspaceRoot, async api => {
        const { viewer } = await api.graphql<{ viewer: { login: string } | null }>(VIEWER_QUERY)
        if (!validOwner(viewer?.login)) throw new GitHubAuthError('A personal GitHub login is required')
        const queues = await api.graphql<{ toReview: Nodes<GqlPr>; created: Nodes<GqlPr> }>(QUEUES_QUERY, {
          review: `is:pr is:open sort:updated-desc ${includeTeams ? `review-requested:${viewer.login}` : 'user-review-requested:@me'}`,
          created: `is:pr sort:updated-desc author:${viewer.login}`,
        })
        return {
          viewer: viewer.login,
          toReview: mapQueue(queues.toReview),
          created: mapQueue(queues.created),
          truncated: [queues.toReview, queues.created].some(queue => queue.pageInfo?.hasNextPage || queue.nodes.length > MAX_QUEUE_ITEMS),
        }
      }, `A usable personal GitHub login is required for Reviews. ${connect}`)
    },
    async get(workspaceRoot: string, ref: ReviewRef): Promise<ReviewDetail> {
      const validRef = validateReviewRef(ref)
      return withCredential(workspaceRoot, async api => {
        const data = await api.graphql<{ repository: { pullRequest: GqlDetail | null } | null }>(DETAIL_QUERY, validRef)
        const pr = data.repository?.pullRequest
        if (!pr) throw new GitHubAuthError('Pull request missing or inaccessible')
        const item = mapItem(pr)
        const contexts = rollup(pr)?.contexts
        return {
          item,
          body: pr.body,
          ...await loadFiles(api, item),
          checks: mapChecks(contexts),
          activity: mapActivity(pr.timelineItems),
          checksTruncated: !!contexts?.pageInfo?.hasNextPage,
          activityTruncated: !!pr.timelineItems.pageInfo?.hasPreviousPage,
        }
      }, `GitHub pull request not found or inaccessible. Check that it exists and the GitHub login has repository access. ${connect}`)
    },
  }
}
