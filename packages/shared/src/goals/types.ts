/** Scheduled owners use only Goal tools/evidence; the independent verifier is always scoped. */
export const GOAL_OWNER_TOOL_ACCESS: 'goal-only' | 'workspace-tools' = 'goal-only'

/** Renderer-safe native Goals contract. Only the host service may mutate persisted state. */
export type GoalState = 'draft' | 'active' | 'waiting_on_user' | 'verifying' | 'done' | 'paused' | 'stopped' | 'blocked'

export interface GoalCaps {
  heartbeatHours: number
  wakesPerDay: number
  sessions: number
}

export interface GoalCriterion {
  id: string
  text: string
  status: 'pending' | 'pass' | 'fail'
  evidence?: string
  note?: string
}

export interface GoalActivity {
  id: string
  at: string
  type: string
  message: string
  sessionId?: string
}

export interface Goal {
  id: string
  slug: string
  title: string
  description: string
  state: GoalState
  revision: number
  createdAt: string
  updatedAt: string
  criteria: GoalCriterion[]
  activity: GoalActivity[]
  ownerSessionId?: string
  verifierSessionId?: string
  question?: { text: string; askedAt: string }
  caps: GoalCaps
  counters: { wakesToday: number; sessions: number; utcDay: string }
  nextWakeAt?: string
  lastCheckedAt?: string
  blockedReason?: string
  folderPath: string
}

export interface CreateGoalInput {
  title: string
  description?: string
  criteria: string[]
  ownerSessionId?: string
}

/** Human controls only. Never expose this union through an agent tool. */
export type GoalUserAction =
  | { type: 'pause' | 'resume' | 'stop' | 'start' | 'verify' | 'wake' }
  | { type: 'answer'; answer: string }
  | { type: 'set_caps'; caps: Partial<GoalCaps> }

export interface GoalCriterionResult {
  id: string
  status: 'pass' | 'fail'
  evidence: string
  note?: string
}

export const DEFAULT_GOAL_CAPS: Readonly<GoalCaps> = Object.freeze({
  heartbeatHours: 4,
  wakesPerDay: 12,
  sessions: 10,
})
