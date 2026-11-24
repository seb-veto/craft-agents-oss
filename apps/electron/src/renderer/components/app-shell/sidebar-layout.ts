/** Only workspace destinations are configurable. Core navigation is outside this list. */
export const WORKSPACE_SIDEBAR_IDS = [
  'nav:favorites', 'nav:sources', 'nav:skills', 'nav:projects', 'nav:pages',
  'nav:automations', 'nav:goals', 'nav:documents',
] as const
export type WorkspaceSidebarId = typeof WORKSPACE_SIDEBAR_IDS[number]
export interface SidebarLayout {
  order: WorkspaceSidebarId[]
  hidden: WorkspaceSidebarId[]
}

const known = new Set<string>(WORKSPACE_SIDEBAR_IDS)
function ids(value: unknown): WorkspaceSidebarId[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is WorkspaceSidebarId => typeof id === 'string' && known.has(id)))]
    : []
}

/** Ignore stale IDs and append new product entries visibly by default. */
export function normalizeSidebarLayout(value: unknown): SidebarLayout {
  const stored = value && typeof value === 'object' ? value as Partial<SidebarLayout> : {}
  const order = ids(stored.order)
  return { order: [...order, ...WORKSPACE_SIDEBAR_IDS.filter(id => !order.includes(id))], hidden: ids(stored.hidden) }
}

export function partitionSidebarLayout(layout: SidebarLayout) {
  const hidden = new Set(layout.hidden)
  return { visible: layout.order.filter(id => !hidden.has(id)), more: layout.order.filter(id => hidden.has(id)) }
}

export function moveSidebarItem(order: WorkspaceSidebarId[], id: WorkspaceSidebarId, direction: -1 | 1) {
  const current = order.indexOf(id)
  const target = current + direction
  if (current < 0 || target < 0 || target >= order.length) return order
  const next = [...order]
  next.splice(target, 0, ...next.splice(current, 1))
  return next
}
