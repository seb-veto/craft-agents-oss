import { describe, expect, test } from 'bun:test'
import { moveSidebarItem, normalizeSidebarLayout, partitionSidebarLayout, WORKSPACE_SIDEBAR_IDS } from './sidebar-layout'

describe('workspace sidebar customization', () => {
  test('old workspaces preserve the current order and visibility', () => {
    expect(partitionSidebarLayout(normalizeSidebarLayout(null))).toEqual({ visible: [...WORKSPACE_SIDEBAR_IDS], more: [] })
  })
  test('keeps saved order, ignores stale or core ids and appends new entries', () => {
    const layout = normalizeSidebarLayout({ order: ['nav:documents', 'nav:documents', 'nav:settings', 'removed', 'nav:favorites'], hidden: ['nav:goals', 'nav:goals', 'nav:allSessions'] })
    expect(layout.order.slice(0, 2)).toEqual(['nav:documents', 'nav:favorites'])
    expect(layout.order).toHaveLength(WORKSPACE_SIDEBAR_IDS.length)
    expect(layout.hidden).toEqual(['nav:goals'])
    expect(partitionSidebarLayout(layout).visible).toContain('nav:pages')
  })
  test('More retains hidden destinations and their customized order even when all are hidden', () => {
    const layout = normalizeSidebarLayout({ order: ['nav:goals', 'nav:favorites'], hidden: WORKSPACE_SIDEBAR_IDS })
    const result = partitionSidebarLayout(layout)
    expect(result.visible).toEqual([])
    expect(result.more.slice(0, 2)).toEqual(['nav:goals', 'nav:favorites'])
    expect(result.more).toHaveLength(WORKSPACE_SIDEBAR_IDS.length)
  })
  test('accessible move changes exactly one position without mutating the original order', () => {
    const { order } = normalizeSidebarLayout(null)
    const changed = moveSidebarItem(order, 'nav:documents', -1)
    expect(changed.slice(-2)).toEqual(['nav:documents', 'nav:goals'])
    expect(order.at(-1)).toBe('nav:documents')
    expect(moveSidebarItem(order, 'nav:documents', 1)).toBe(order)
    expect(moveSidebarItem(order, 'nav:favorites', -1)).toBe(order)
  })
  test('round-trips JSON and treats invalid preference data as default', () => {
    const layout = normalizeSidebarLayout({ order: ['nav:documents'], hidden: ['nav:pages'] })
    expect(normalizeSidebarLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
    expect(normalizeSidebarLayout({ order: false, hidden: 'nav:pages' })).toEqual(normalizeSidebarLayout(null))
  })
})
