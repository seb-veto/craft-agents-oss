import { tokenCandidates, type GitHubSourceLike } from './token-chain'

/**
 * The workspace's GitHub sources (API or MCP, enabled) as token candidates. OAuth tokens go through
 * the refresh manager; a source without a stored credential is skipped without touching it.
 */
async function loadGitHubSources(workspaceRootPath: string): Promise<GitHubSourceLike[]> {
  const { loadWorkspaceSources, getSourceCredentialManager, TokenRefreshManager } = await import('@craft-agent/shared/sources')
  const credentials = getSourceCredentialManager()
  const refresh = new TokenRefreshManager(credentials)
  return loadWorkspaceSources(workspaceRootPath)
    .filter(source => source.config.provider === 'github' && source.config.enabled !== false && (source.config.type === 'api' || source.config.type === 'mcp'))
    .map(source => ({
      slug: source.config.slug,
      name: source.config.name,
      getToken: async () => {
        const stored = await credentials.load(source)
        if (!stored?.value) return null
        const token = stored.refreshToken ? (await refresh.ensureFreshToken(source)).token ?? null : stored.value
        // Header-map credentials (JSON) are not bearer tokens
        return token && !token.trimStart().startsWith('{') ? token : null
      },
    }))
}

/** The same source → gh credential order for the PR watcher and personal Reviews. */
export async function workspaceGitHubTokenCandidates(host: string, workspaceRootPath: string) {
  return tokenCandidates(host, await loadGitHubSources(workspaceRootPath).catch(() => []))
}
