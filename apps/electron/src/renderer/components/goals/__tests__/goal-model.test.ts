import { describe, expect, test } from 'bun:test'
import { type GoalGroup, canPause, canStop, filterGoals, goalGroup, mergeGoal, validGoalInput, verifiedCount } from '../goal-model'
import type { Goal, GoalState } from '@craft-agent/shared/goals/types'

function goal(overrides: Partial<Goal> = {}): Goal {
  return { id: 'g1', slug: 'g1', title: 'Ship native goals', description: 'Persist everything', state: 'active', revision: 1, createdAt: '2026-11-24T15:00:00Z', updatedAt: '2026-11-24T15:00:00Z', criteria: [{ id: 'c1', text: 'Accessible keyboard controls', status: 'pending' }], activity: [], caps: { heartbeatHours: 4, wakesPerDay: 12, sessions: 10 }, counters: { wakesToday: 0, sessions: 0, utcDay: '2026-11-24' }, folderPath: '/test/goals/g1', ...overrides }
}

describe('Goals view model', () => {
  test('groups all server states without treating paused or blocked as closed', () => {
    const groups: Record<GoalState, GoalGroup> = { draft: 'needsAttention', active: 'active', waiting_on_user: 'needsYou', verifying: 'active', done: 'closed', paused: 'needsAttention', stopped: 'closed', blocked: 'needsAttention' }
    for (const [state, group] of Object.entries(groups)) expect(goalGroup(state as GoalState)).toBe(group)
  })
  test('Assigned means owner session, not a pretend user', () => {
    expect(filterGoals([goal(), goal({ id: 'owned', ownerSessionId: 's1' })], '', true).map(g => g.id)).toEqual(['owned'])
  })
  test('searches title, description and criteria case-insensitively', () => {
    for (const query of [' native ', 'PERSIST', 'keyboard']) expect(filterGoals([goal()], query, false)).toHaveLength(1)
    expect(filterGoals([goal()], 'missing', false)).toHaveLength(0)
  })
  test('sorts by recency with stable ID tie breaker', () => {
    expect(filterGoals([goal({ id: 'b' }), goal({ id: 'z', updatedAt: '2026-11-25T00:00:00Z' }), goal({ id: 'a' })], '', false).map(g => g.id)).toEqual(['z', 'a', 'b'])
  })
  test('verified totals come from server passes only', () => {
    expect(verifiedCount(goal({ criteria: [{ id: 'a', text: 'a', status: 'pass' }, { id: 'b', text: 'b', status: 'fail' }, { id: 'c', text: 'c', status: 'pending' }] }))).toBe(1)
  })
  test('late responses cannot overwrite newer revisions', () => {
    const current = [goal({ revision: 4 })]
    expect(mergeGoal(current, goal({ revision: 3 }))).toBe(current)
    expect(mergeGoal(current, goal({ revision: 5, state: 'paused' }))[0]?.state).toBe('paused')
    expect(mergeGoal(current, goal({ id: 'new' }))).toHaveLength(2)
  })
  test('requires title and 1–8 nonblank criteria', () => {
    expect(validGoalInput({ title: ' x ', criteria: [' y '] })).toBe(true)
    expect(validGoalInput({ title: 'x', criteria: Array(8).fill('y') })).toBe(true)
    for (const input of [{ title: ' ', criteria: ['y'] }, { title: 'x', criteria: [] }, { title: 'x', criteria: [' '] }, { title: 'x', criteria: Array(9).fill('y') }]) expect(validGoalInput(input)).toBe(false)
  })
  test('never offers pause or stop on server-verified done goals', () => {
    expect(canPause('done')).toBe(false)
    expect(canStop('done')).toBe(false)
    expect(canStop('stopped')).toBe(false)
    expect(canPause('waiting_on_user')).toBe(true)
    expect(canPause('blocked')).toBe(true)
    expect(canPause('draft')).toBe(false)
  })
})
