import { describe, expect, test } from 'bun:test'
import { routes } from '../routes'
import { buildCompoundRoute, buildRouteFromNavigationState, isCompoundRoute, parseCompoundRoute, parseRoute, parseRouteToNavigationState } from '../route-parser'
import { isDocumentsNavigation } from '../navigation-types'
import { isDetailNavState } from '../../renderer/lib/nav-helpers'

describe('Documents navigation', () => {
  test('library and encoded detail roundtrip without selecting a session', () => {
    for (const id of [undefined, 'doc-1', 'spaces / & # 日本語']) {
      const route = routes.view.documents(id)
      const state = parseRouteToNavigationState(route)
      expect(isCompoundRoute(route)).toBe(true)
      expect(state).toEqual({ navigator: 'documents', details: id ? { type: 'document', documentId: id } : null })
      expect(isDocumentsNavigation(state!)).toBe(true)
      expect(isDetailNavState(state)).toBe(true)
      expect(buildRouteFromNavigationState(state!)).toBe(route)
      expect(buildCompoundRoute(parseCompoundRoute(route)!)).toBe(route)
    }
  })
  test('view route conversion', () => {
    expect(parseRoute('documents')).toEqual({ type: 'view', name: 'documents', params: {} })
    expect(parseRoute('documents/document/a')).toEqual({ type: 'view', name: 'document-info', id: 'a', params: {} })
  })
  test('rejects malformed and malformed encoded paths', () => {
    for (const route of ['documents/unknown', 'documents/document', 'documents/document/x/extra', 'documents/document/%', 'documents/document/%20']) expect(parseRouteToNavigationState(route)).toBeNull()
  })
})
