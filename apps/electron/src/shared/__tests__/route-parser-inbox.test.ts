import { describe, expect, test } from 'bun:test'
import { routes } from '../routes'
import { buildRouteFromNavigationState, parseRouteToNavigationState, parseRoute } from '../route-parser'
import { isDetailNavState } from '../../renderer/lib/nav-helpers'
import { normalizePanelRouteForReconcile } from '../../renderer/contexts/navigation-reconcile'

describe('Inbox navigation', () => {
  test('default Inbox is a full-width native view, not All Sessions', () => {
    const route = routes.view.inbox()
    const state = parseRouteToNavigationState(route)
    expect(state).toEqual({ navigator: 'inbox', details: null })
    expect(isDetailNavState(state)).toBe(true)
    expect(normalizePanelRouteForReconcile(route, s => s)).toBe('inbox')
  })
  test('encoded session round-trips and preserves inbox detail on reload', () => {
    const id = 'id /# 日本語'
    const route = routes.view.inbox(id)
    const state = parseRouteToNavigationState(route)
    expect(state).toEqual({ navigator: 'inbox', details: { type: 'inbox-session', sessionId: id } })
    expect(buildRouteFromNavigationState(state!)).toBe(route)
    expect(parseRoute(route)).toMatchObject({ type: 'view', name: 'inbox-session', id })
    expect(normalizePanelRouteForReconcile(route, () => { throw new Error('must not auto-select') })).toBe(route)
  })
  test('rejects broken Inbox deep links', () => {
    for (const invalid of ['inbox/fake/123', 'inbox/session', 'inbox/session/%', 'inbox/session/%20', 'inbox/session/x/extra']) expect(parseRouteToNavigationState(invalid)).toBeNull()
  })
})
