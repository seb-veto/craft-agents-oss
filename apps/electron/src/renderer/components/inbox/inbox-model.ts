import type { SessionMeta } from '@/atoms/sessions'

export type InboxKind = 'approval' | 'credential' | 'error' | 'review' | 'plan' | 'response'
export interface InboxEntry {
  session: SessionMeta
  version: string
  kind: InboxKind
  priority: boolean
  unread: boolean
  activityAt: number
}
export interface InboxRecord { version: string; dismissed?: boolean; snoozedUntil?: number }
export interface InboxPreferences {
  records: Record<string, InboxRecord>
  showSnoozed: boolean
  unreadFirst: boolean
  prioritize: boolean
  priorityFilter: 'all' | 'action' | 'flagged'
  badge: 'all' | 'priority' | 'none'
  grouping: 'none' | 'type'
  ordering: 'newest' | 'oldest'
}
export type PendingRequests = ReadonlyMap<string, readonly { requestId: string }[]>

export function buildInboxEntries(sessions: readonly SessionMeta[], permissions: PendingRequests, credentials: PendingRequests): InboxEntry[] {
  const result: InboxEntry[] = []
  for (const session of sessions) {
    if (session.hidden || session.isArchived || session.taskDraft) continue
    const approval = permissions.get(session.id)?.[0]?.requestId
    const credential = credentials.get(session.id)?.[0]?.requestId
    const error = session.lastMessageRole === 'error'
    const review = session.sessionStatus === 'needs-review'
    if (!approval && !credential && !error && !review && !session.hasUnread && !session.lastFinalMessageId) continue
    const activityAt = session.lastMessageAt || session.createdAt || 0
    const kind = approval ? 'approval' : credential ? 'credential' : error ? 'error' : review ? 'review' : session.lastMessageRole === 'plan' ? 'plan' : 'response'
    // Session read state does not change the version. A new reply, error, or pending request does.
    const latest = session.lastFinalMessageId || `activity:${activityAt}`
    const version = approval ? `approval:${approval}` : credential ? `credential:${credential}` : error ? `error:${activityAt}` : review ? `review:${latest}` : `message:${latest}`
    result.push({ session, version, kind, priority: !!(approval || credential || error || review || session.isFlagged), unread: session.hasUnread === true, activityAt })
  }
  return result.sort((a, b) => b.activityAt - a.activityAt || a.session.id.localeCompare(b.session.id)).slice(0, 2000)
}

export function readInboxPreferences(value: unknown): InboxPreferences {
  const v = value && typeof value === 'object' ? value as Partial<InboxPreferences> : {}
  const records: Record<string, InboxRecord> = Object.create(null)
  if (v.records && typeof v.records === 'object' && !Array.isArray(v.records)) {
    for (const [key, item] of Object.entries(v.records).slice(-2000)) {
      if (!item || typeof item.version !== 'string') continue
      records[key] = { version: item.version, dismissed: item.dismissed === true, snoozedUntil: Number.isFinite(item.snoozedUntil) ? item.snoozedUntil : undefined }
    }
  }
  return {
    records, showSnoozed: v.showSnoozed === true, unreadFirst: v.unreadFirst === true, prioritize: v.prioritize !== false,
    priorityFilter: v.priorityFilter === 'action' || v.priorityFilter === 'flagged' ? v.priorityFilter : 'all',
    badge: v.badge === 'priority' || v.badge === 'none' ? v.badge : 'all',
    grouping: v.grouping === 'type' ? 'type' : 'none', ordering: v.ordering === 'oldest' ? 'oldest' : 'newest',
  }
}

const entryRecord = (entry: InboxEntry, prefs: InboxPreferences) => Object.hasOwn(prefs.records, entry.session.id) && prefs.records[entry.session.id]?.version === entry.version ? prefs.records[entry.session.id] : undefined
export const isSnoozed = (entry: InboxEntry, prefs: InboxPreferences, now: number) => (entryRecord(entry, prefs)?.snoozedUntil ?? 0) > now
export const isDismissed = (entry: InboxEntry, prefs: InboxPreferences) => entryRecord(entry, prefs)?.dismissed === true

export function filterInbox(entries: InboxEntry[], prefs: InboxPreferences, now: number) {
  const available = entries.filter(entry => !isDismissed(entry, prefs)).map(entry => prefs.priorityFilter === 'all' ? entry : ({
    ...entry, priority: prefs.priorityFilter === 'flagged' ? entry.session.isFlagged === true : ['approval', 'credential', 'error', 'review'].includes(entry.kind),
  }))
  const active = available.filter(entry => !isSnoozed(entry, prefs, now))
  const visible = prefs.ordering === 'oldest' ? [...(prefs.showSnoozed ? available : active)].reverse() : prefs.showSnoozed ? available : active
  return {
    visible: prefs.unreadFirst ? [...visible].sort((a, b) => Number(b.unread) - Number(a.unread)) : visible,
    unread: active.filter(entry => entry.unread),
    nextWake: Math.min(Infinity, ...available.flatMap(entry => isSnoozed(entry, prefs, now) ? [entryRecord(entry, prefs)!.snoozedUntil!] : [])),
  }
}
