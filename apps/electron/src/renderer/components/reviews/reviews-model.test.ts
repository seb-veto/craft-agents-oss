import { describe, expect, test } from 'bun:test'
import type { ReviewItem } from '@craft-agent/shared/protocol'
import { groupReviews, isReviewSnoozed, normalizeReviewPreferences, parseReviewKey, reviewKey } from './reviews-model'
const now = Date.parse('2026-11-24T16:00:00.000Z')
const date = '2026-11-24T12:00:00.000Z'
const item = (number: number, fields: Partial<ReviewItem> = {}): ReviewItem => ({
  owner: 'owner', repo: 'repo', number, title: `Patch ${number}`, url: `https://github.com/owner/repo/pull/${number}`, author: 'dev', state: 'open', createdAt: date, updatedAt: date,
  additions: 10, deletions: 3, changedFiles: 2, checks: 'success', reviewDecision: 'review_required', labels: [], headRef: 'feature', baseRef: 'main', ...fields,
})
const noFilters = { query: '', repo: '', label: '' }
const defaults = normalizeReviewPreferences(null)
describe('Reviews queue', () => {
  test('only canonical GitHub PR coordinates are parsed', () => {
    expect(parseReviewKey(reviewKey(item(42, { owner: 'Org', repo: 'Repo' })))).toEqual({ owner: 'org', repo: 'repo', number: 42 })
    for (const key of ['https://host/owner/repo#1', '../repo#1', 'owner/../repo#1', 'owner/..#1', 'owner/repo#0', 'owner/repo#999999999999999999']) expect(parseReviewKey(key)).toBeNull()
  })
  test('groups actionable states ahead of finished states and hides closed by default', () => {
    const reviews = [item(1, { state: 'closed' }), item(2, { state: 'draft' }), item(3), item(4, { state: 'merged' })]
    expect(groupReviews(reviews, defaults, noFilters, now).map(([group]) => group)).toEqual(['Awaiting review', 'Draft'])
    expect(groupReviews(reviews, { ...defaults, closed: 'all' }, noFilters, now).map(([group]) => group)).toEqual(['Awaiting review', 'Draft', 'Merged', 'Closed'])
  })
  test('applies title, repository and label filters', () => {
    const reviews = [item(1, { title: 'Fix layout', labels: ['ui'] }), item(2, { repo: 'api', labels: ['ui'] }), item(3)]
    const grouped = groupReviews(reviews, defaults, { query: 'LAYOUT', repo: 'owner/repo', label: 'ui' }, now)
    expect(grouped[0]?.[1].map(x => x.number)).toEqual([1])
  })
  test('supports sort by size and hides drafts', () => {
    const reviews = [item(1), item(2, { additions: 100 }), item(3, { state: 'draft', additions: 400 })]
    expect(groupReviews(reviews, { ...defaults, ordering: 'size', showDrafts: false }, noFilters, now)[0]?.[1].map(x => x.number)).toEqual([2, 1])
  })
  test('snooze expires on time or new activity for update-based snoozes', () => {
    const review = item(2)
    const prefs = normalizeReviewPreferences({ snoozed: { [reviewKey(review)]: { until: now + 100, updatedAt: review.updatedAt } } })
    expect(isReviewSnoozed(review, prefs, now)).toBe(true)
    expect(groupReviews([review], prefs, noFilters, now)).toEqual([])
    expect(isReviewSnoozed(review, prefs, now + 100)).toBe(false)
    expect(isReviewSnoozed({ ...review, updatedAt: '2026-11-24T16:01:00.000Z' }, prefs, now)).toBe(false)
  })
})
