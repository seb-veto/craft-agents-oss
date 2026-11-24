import { describe, expect, test } from 'bun:test'
import { routes } from '../routes'
import { buildCompoundRoute, buildRouteFromNavigationState, isCompoundRoute, parseCompoundRoute, parseRoute, parseRouteToNavigationState } from '../route-parser'
import { isGoalsNavigation, type NavigationState } from '../navigation-types'
import { isDetailNavState } from '../../renderer/lib/nav-helpers'
import { normalizePanelRouteForReconcile } from '../../renderer/contexts/navigation-reconcile'

describe('Goals navigation', () => {
  test('library is a full-width content destination, never a session fallback', () => {
    expect(routes.view.goals()).toBe('goals')
    expect(isCompoundRoute('goals')).toBe(true)
    const state = parseRouteToNavigationState('goals')
    expect(state).toEqual({ navigator: 'goals', details: null })
    expect(state && isGoalsNavigation(state)).toBe(true)
    expect(isDetailNavState(state)).toBe(true)
    expect(parseRoute('goals')).toEqual({ type: 'view', name: 'goals', params: {} })
  })

  for (const id of ['goal-1', 'spaces & symbols/#?', '日本語']) {
    test(`detail roundtrip: ${id}`, () => {
      const route = routes.view.goals(id)
      const state: NavigationState = { navigator: 'goals', details: { type: 'goal', goalId: id } }
      expect(parseCompoundRoute(route)).toEqual({ navigator: 'goals', details: { type: 'goal', id } })
      expect(parseRouteToNavigationState(route)).toEqual(state)
      expect(buildRouteFromNavigationState(state)).toBe(route)
      expect(buildCompoundRoute({ navigator: 'goals', details: { type: 'goal', id } })).toBe(route)
      expect(parseRoute(route)).toEqual({ type: 'view', name: 'goal-info', id, params: {} })
      expect(isDetailNavState(state)).toBe(true)
    })
  }

  test('preserves sidebar options and query isolation', () => {
    expect(parseRouteToNavigationState('goals/goal/abc?x=y', 'files/evidence')).toEqual({ navigator: 'goals', details: { type: 'goal', goalId: 'abc' }, rightSidebar: { type: 'files', path: 'evidence' } })
  })

  test('invalid routes do not silently turn into the library', () => {
    for (const route of ['goals/other', 'goals/goal', 'goals/goal/x/extra', 'goals/goal/%', 'goals/goal/%20']) {
      expect(parseCompoundRoute(route)).toBeNull()
      expect(parseRouteToNavigationState(route)).toBeNull()
    }
  })

  test('library and detail survive panel reconciliation without auto-selection', () => {
    for (const route of [routes.view.goals(), routes.view.goals('x')]) {
      expect(normalizePanelRouteForReconcile(route, state => state)).toBe(route)
    }
  })

  test('existing destination roundtrips remain unchanged', () => {
    for (const route of ['allSessions', 'allSessions/session/x', 'flagged/session/x', 'archived', 'state/todo/session/x', 'label/a%2Fb/session/x', 'view/triage', 'sources/mcp/source/x', 'skills/skill/x', 'automations/event/automation/x', 'projects/project/x', 'pages/page/x', 'settings', 'settings/shortcuts', 'board']) {
      const state = parseRouteToNavigationState(route)
      expect(state).not.toBeNull()
      expect(buildRouteFromNavigationState(state!)).toBe(route)
    }
  })
})
