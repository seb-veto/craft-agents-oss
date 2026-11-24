import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDocument, deleteDocument, getDocument, listDocuments, updateDocument } from './storage.ts'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'craft-documents-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('workspace documents', () => {
  test('empty workspace creates nothing on read', () => { expect(listDocuments(root)).toEqual([]) })
  test('create/read/update survives a fresh disk read and preserves markdown/images', () => {
    const doc = createDocument(root, { title: 'Architecture', content: '# System\n\n![diagram](data:image/png;base64,YQ==)' })
    expect(getDocument(root, doc.id)).toEqual(doc)
    const updated = updateDocument(root, doc.id, { expectedRevision: 1, content: '**Updated**\n\n- [ ] Verify', favorite: true })
    expect(updated.revision).toBe(2)
    expect(updated.createdAt).toBe(doc.createdAt)
    expect(getDocument(root, doc.id)?.content).toBe('**Updated**\n\n- [ ] Verify')
    expect(listDocuments(root)).toEqual([updated])
    expect(JSON.parse(readFileSync(join(root, 'documents', `${doc.id}.json`), 'utf8'))).toEqual(updated)
  })
  test('optimistic conflicts never overwrite the newer version', () => {
    const doc = createDocument(root)
    updateDocument(root, doc.id, { expectedRevision: 1, content: 'newer' })
    expect(() => updateDocument(root, doc.id, { expectedRevision: 1, content: 'stale' })).toThrow('DOCUMENT_CONFLICT')
    expect(getDocument(root, doc.id)?.content).toBe('newer')
  })
  test('workspace isolation and delete', () => {
    const doc = createDocument(root)
    const other = join(root, 'other'); mkdirSync(other)
    expect(getDocument(other, doc.id)).toBeNull()
    deleteDocument(root, doc.id)
    expect(getDocument(root, doc.id)).toBeNull()
    expect(listDocuments(root)).toEqual([])
  })
  test('normalizes empty titles and rejects invalid/oversized input', () => {
    expect(createDocument(root, { title: '   ' }).title).toBe('Untitled')
    expect(() => createDocument(root, { title: 'x'.repeat(501) })).toThrow()
    expect(() => createDocument(root, { content: 'x'.repeat(10 * 1024 * 1024 + 1) })).toThrow()
    const doc = createDocument(root)
    expect(() => updateDocument(root, doc.id, { expectedRevision: 0 })).toThrow()
    expect(() => updateDocument(root, doc.id, { expectedRevision: 1, id: '../escape' } as never)).toThrow()
  })
  test('rejects traversal on every record operation', () => {
    for (const id of ['../outside', '/tmp/escape', '..', 'bad']) {
      expect(() => getDocument(root, id)).toThrow('Invalid document ID')
      expect(() => updateDocument(root, id, { expectedRevision: 1 })).toThrow()
      expect(() => deleteDocument(root, id)).toThrow('Invalid document ID')
    }
  })
  test('rejects symlink directory and symlink records', () => {
    const outside = join(root, 'outside'); mkdirSync(outside)
    symlinkSync(outside, join(root, 'documents'))
    expect(() => createDocument(root)).toThrow('real directory')
    rmSync(join(root, 'documents'))
    const doc = createDocument(root)
    const record = join(root, 'documents', `${doc.id}.json`)
    rmSync(record)
    const other = join(outside, 'other.json'); writeFileSync(other, JSON.stringify(doc))
    symlinkSync(other, record)
    expect(() => getDocument(root, doc.id)).toThrow('symbolic link')
    expect(() => deleteDocument(root, doc.id)).toThrow('symbolic link')
    expect(readFileSync(other, 'utf8')).toContain(doc.id)
  })
  test('corrupt files surface an error instead of silently losing documents', () => {
    const doc = createDocument(root)
    writeFileSync(join(root, 'documents', `${doc.id}.json`), 'invalid')
    expect(() => listDocuments(root)).toThrow()
  })
})
