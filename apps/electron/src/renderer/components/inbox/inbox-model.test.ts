import { describe, expect, test } from 'bun:test'
import type { SessionMeta } from '@/atoms/sessions'
import { buildInboxEntries, filterInbox, readInboxPreferences } from './inbox-model'
const now = 1_000_000
const session = (id: string, data: Partial<SessionMeta> = {}): SessionMeta => ({ id, workspaceId: 'qa', lastMessageAt: now - 50, ...data })
const none = new Map()
const defaultPrefs = readInboxPreferences(null)

describe('Inbox activity model', () => {
  test('uses real activity, not session creation or processing, and excludes archived or hidden items', () => {
    const result = buildInboxEntries([
      session('new'), session('working', { isProcessing: true }), session('read', { lastFinalMessageId: 'm1' }),
      session('hidden', { hasUnread: true, hidden: true }), session('archived', { isArchived: true, hasUnread: true }),
      session('draft', { taskDraft: true, hasUnread: true }), session('unread', { hasUnread: true }),
    ], none, none)
    expect(result.map(item => [item.session.id, item.unread])).toEqual([['read', false], ['unread', true]])
  })
  test('distinguishes approvals, sign-ins, review and errors without inflating urgency for ordinary replies', () => {
    const sessions = ['approval', 'credential', 'error', 'review', 'reply', 'flag'].map(id => session(id, {
      lastMessageRole: id === 'error' ? 'error' : 'assistant', sessionStatus: id === 'review' ? 'needs-review' : undefined, lastFinalMessageId: 'm1', isFlagged: id === 'flag',
    }))
    const entries = buildInboxEntries(sessions, new Map([['approval', [{ requestId: 'p1' }]]]), new Map([['credential', [{ requestId: 'c1' }]]]))
    expect(entries.filter(e => e.priority).map(e => e.session.id)).toEqual(['approval', 'credential', 'error', 'flag', 'review'])
    expect(entries.find(e => e.session.id === 'approval')?.version).toBe('approval:p1')
    expect(entries.find(e => e.session.id === 'reply')?.kind).toBe('response')
  })
  test('dismissal hides only one notification version, not its session or next reply', () => {
    const meta = session('s', { hasUnread: true, lastFinalMessageId: 'a' })
    const entries = buildInboxEntries([meta], none, none)
    const prefs = readInboxPreferences({ records: { s: { version: entries[0]!.version, dismissed: true } } })
    expect(filterInbox(entries, prefs, now).visible).toEqual([])
    expect(filterInbox(entries, prefs, now).unread).toEqual([])
    const next = buildInboxEntries([{ ...meta, lastFinalMessageId: 'b' }], none, none)
    expect(filterInbox(next, prefs, now).unread).toHaveLength(1)
  })
  test('snooze returns at the deadline; show snoozed does not inflate unread badge', () => {
    const entries = buildInboxEntries([session('s', { hasUnread: true, lastFinalMessageId: 'm' })], none, none)
    const prefs = readInboxPreferences({ records: { s: { version: entries[0]!.version, snoozedUntil: now + 300 } } })
    expect(filterInbox(entries, prefs, now)).toEqual({ visible: [], unread: [], nextWake: now + 300 })
    expect(filterInbox(entries, { ...prefs, showSnoozed: true }, now).visible).toEqual(entries)
    expect(filterInbox(entries, { ...prefs, showSnoozed: true }, now).unread).toEqual([])
    expect(filterInbox(entries, prefs, now + 300).unread).toEqual(entries)
  })
  test('unread-first preserves activity order within unread and read groups', () => {
    const entries = buildInboxEntries([
      session('recent-read', { lastFinalMessageId: 'm' }), session('earlier-unread', { lastMessageAt: now - 200, hasUnread: true }),
      session('newer-unread', { lastMessageAt: now - 150, hasUnread: true }),
    ], none, none)
    expect(filterInbox(entries, { ...defaultPrefs, unreadFirst: true }, now).visible.map(e => e.session.id)).toEqual(['newer-unread', 'earlier-unread', 'recent-read'])
  })
  test('priority filters reclassify only supported notification types and oldest-first preserves chronology', () => {
    const entries = buildInboxEntries([
      session('flagged', { isFlagged: true, lastFinalMessageId: 'm1', lastMessageAt: now - 5 }),
      session('review', { sessionStatus: 'needs-review', lastMessageAt: now - 50 }),
      session('reply', { lastFinalMessageId: 'm2', lastMessageAt: now - 500 }),
    ], none, none)
    const action = filterInbox(entries, { ...defaultPrefs, priorityFilter: 'action', ordering: 'oldest' }, now)
    expect(action.visible.map(e => [e.session.id, e.priority])).toEqual([['reply', false], ['review', true], ['flagged', false]])
    expect(filterInbox(entries, { ...defaultPrefs, priorityFilter: 'flagged' }, now).visible.filter(e => e.priority).map(e => e.session.id)).toEqual(['flagged'])
  })
  test('invalid persisted settings are safe defaults and records round-trip', () => {
    const invalid = readInboxPreferences({ prioritize: 'false', unreadFirst: 1, showSnoozed: [], records: { nope: null } })
    expect(invalid).toEqual(defaultPrefs)
    const prefs = readInboxPreferences({ showSnoozed: true, records: { s: { version: 'message:m', dismissed: true } } })
    expect(readInboxPreferences(JSON.parse(JSON.stringify(prefs)))).toEqual(prefs)
  })
})
