import { z } from 'zod'
import type { Goal } from './types'

export const goalIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/)
export const sessionIdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/)
const text = (max: number) => z.string().trim().min(1).max(max).refine(v => !v.includes('\0'), 'NUL is not allowed')
export const goalMessageSchema = text(20000)
const timestamp = z.string().datetime()
export const evidencePathSchema = z.string().regex(/^evidence\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
export const capsSchema = z.object({
  heartbeatHours: z.number().finite().min(0.25).max(168),
  wakesPerDay: z.number().int().min(1).max(1000),
  sessions: z.number().int().min(1).max(1000),
}).strict()
export const createGoalSchema = z.object({
  title: text(240),
  description: z.string().max(20000).refine(v => !v.includes('\0')).optional(),
  criteria: z.array(text(2000)).min(1).max(8),
  ownerSessionId: sessionIdSchema.optional(),
}).strict()
export const userActionSchema = z.union([
  z.object({ type: z.enum(['pause', 'resume', 'stop', 'start', 'verify', 'wake']) }).strict(),
  z.object({ type: z.literal('answer'), answer: text(20000) }).strict(),
  z.object({ type: z.literal('set_caps'), caps: capsSchema.partial().refine(v => Object.keys(v).length > 0) }).strict(),
])
export const criterionResultSchema = z.object({
  id: goalIdSchema,
  status: z.enum(['pass', 'fail']),
  evidence: evidencePathSchema,
  note: text(10000).optional(),
}).strict()
export const criterionResultsSchema = z.array(criterionResultSchema).min(1).max(8)
export const goalSchema = z.object({
  id: goalIdSchema,
  slug: goalIdSchema,
  title: text(240),
  description: z.string().max(20000),
  state: z.enum(['draft', 'active', 'waiting_on_user', 'verifying', 'done', 'paused', 'stopped', 'blocked']),
  revision: z.number().int().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
  criteria: z.array(z.object({
    id: goalIdSchema,
    text: text(2000),
    status: z.enum(['pending', 'pass', 'fail']),
    evidence: evidencePathSchema.optional(),
    note: text(10000).optional(),
  }).strict()).min(1).max(8),
  activity: z.array(z.object({
    id: goalIdSchema,
    at: timestamp,
    type: text(80),
    message: text(20000),
    sessionId: sessionIdSchema.optional(),
  }).strict()).min(1),
  ownerSessionId: sessionIdSchema.optional(),
  verifierSessionId: sessionIdSchema.optional(),
  question: z.object({ text: text(20000), askedAt: timestamp }).strict().optional(),
  caps: capsSchema,
  counters: z.object({
    wakesToday: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    utcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict(),
  nextWakeAt: timestamp.optional(),
  lastCheckedAt: timestamp.optional(),
  blockedReason: text(20000).optional(),
  folderPath: z.string().min(1),
}).strict().superRefine((goal, ctx) => {
  if (goal.ownerSessionId && goal.ownerSessionId === goal.verifierSessionId) {
    ctx.addIssue({ code: 'custom', message: 'Owner and verifier must be different sessions' })
  }
  if (new Set(goal.criteria.map(c => c.id)).size !== goal.criteria.length) {
    ctx.addIssue({ code: 'custom', message: 'Criterion IDs must be unique' })
  }
  if (goal.state === 'active' && !goal.ownerSessionId) {
    ctx.addIssue({ code: 'custom', message: 'Active goals require an owner session' })
  }
  if (goal.state === 'verifying' && (!goal.ownerSessionId || !goal.verifierSessionId)) {
    ctx.addIssue({ code: 'custom', message: 'Verification requires owner and independent verifier sessions' })
  }
  if (goal.state === 'waiting_on_user' && (!goal.ownerSessionId || !goal.question)) {
    ctx.addIssue({ code: 'custom', message: 'Waiting goals require an owner and question' })
  }
  if (new Set(goal.activity.map(a => a.id)).size !== goal.activity.length) {
    ctx.addIssue({ code: 'custom', message: 'Activity IDs must be unique' })
  }
  if (goal.state === 'done' && (!goal.ownerSessionId || !goal.verifierSessionId || goal.criteria.some(c => c.status !== 'pass' || !c.evidence))) {
    ctx.addIssue({ code: 'custom', message: 'Done requires independent verification and evidence for every criterion' })
  }
})

export function validateGoal(value: unknown): Goal {
  return goalSchema.parse(value)
}
