import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySessionPinAction, loadSessionPins, updateSessionPins } from '../pins'

const dirs: string[] = []
function workspace() { const dir = mkdtempSync(join(tmpdir(), 'craft-pin-test-')); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('ordered chat pins', () => {
  it('pins at the end, preserves existing order and is idempotent', () => {
    expect(applySessionPinAction(['a', 'b'], { type: 'pin', sessionId: 'c' })).toEqual(['a', 'b', 'c'])
    expect(applySessionPinAction(['a', 'b'], { type: 'pin', sessionId: 'a' })).toEqual(['a', 'b'])
  })
  it('supports up/down and drag-before ordering, including move to end', () => {
    const ids = ['a', 'b', 'c']
    expect(applySessionPinAction(ids, { type: 'move', sessionId: 'c', beforeId: 'a' })).toEqual(['c', 'a', 'b'])
    expect(applySessionPinAction(ids, { type: 'move', sessionId: 'a', beforeId: 'c' })).toEqual(['b', 'a', 'c'])
    expect(applySessionPinAction(ids, { type: 'move', sessionId: 'b' })).toEqual(['a', 'c', 'b'])
    expect(applySessionPinAction(ids, { type: 'move', sessionId: 'a', beforeId: 'a' })).toEqual(ids)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
  it('unpins without changing the relative order of other pins', () => {
    expect(applySessionPinAction(['a', 'b', 'c'], { type: 'unpin', sessionId: 'b' })).toEqual(['a', 'c'])
  })
  it('rejects invalid operations and paths', () => {
    expect(() => applySessionPinAction([], { type: 'pin', sessionId: '../bad' })).toThrow()
    expect(() => applySessionPinAction([], { type: 'move', sessionId: 'a' })).toThrow('Only pinned')
    expect(() => applySessionPinAction(['a'], { type: 'move', sessionId: 'a', beforeId: 'missing' })).toThrow('not pinned')
  })
  it('persists and reloads manual order without using session flags', () => {
    const dir = workspace()
    expect(loadSessionPins(dir)).toEqual([])
    updateSessionPins(dir, { type: 'pin', sessionId: 'factory-a' })
    updateSessionPins(dir, { type: 'pin', sessionId: 'factory-b' })
    updateSessionPins(dir, { type: 'move', sessionId: 'factory-b', beforeId: 'factory-a' })
    expect(loadSessionPins(dir)).toEqual(['factory-b', 'factory-a'])
    expect(JSON.parse(readFileSync(join(dir, 'pinned-sessions.json'), 'utf8'))).toEqual({ version: 1, ids: ['factory-b', 'factory-a'] })
  })
  it('does not silently reset a corrupted store', () => {
    const dir = workspace()
    writeFileSync(join(dir, 'pinned-sessions.json'), 'corrupt')
    expect(() => updateSessionPins(dir, { type: 'pin', sessionId: 'a' })).toThrow()
    expect(readFileSync(join(dir, 'pinned-sessions.json'), 'utf8')).toBe('corrupt')
  })
  it('rejects symlinked stores', () => {
    const dir = workspace()
    const target = join(dir, 'target')
    writeFileSync(target, '{"version":1,"ids":[]}')
    symlinkSync(target, join(dir, 'pinned-sessions.json'))
    expect(() => loadSessionPins(dir)).toThrow('symbolic link')
  })
  it('caps pin count', () => {
    expect(() => applySessionPinAction(Array.from({ length: 500 }, (_, i) => `s-${i}`), { type: 'pin', sessionId: 'overflow' })).toThrow('500')
  })
})
