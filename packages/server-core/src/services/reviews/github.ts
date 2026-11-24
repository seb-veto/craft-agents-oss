import { GitHubAuthError } from '../pr-watch/github-client'

export const REVIEWS_GITHUB_HOST = 'github.com'
const API = 'https://api.github.com'
const MAX_JSON_BYTES = 2 * 1024 * 1024

export type ReviewFetch = (url: string, init: RequestInit) => Promise<Response>
export class ReviewResponseTooLarge extends Error {
  constructor() { super('The GitHub Reviews response is too large. Open the pull request on GitHub to see the full result.') }
}

async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_JSON_BYTES) {
    void response.body?.cancel().catch(() => {})
    throw new ReviewResponseTooLarge()
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing response body')
  const decoder = new TextDecoder()
  const parts: string[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_JSON_BYTES) throw new ReviewResponseTooLarge()
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return JSON.parse(parts.join(''))
  } finally {
    void reader.cancel().catch(() => {})
  }
}

/** Only ever request the fixed GitHub API origin. No redirects, retries or raw error bodies. */
export function createReviewsGitHub(doFetch: ReviewFetch, token: string, signal: AbortSignal) {
  const rateLimited = () => new Error('GitHub rate limit reached for Reviews. Wait and try again.')
  const timeout = () => new Error('GitHub Reviews request timed out. Try again.')
  async function request(path: string, body?: object): Promise<{ data: unknown; headers: Headers }> {
    if (signal.aborted) throw timeout()
    let response: Response
    try {
      response = await doFetch(`${API}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: body ? 'application/json' : 'application/vnd.github+json',
          ...(body ? { 'Content-Type': 'application/json' } : { 'X-GitHub-Api-Version': '2022-11-28' }),
          'User-Agent': 'craft-agents-reviews',
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal,
      })
    } catch {
      throw signal.aborted ? timeout() : new Error('Could not reach GitHub Reviews. Check the workspace server’s network and try again.')
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      const { status, headers } = response
      if (status === 429 || (status === 403 && (headers.has('retry-after') || headers.get('x-ratelimit-remaining') === '0'))) throw rateLimited()
      if (status === 401 || status === 403 || status === 404) throw new GitHubAuthError('GitHub Reviews access denied', status)
      throw new Error(`GitHub Reviews returned HTTP ${status}. Try again or open GitHub directly.`)
    }
    try {
      return { data: await readJson(response), headers: response.headers }
    } catch (error) {
      if (error instanceof ReviewResponseTooLarge) throw error
      if (signal.aborted) throw timeout()
      throw new Error('GitHub returned an unreadable Reviews response. Try again or open GitHub directly.')
    }
  }

  return {
    async graphql<T>(query: string, variables: object = {}): Promise<T> {
      const { data } = await request('/graphql', { query, variables })
      const envelope = data as { data?: T; errors?: { type?: string; extensions?: { type?: string } }[] } | null
      const types = envelope?.errors?.map(error => error.type ?? error.extensions?.type) ?? []
      if (types.includes('RATE_LIMITED')) throw rateLimited()
      if (types.some(type => type === 'NOT_FOUND' || type === 'FORBIDDEN' || type === 'UNAUTHORIZED')) {
        throw new GitHubAuthError('GitHub Reviews access denied')
      }
      if (!envelope?.data || types.length) throw new Error('GitHub could not load Reviews. Try again or open GitHub directly.')
      return envelope.data
    },
    files: (owner: string, repo: string, number: number, perPage: number, page: number) =>
      request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=${perPage}&page=${page}`),
  }
}
