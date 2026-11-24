import { z } from 'zod';
import type { GoalToolCallbacks, GoalToolSnapshot, SessionToolContext } from '../context.ts';
import { errorResponse, successResponse } from '../response.ts';
import type { ToolResult } from '../types.ts';

const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/);
const filename = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  .describe('Current goal revision from goal_get. Re-read after a revision conflict.');
const message = (limit: number) => z.string().trim().min(1).max(limit).refine(text => !text.includes('\0'));
const goalId = id.describe('Goal ID from the host message. The calling session must be assigned to this goal.');
const mutation = { goalId, revision };

export const GoalGetSchema = z.object({ goalId }).strict();
export const GoalProgressSchema = z.object({ ...mutation, message: message(20000) }).strict();
export const GoalAskSchema = z.object({ ...mutation, question: message(20000) }).strict();
export const GoalEvidenceSchema = z.object({
  ...mutation,
  filename: filename.describe('A new basename, e.g. check.md. No directories, overwrites, or source paths.'),
  content: z.string().min(1).max(1024 * 1024).refine(text => !!text.trim() && Buffer.byteLength(text) <= 1024 * 1024),
}).strict();
export const GoalRequestVerificationSchema = z.object(mutation).strict();
export const GoalVerdictSchema = z.object({
  ...mutation,
  results: z.array(z.object({
    id: id.describe('Stable criterion ID from goal_get.'),
    status: z.enum(['pass', 'fail']),
    evidence: z.string().regex(/^evidence\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
      .describe('Existing immutable evidence path returned by goal_evidence.'),
    note: message(10000).optional(),
  }).strict()).min(1).max(8).refine(results => new Set(results.map(result => result.id)).size === results.length)
    .describe('One result per criterion, including failures. No duplicates.'),
  message: message(20000).describe('Summary of what was independently verified.'),
}).strict();

function snapshot(goal: GoalToolSnapshot) {
  const { id, title, description, state, revision, criteria, folderPath, question, blockedReason } = goal;
  // Do not serialize the host aggregate, activity history, or session identities.
  return { id, title, description, state, revision, folderPath, question, blockedReason,
    criteria: criteria.map(({ id, text, status, evidence, note }) => ({ id, text, status, evidence, note })),
  };
}

function summary(goal: GoalToolSnapshot) {
  return { id: goal.id, state: goal.state, revision: goal.revision, blockedReason: goal.blockedReason };
}

/** Validate here too: some backends execute the registry without running the Zod object parser. */
function handler<Schema extends z.ZodTypeAny>(schema: Schema, invoke: (goals: GoalToolCallbacks, args: z.output<Schema>) => unknown) {
  return async (ctx: SessionToolContext, args: unknown): Promise<ToolResult> => {
    if (!ctx.goals) return errorResponse('Goals tools are unavailable: this session has no assigned goal role.');
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map(issue => issue.path[0] ?? 'input'))];
      return errorResponse(`Invalid goal tool input (${fields.join(', ')}). Check the tool schema.`);
    }
    try {
      return successResponse(JSON.stringify(await invoke(ctx.goals, parsed.data)));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Goal revision conflict')) {
        return errorResponse('Goal revision conflict. Call goal_get to refresh; retry only if the action is still appropriate.');
      }
      return errorResponse('Goal action rejected. Check the assigned role, current state, criteria, and evidence with goal_get.');
    }
  };
}

export const handleGoalGet = handler(GoalGetSchema, async (goals, { goalId }) => snapshot(await goals.get(goalId)));
export const handleGoalProgress = handler(GoalProgressSchema, async (goals, { goalId, revision, message }) =>
  summary(await goals.progress(goalId, revision, message)));
export const handleGoalAsk = handler(GoalAskSchema, async (goals, { goalId, revision, question }) =>
  summary(await goals.ask(goalId, revision, question)));
export const handleGoalEvidence = handler(GoalEvidenceSchema, async (goals, { goalId, revision, filename, content }) =>
  ({ evidence: await goals.evidence(goalId, revision, filename, content) }));
export const handleGoalRequestVerification = handler(GoalRequestVerificationSchema, async (goals, { goalId, revision }) =>
  summary(await goals.requestVerification(goalId, revision)));
export const handleGoalVerdict = handler(GoalVerdictSchema, async (goals, { goalId, revision, results, message }) =>
  summary(await goals.verdict(goalId, revision, results, message)));
