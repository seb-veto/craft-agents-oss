import type { SessionMeta } from '../atoms/sessions'

/** Compatible with Linear's priority values and the existing numeric Priority label. */
export const SESSION_PRIORITIES = [
  { value: 1, key: 'urgent', label: 'Urgent' },
  { value: 2, key: 'high', label: 'High' },
  { value: 3, key: 'medium', label: 'Medium' },
  { value: 4, key: 'low', label: 'Low' },
  { value: 0, key: 'triage', label: 'Triage' },
] as const

export type SessionPriority = typeof SESSION_PRIORITIES[number]

export function getSessionPriority(item: Pick<SessionMeta, 'labels'>): SessionPriority {
  // Deterministic for legacy sessions carrying multiple values: highest priority wins.
  const values = new Set((item.labels ?? []).filter(entry => entry.startsWith('priority::')).map(entry => entry.slice('priority::'.length)))
  return SESSION_PRIORITIES.find(priority => values.has(String(priority.value))) ?? SESSION_PRIORITIES[4]
}

/** A family follows its root; pin order comes from the separate workspace pin list. */
export function getPriorityGroupKey(item: Pick<SessionMeta, 'labels' | 'pinOrder'>): string {
  return item.pinOrder !== undefined ? 'pinned' : `priority-${getSessionPriority(item).key}`
}

export function withSessionPriority(labels: readonly string[] | undefined, value: number): string[] {
  const otherLabels = (labels ?? []).filter(entry => entry !== 'priority' && !entry.startsWith('priority::'))
  return value === 0 ? otherLabels : [...otherLabels, `priority::${value}`]
}
