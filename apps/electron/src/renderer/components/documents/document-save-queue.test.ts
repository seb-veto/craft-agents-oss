import { describe, expect, test } from 'bun:test'
import { DocumentSaveQueue } from './document-save-queue'
import type { DocumentUpdateInput, WorkspaceDocument } from '@craft-agent/shared/documents/types'

const original: WorkspaceDocument = { id: 'd', title: 'Plan', content: 'Original', projectId: null, favorite: false, createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z', revision: 1 }
function memoryStore() {
  const values = new Map<string, string>()
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
function saver() {
  let current = { ...original }
  const calls: DocumentUpdateInput[] = []
  return { calls, save: async (patch: DocumentUpdateInput) => { calls.push(patch); const { expectedRevision, ...changes } = patch; expect(expectedRevision).toBe(current.revision); current = { ...current, ...changes, revision: current.revision + 1 }; return current } }
}

describe('document autosave', () => {
  test('coalesces edits and removes recovery only after a successful save', async () => {
    const api = saver(), recovery = memoryStore()
    const queue = new DocumentSaveQueue('w', original, api.save, recovery, 10000)
    queue.update({ content: 'First' }); queue.update({ content: 'Latest', title: 'New title' })
    expect(recovery.values.size).toBe(1)
    await queue.flush()
    expect(api.calls).toHaveLength(1)
    expect(queue.getSnapshot().document.content).toBe('Latest')
    expect(queue.getSnapshot().status).toBe('saved')
    expect(recovery.values.size).toBe(0)
    queue.dispose()
  })
  test('serializes in-flight saves and does not revert a pending title or content', async () => {
    let resolve!: (doc: WorkspaceDocument) => void
    const calls: DocumentUpdateInput[] = []
    const queue = new DocumentSaveQueue('w', original, async patch => {
      calls.push(patch)
      if (calls.length === 1) return await new Promise(r => { resolve = r })
      return { ...original, title: patch.title!, content: 'First edit', revision: 3 }
    }, memoryStore(), 10000)
    queue.update({ content: 'First edit' })
    const first = queue.flush()
    queue.update({ title: 'New title' })
    expect(queue.getSnapshot().document.content).toBe('First edit')
    expect(queue.getSnapshot().document.title).toBe('New title')
    resolve({ ...original, content: 'First edit', revision: 2 })
    await first
    expect(calls).toHaveLength(2)
    expect(calls[1]?.expectedRevision).toBe(2)
    expect(queue.getSnapshot().document.title).toBe('New title')
    expect(queue.getSnapshot().status).toBe('saved')
    queue.dispose()
  })
  test('failed save keeps all edits and can retry without changing revision', async () => {
    let failing = true
    const recovery = memoryStore()
    const queue = new DocumentSaveQueue('w', original, async patch => {
      if (failing) throw new Error('Offline')
      return { ...original, ...patch, revision: 2 }
    }, recovery, 10000)
    queue.update({ content: 'Keep this' }); await queue.flush()
    expect(queue.getSnapshot().status).toBe('error')
    expect(queue.getSnapshot().document.content).toBe('Keep this')
    expect(recovery.values.size).toBe(1)
    failing = false; await queue.retry()
    expect(queue.getSnapshot().status).toBe('saved')
    expect(recovery.values.size).toBe(0)
    queue.dispose()
  })
  test('conflict is sticky even after more typing or retry', async () => {
    let calls = 0
    const queue = new DocumentSaveQueue('w', original, async () => { calls++; throw new Error('DOCUMENT_CONFLICT: changed') }, memoryStore(), 10000)
    queue.update({ content: 'Draft' }); await queue.flush()
    queue.update({ content: 'Draft continued' }); await queue.retry(); await queue.flush()
    expect(calls).toBe(1)
    expect(queue.getSnapshot().document.content).toBe('Draft continued')
    expect(queue.getSnapshot().status).toBe('error')
    queue.dispose()
  })
  test('recovers interrupted draft but refuses to overwrite a newer disk version', async () => {
    const recovery = memoryStore(), api = saver()
    recovery.setItem('craft-document-draft:w:d', JSON.stringify({ title: 'Recovered', content: 'Draft', revision: 1 }))
    const queue = new DocumentSaveQueue('w', { ...original, revision: 2 }, api.save, recovery, 10000)
    expect(queue.getSnapshot().document.content).toBe('Draft')
    expect(queue.getSnapshot().status).toBe('error')
    await queue.flush(); expect(api.calls).toHaveLength(0)
    queue.dispose()
  })
  test('navigation dispose flushes instead of discarding debounce', async () => {
    const api = saver(), queue = new DocumentSaveQueue('w', original, api.save, memoryStore(), 10000)
    queue.update({ content: 'Before navigation' }); queue.dispose(); await queue.flush()
    expect(api.calls).toHaveLength(1)
    expect(queue.getSnapshot().status).toBe('saved')
  })
})
