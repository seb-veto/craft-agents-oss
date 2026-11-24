import type { ReviewItem, ReviewRef } from '@craft-agent/shared/protocol'

export type ReviewTab = 'toReview' | 'created'
export type ReviewGroup = 'status' | 'repository' | 'author' | 'size' | 'none'
export type ReviewOrder = 'opened' | 'updated' | 'size'
export interface ReviewPreferences {
  grouping: ReviewGroup
  ordering: ReviewOrder
  closed: 'none' | 'week' | 'all'
  showDrafts: boolean
  includeTeams: boolean
  showSnoozed: boolean
  showCounter: boolean
  properties: ('repository' | 'id' | 'author' | 'checks')[]
  snoozed: Record<string, { until: number; updatedAt?: string }>
  reviewed: Record<string, string[]>
}
export const reviewKey = (ref: ReviewRef) => `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase()
export function parseReviewKey(key: string): ReviewRef | null {
  const match = /^([a-z0-9][a-z0-9_-]{0,38})\/([a-z0-9_.-]{1,100})#([1-9][0-9]{0,14})$/i.exec(key)
  if (!match || match[2] === '.' || match[2] === '..' || Number(match[3]) > 2_147_483_647) return null
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) }
}
export function normalizeReviewPreferences(raw: unknown): ReviewPreferences {
  const p = raw && typeof raw === 'object' ? raw as Partial<ReviewPreferences> : {}
  const snoozed = Object.create(null) as ReviewPreferences['snoozed']
  const reviewed = Object.create(null) as ReviewPreferences['reviewed']
  for (const [key, item] of Object.entries(p.snoozed ?? {}).slice(-500)) {
    if (parseReviewKey(key) && item && Number.isFinite(item.until)) snoozed[key] = { until: item.until, ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}) }
  }
  for (const [key, files] of Object.entries(p.reviewed ?? {}).slice(-100)) {
    if (parseReviewKey(key) && Array.isArray(files)) reviewed[key] = [...new Set(files.filter(f => typeof f === 'string'))].slice(0, 250)
  }
  return {
    grouping: p.grouping === 'repository' || p.grouping === 'author' || p.grouping === 'size' || p.grouping === 'none' ? p.grouping : 'status',
    ordering: p.ordering === 'updated' || p.ordering === 'size' ? p.ordering : 'opened',
    closed: p.closed === 'week' || p.closed === 'all' ? p.closed : 'none',
    showDrafts: p.showDrafts !== false, includeTeams: p.includeTeams === true,
    showSnoozed: p.showSnoozed === true, showCounter: p.showCounter !== false,
    properties: Array.isArray(p.properties) ? [...new Set(p.properties.filter(x => ['repository', 'id', 'author', 'checks'].includes(x)))] : ['repository', 'id', 'author', 'checks'],
    snoozed, reviewed,
  }
}
export const isReviewSnoozed = (item: ReviewItem, prefs: ReviewPreferences, now: number) => {
  const s = prefs.snoozed[reviewKey(item)]
  return !!s && s.until > now && (!s.updatedAt || item.updatedAt === s.updatedAt)
}
export function reviewStatus(item: ReviewItem) {
  if (item.state === 'merged') return 'Merged'
  if (item.state === 'closed') return 'Closed'
  if (item.state === 'draft') return 'Draft'
  if (item.reviewDecision === 'changes_requested') return 'Changes requested'
  if (item.reviewDecision === 'approved') return 'Approved'
  if (item.reviewDecision === 'review_required') return 'Awaiting review'
  return 'Open'
}
export const repoName = (item: ReviewRef) => `${item.owner}/${item.repo}`
export function groupReviews(items: ReviewItem[], prefs: ReviewPreferences, filters: { query: string; repo: string; label: string }, now: number) {
  const query = filters.query.toLowerCase().trim()
  const visible = items.filter(item => {
    if (!prefs.showDrafts && item.state === 'draft') return false
    if ((item.state === 'merged' || item.state === 'closed') && (prefs.closed === 'none' || prefs.closed === 'week' && now - Date.parse(item.updatedAt) > 604_800_000)) return false
    return (prefs.showSnoozed || !isReviewSnoozed(item, prefs, now)) && (!filters.repo || repoName(item) === filters.repo) &&
      (!filters.label || item.labels.includes(filters.label)) && (!query || `${item.title} ${item.author} ${reviewKey(item)} ${item.labels.join(' ')}`.toLowerCase().includes(query))
  })
  const size = (item: ReviewItem) => item.additions + item.deletions
  visible.sort((a, b) => {
    const order = prefs.ordering === 'size' ? size(b) - size(a) : Date.parse(prefs.ordering === 'opened' ? b.createdAt : b.updatedAt) - Date.parse(prefs.ordering === 'opened' ? a.createdAt : a.updatedAt)
    return order || reviewKey(a).localeCompare(reviewKey(b))
  })
  const groups = new Map<string, ReviewItem[]>()
  for (const item of visible) {
    const key = prefs.grouping === 'status' ? reviewStatus(item) : prefs.grouping === 'repository' ? repoName(item) : prefs.grouping === 'author' ? item.author || 'Unknown author' : prefs.grouping === 'size' ? size(item) < 50 ? 'Small' : size(item) < 250 ? 'Medium' : 'Large' : 'Pull requests'
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  const states = ['Awaiting review', 'Changes requested', 'Open', 'Approved', 'Draft', 'Merged', 'Closed']
  return prefs.grouping === 'status' ? [...groups].sort((a, b) => states.indexOf(a[0]) - states.indexOf(b[0])) : [...groups]
}
