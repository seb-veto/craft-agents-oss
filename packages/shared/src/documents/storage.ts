import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { atomicWriteFileSync } from '../utils/files.ts'
import type { WorkspaceDocument, DocumentCreateInput, DocumentUpdateInput } from './types.ts'

const title = z.string().trim().max(500).transform(value => value || 'Untitled')
const content = z.string().max(10 * 1024 * 1024)
const projectId = z.string().max(200).nullable()
const createSchema = z.object({ title: title.optional(), content: content.optional(), projectId: projectId.optional() }).strict()
const updateSchema = z.object({
  expectedRevision: z.number().int().positive(), title: title.optional(), content: content.optional(),
  projectId: projectId.optional(), favorite: z.boolean().optional(),
}).strict()
const documentSchema = z.object({
  id: z.string().uuid(), title, content, projectId, favorite: z.boolean(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), revision: z.number().int().positive(),
})

function directory(root: string): string {
  const path = join(root, 'documents')
  // A configured workspace is trusted; its documents child and records may not redirect I/O.
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) {
    throw new Error('Documents directory must be a real directory')
  }
  return path
}

function recordPath(root: string, id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new Error('Invalid document ID')
  const path = join(directory(root), `${id}.json`)
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Document must not be a symbolic link')
  return path
}

export function getDocument(root: string, id: string): WorkspaceDocument | null {
  const path = recordPath(root, id)
  try {
    const result = documentSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    if (result.id !== id) throw new Error('Document ID does not match its filename')
    return result
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function listDocuments(root: string): WorkspaceDocument[] {
  const dir = directory(root)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => /^[0-9a-f-]{36}\.json$/i.test(name))
    .map(name => getDocument(root, name.slice(0, -5)))
    .filter((doc): doc is WorkspaceDocument => doc !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
}

export function createDocument(root: string, input: DocumentCreateInput = {}): WorkspaceDocument {
  const parsed = createSchema.parse(input)
  const now = new Date().toISOString()
  const doc: WorkspaceDocument = {
    id: randomUUID(), title: parsed.title ?? 'Untitled', content: parsed.content ?? '',
    projectId: parsed.projectId ?? null, favorite: false, createdAt: now, updatedAt: now, revision: 1,
  }
  mkdirSync(directory(root), { recursive: true })
  atomicWriteFileSync(recordPath(root, doc.id), JSON.stringify(doc, null, 2))
  return doc
}

/** Synchronous read/check/write in the single workspace RPC host, without an async interleave. */
export function updateDocument(root: string, id: string, input: DocumentUpdateInput): WorkspaceDocument {
  const { expectedRevision, ...patch } = updateSchema.parse(input)
  const current = getDocument(root, id)
  if (!current) throw new Error('Document not found')
  if (current.revision !== expectedRevision) throw new Error('DOCUMENT_CONFLICT: This document changed elsewhere. Your draft is preserved; reopen to compare.')
  const doc = documentSchema.parse({ ...current, ...patch, revision: current.revision + 1, updatedAt: new Date().toISOString() })
  atomicWriteFileSync(recordPath(root, id), JSON.stringify(doc, null, 2))
  return doc
}

export function deleteDocument(root: string, id: string): void {
  const path = recordPath(root, id)
  if (existsSync(path)) unlinkSync(path)
}
