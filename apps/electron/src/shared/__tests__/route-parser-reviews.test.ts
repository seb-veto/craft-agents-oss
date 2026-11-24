import { expect, test } from 'bun:test'
import { routes } from '../routes'
import { buildRouteFromNavigationState, parseRouteToNavigationState } from '../route-parser'
import { isDetailNavState } from '../../renderer/lib/nav-helpers'

test('Reviews list and encoded pull request survive route round trips', () => {
  for (const id of [undefined, 'owner/repo#42']) {
    const route = routes.view.reviews(id)
    const state = parseRouteToNavigationState(route)
    expect(state).toEqual({ navigator: 'reviews', details: id ? { type: 'review', reviewId: id } : null })
    expect(isDetailNavState(state)).toBe(true)
    expect(buildRouteFromNavigationState(state!)).toBe(route)
  }
  expect(parseRouteToNavigationState('reviews/review/%')).toBeNull()
  expect(parseRouteToNavigationState('reviews/other')).toBeNull()
})
