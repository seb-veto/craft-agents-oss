import type { CreateGoalInput, Goal, GoalState } from '@craft-agent/shared/goals/types'

export const GOAL_GROUPS = ['needsYou', 'needsAttention', 'active', 'closed'] as const
export type GoalGroup = typeof GOAL_GROUPS[number]

export function goalGroup(state: GoalState): GoalGroup {
  if (state === 'waiting_on_user') return 'needsYou'
  if (state === 'blocked' || state === 'paused' || state === 'draft') return 'needsAttention'
  if (state === 'done' || state === 'stopped') return 'closed'
  return 'active'
}

export function filterGoals(goals: Goal[], query: string, assignedOnly: boolean): Goal[] {
  const search = query.trim().toLocaleLowerCase()
  return goals.filter(goal => (!assignedOnly || Boolean(goal.ownerSessionId)) &&
    (!search || `${goal.title}\n${goal.description}\n${goal.criteria.map(c => c.text).join('\n')}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
}

export function verifiedCount(goal: Goal): number {
  return goal.criteria.filter(criterion => criterion.status === 'pass').length
}

/** Keep a late action response from overwriting a newer server event. */
export function mergeGoal(goals: Goal[], incoming: Goal): Goal[] {
  const current = goals.find(goal => goal.id === incoming.id)
  if (current && current.revision > incoming.revision) return goals
  return current ? goals.map(goal => goal.id === incoming.id ? incoming : goal) : [...goals, incoming]
}

export function validGoalInput(input: CreateGoalInput): boolean {
  return Boolean(input.title.trim()) && input.criteria.length >= 1 && input.criteria.length <= 8 &&
    input.criteria.every(criterion => Boolean(criterion.trim()))
}

export function canPause(state: GoalState): boolean {
  return state === 'active' || state === 'waiting_on_user' || state === 'verifying' || state === 'blocked'
}

export function canStop(state: GoalState): boolean {
  return state !== 'done' && state !== 'stopped'
}
