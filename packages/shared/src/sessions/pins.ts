import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export type SessionPinAction = { type: 'pin'; sessionId: string } | { type: 'unpin'; sessionId: string } | { type: 'move'; sessionId: string; beforeId?: string }
const MAX_PINS = 500
const VALID_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/

function pinsPath(workspaceRootPath: string): string {
  const path = join(workspaceRootPath, 'pinned-sessions.json')
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Pinned sessions file must not be a symbolic link')
  return path
}

export function loadSessionPins(workspaceRootPath: string): string[] {
  const path = pinsPath(workspaceRootPath)
  if (!existsSync(path)) return []
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('ids' in data) || !Array.isArray(data.ids)) throw new Error('Invalid pinned sessions file')
  if (data.ids.length > MAX_PINS || data.ids.some(id => typeof id !== 'string' || !VALID_ID.test(id))) throw new Error('Invalid pinned session IDs')
  return [...new Set(data.ids as string[])]
}

export function applySessionPinAction(ids: readonly string[], action: SessionPinAction): string[] {
  if (!action || !['pin', 'unpin', 'move'].includes(action.type) || typeof action.sessionId !== 'string' || !VALID_ID.test(action.sessionId)) throw new Error('Invalid pin action')
  const rest = ids.filter(id => id !== action.sessionId)
  if (action.type === 'unpin') return rest
  if (action.type === 'pin') {
    if (ids.includes(action.sessionId)) return [...ids]
    if (ids.length >= MAX_PINS) throw new Error(`At most ${MAX_PINS} chats can be pinned`)
    return [...ids, action.sessionId]
  }
  if (!ids.includes(action.sessionId)) throw new Error('Only pinned chats can be reordered')
  if (action.beforeId === action.sessionId) return [...ids]
  if (action.beforeId !== undefined && (typeof action.beforeId !== 'string' || !VALID_ID.test(action.beforeId) || !rest.includes(action.beforeId))) throw new Error('Target chat is not pinned')
  const at = action.beforeId === undefined ? rest.length : rest.indexOf(action.beforeId)
  rest.splice(at, 0, action.sessionId)
  return rest
}

/** Synchronous read/modify/atomic rename: no await loses another window's update. */
export function updateSessionPins(workspaceRootPath: string, action: SessionPinAction): string[] {
  const path = pinsPath(workspaceRootPath)
  const ids = applySessionPinAction(loadSessionPins(workspaceRootPath), action)
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, JSON.stringify({ version: 1, ids }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    renameSync(temp, path)
  } finally {
    if (existsSync(temp)) unlinkSync(temp)
  }
  return ids
}
