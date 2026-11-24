import { describe, expect, it } from 'bun:test'
import { getSessionPriority, getPriorityGroupKey, withSessionPriority } from '../session-priority'
import { getSessionAttention } from '../session-attention'
import { buildSessionFamilies } from '../session-tree'
import { computeCollapsedPagination, paginateFamilies } from '../../hooks/useSessionSearch'
import { buildCollapsedGroupsScopeSuffix } from '../session-list-collapse'
import type { SessionMeta } from '../../atoms/sessions'

const session = (id: string, options: Partial<SessionMeta> = {}): SessionMeta => ({ id, workspaceId: 'test', ...options })

describe('factory queue priorities', () => {
  it('resolves all numeric priorities and puts unassigned/invalid values in triage', () => {
    for (const [value, key] of [[1, 'urgent'], [2, 'high'], [3, 'medium'], [4, 'low'], [0, 'triage']] as const) {
      expect(getSessionPriority({ labels: [`priority::${value}`] }).key).toBe(key)
    }
    for (const labels of [undefined, [], ['priority'], ['priority::NaN'], ['priority::5'], ['priority::1.5'], ['other::1']]) {
      expect(getSessionPriority({ labels }).key).toBe('triage')
    }
  })
  it('resolves duplicate legacy values deterministically', () => {
    expect(getSessionPriority({ labels: ['priority::4', 'priority::1', 'priority::2'] }).key).toBe('urgent')
  })
  it('pins factories independently of flags and priority', () => {
    expect(getPriorityGroupKey({ pinOrder: 0, labels: ['priority::4'] })).toBe('pinned')
    expect(getPriorityGroupKey({ labels: ['priority::1'] })).toBe('priority-urgent')
  })
  it('replaces only priority values, preserves other labels and clears on triage', () => {
    const original = ['task-foo', 'priority::1', 'priority::2', 'linear::ABC-1']
    expect(withSessionPriority(original, 3)).toEqual(['task-foo', 'linear::ABC-1', 'priority::3'])
    expect(withSessionPriority(original, 0)).toEqual(['task-foo', 'linear::ABC-1'])
    expect(original).toHaveLength(4)
  })
  it('shows old urgent and pinned sessions even beyond the global recent window', () => {
    const items = [session('new-low', { labels: ['priority::4'] }), session('low-2', { labels: ['priority::4'] }), session('old-urgent', { labels: ['priority::1'] }), session('factory', { pinOrder: 0 })]
    const page = computeCollapsedPagination(items, 1, undefined, 'priority')
    expect(page.paginatedItems.map(item => item.id)).toEqual(['new-low', 'old-urgent', 'factory'])
    expect(page.hasMore).toBe(true)
  })
  it('collapses priority groups without consuming other groups pagination', () => {
    const page = computeCollapsedPagination([session('urgent', { labels: ['priority::1'] }), session('factory', { pinOrder: 0 })], 1, new Set(['priority-urgent']), 'priority')
    expect(page.paginatedItems.map(item => item.id)).toEqual(['factory'])
    expect(page.collapsedGroupsMeta).toEqual([{ key: 'priority-urgent', count: 1 }])
  })
  it('keeps an entire child family in the root priority/pinned group', () => {
    const families = buildSessionFamilies([session('child', { parentSessionId: 'factory', labels: ['priority::1'], lastMessageAt: 5 }), session('factory', { pinOrder: 0 }), session('other')])
    const page = paginateFamilies(families, 1, undefined, 'priority', new Set())
    expect(page.rows.map(row => [row.item.id, getPriorityGroupKey(row.groupItem)])).toEqual([['factory', 'pinned'], ['child', 'pinned'], ['other', 'priority-triage']])
  })
  it('promotes an explicitly pinned child to its own family without duplication', () => {
    const families = buildSessionFamilies([session('root'), session('child', { parentSessionId: 'root', pinOrder: 0 }), session('grandchild', { parentSessionId: 'child' })])
    const page = paginateFamilies(families, 50, undefined, 'priority', new Set())
    expect(page.rows.map(row => [row.item.id, row.depth, getPriorityGroupKey(row.groupItem)])).toEqual([['root', 0, 'priority-triage'], ['child', 0, 'pinned'], ['grandchild', 1, 'pinned']])
  })
  it('keeps pins in a separate pagination bucket in every grouping mode', () => {
    for (const mode of ['date', 'status', 'unread', 'project', 'priority'] as const) {
      const page = computeCollapsedPagination([session('new'), session('new2'), session('factory', { pinOrder: 0 })], 1, undefined, mode)
      expect(page.paginatedItems.map(item => item.id)).toEqual(['new', 'factory'])
    }
  })
  it('scopes priority collapse persistence away from date and other workspaces', () => {
    const scope = buildCollapsedGroupsScopeSuffix({ workspaceId: 'test', groupingMode: 'priority' })
    expect(scope).not.toBe(buildCollapsedGroupsScopeSuffix({ workspaceId: 'test', groupingMode: 'date' }))
    expect(scope).not.toBe(buildCollapsedGroupsScopeSuffix({ workspaceId: 'other', groupingMode: 'priority' }))
  })
})

describe('live attention, not workflow completion', () => {
  it('gives pending prompts precedence over processing', () => {
    expect(getSessionAttention({ isProcessing: true }, true)).toBe('needs-you')
    expect(getSessionAttention({ isProcessing: true, lastMessageRole: 'error' })).toBe('running')
  })
  it('distinguishes failure, plan, unread result, and idle', () => {
    expect(getSessionAttention({ lastMessageRole: 'error' })).toBe('failed')
    expect(getSessionAttention({ lastMessageRole: 'plan' })).toBe('plan-ready')
    expect(getSessionAttention({ lastMessageRole: 'assistant', hasUnread: true })).toBe('result-ready')
    expect(getSessionAttention({ lastMessageRole: 'assistant', hasUnread: false })).toBe('idle')
    expect(getSessionAttention({ lastMessageRole: 'user', hasUnread: true })).toBe('idle')
  })
  it('does not modify a sessions workflow status', () => {
    const item = session('result', { sessionStatus: 'todo', hasUnread: true, lastMessageRole: 'assistant' })
    expect(getSessionAttention(item)).toBe('result-ready')
    expect(item.sessionStatus).toBe('todo')
  })
})
