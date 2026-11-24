import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionMeta } from '@/atoms/sessions'
import * as storage from '@/lib/local-storage'
import { buildInboxEntries, filterInbox, readInboxPreferences, type InboxEntry, type InboxPreferences, type PendingRequests } from './inbox-model'

export function useWorkspaceInbox(workspaceId: string | null | undefined, sessions: SessionMeta[], permissions: PendingRequests, credentials: PendingRequests) {
  const [override, setOverride] = useState<{ workspaceId: string; preferences: InboxPreferences } | null>(null)
  const [clock, setClock] = useState(Date.now)
  const saved = useMemo(() => readInboxPreferences(workspaceId && storage.get<unknown>(storage.KEYS.inboxPreferences, null, workspaceId)), [workspaceId])
  const preferences = override && override.workspaceId === workspaceId ? override.preferences : saved
  const entries = useMemo(() => workspaceId ? buildInboxEntries(sessions, permissions, credentials) : [], [workspaceId, sessions, permissions, credentials])
  const { visible, unread, nextWake, now } = useMemo(() => {
    const now = Math.max(clock, Date.now())
    return { ...filterInbox(entries, preferences, now), now }
  }, [entries, preferences, clock])
  useEffect(() => {
    if (!Number.isFinite(nextWake)) return
    const timer = setTimeout(() => setClock(Date.now()), Math.min(2 ** 31 - 1, Math.max(1, nextWake - Date.now())))
    return () => clearTimeout(timer)
  }, [nextWake])

  const update = useCallback((change: (previous: InboxPreferences) => InboxPreferences) => {
    if (!workspaceId) return
    // Read the latest value for successive actions and separate open windows.
    const latest = readInboxPreferences(storage.get<unknown>(storage.KEYS.inboxPreferences, null, workspaceId))
    const preferences = readInboxPreferences(change(latest))
    storage.set(storage.KEYS.inboxPreferences, preferences, workspaceId)
    setOverride({ workspaceId, preferences })
  }, [workspaceId])
  const setOptions = useCallback((options: Partial<Omit<InboxPreferences, 'records'>>) => update(previous => ({ ...previous, ...options })), [update])
  const dismiss = useCallback((targets: InboxEntry[]) => update(previous => ({ ...previous, records: { ...previous.records,
    ...Object.fromEntries(targets.map(entry => [entry.session.id, {
      version: entry.version, dismissed: true,
      snoozedUntil: previous.records[entry.session.id]?.version === entry.version ? previous.records[entry.session.id]?.snoozedUntil : undefined,
    }])) } })), [update])
  const restore = useCallback((targets: InboxEntry[]) => update(previous => {
    const records = { ...previous.records }
    for (const entry of targets) {
      const record = records[entry.session.id]
      if (record?.version === entry.version && record.dismissed) records[entry.session.id] = { ...record, dismissed: false }
    }
    return { ...previous, records }
  }), [update])
  const snooze = useCallback((entry: InboxEntry, until?: number) => update(previous => ({ ...previous, records: { ...previous.records,
    [entry.session.id]: { version: entry.version, snoozedUntil: until } } })), [update])
  return useMemo(() => ({ visible, unread, preferences, now, setOptions, dismiss, restore, snooze }),
    [visible, unread, preferences, now, setOptions, dismiss, restore, snooze])
}
export type WorkspaceInbox = ReturnType<typeof useWorkspaceInbox>
