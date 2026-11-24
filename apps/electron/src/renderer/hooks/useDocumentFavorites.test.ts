import { describe, expect, test } from 'bun:test'
import { selectDocumentFavorites } from './useDocumentFavorites'
import type { WorkspaceDocument } from '@craft-agent/shared/documents/types'
const doc = (id: string, title: string, favorite: boolean, updatedAt = '2026-11-24T00:00:00Z'): WorkspaceDocument => ({ id, title, favorite, updatedAt, createdAt: updatedAt, content: '', projectId: null, revision: 1 })
describe('workspace sidebar favorites', () => {
  test('contains only starred documents with stable alphabetic order', () => {
    const documents = [doc('b', 'Roadmap', true), doc('x', 'Not starred', false), doc('a', 'Architecture', true)]
    expect(selectDocumentFavorites(documents).map(d => d.id)).toEqual(['a', 'b'])
    expect(documents.map(d => d.id)).toEqual(['b', 'x', 'a'])
    expect(selectDocumentFavorites(documents.map(d => ({ ...d, updatedAt: '2026-12-01T00:00:00Z' }))).map(d => d.id)).toEqual(['a', 'b'])
  })
  test('unstarred and deleted documents disappear, renames are reflected', () => {
    expect(selectDocumentFavorites([doc('a', 'Architecture', false)])).toEqual([])
    expect(selectDocumentFavorites([])).toEqual([])
    expect(selectDocumentFavorites([doc('a', 'New title', true)])[0]?.title).toBe('New title')
  })
})
