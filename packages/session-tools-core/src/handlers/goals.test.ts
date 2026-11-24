import { describe, expect, test } from 'bun:test';
import type { GoalToolCallbacks, GoalToolSnapshot, SessionToolContext } from '../context.ts';
import { getSessionSafeAllowedToolNames, getSessionToolDefs, getToolDefsAsJsonSchema, SESSION_TOOL_REGISTRY } from '../tool-defs.ts';
import {
  handleGoalAsk, handleGoalEvidence, handleGoalGet, handleGoalProgress, handleGoalRequestVerification, handleGoalVerdict,
} from './goals.ts';

const input = { goalId: 'goal-test', revision: 2 };
const snapshot: GoalToolSnapshot = {
  id: input.goalId, title: 'Check fixture', description: 'Use generated data', state: 'active', revision: input.revision,
  criteria: [{ id: 'criterion-1', text: 'Test passes', status: 'pending' }], folderPath: '/fake/goals/goal-test',
};
const ownerTools = ['goal_get', 'goal_progress', 'goal_ask', 'goal_evidence', 'goal_request_verification'];
const verifierTools = ['goal_get', 'goal_evidence', 'goal_verdict'];
const ctx = (goals?: Partial<GoalToolCallbacks>) => ({ sessionId: 'host-bound-session', goals } as SessionToolContext);
const result = (status: 'pass' | 'fail' = 'pass') => ({ id: 'criterion-1', status, evidence: 'evidence/test.md' });

describe('Goals session registry visibility', () => {
  for (const profile of ['default', 'coding'] as const) {
    test(`filters assigned roles in ${profile} profile`, () => {
      const goalNames = (role?: 'owner' | 'verifier') => getSessionToolDefs({ profile, goalRole: role })
        .filter(def => def.name.startsWith('goal_')).map(def => def.name);
      expect(goalNames()).toEqual([]);
      expect(goalNames('owner')).toEqual(ownerTools);
      expect(goalNames('verifier')).toEqual(verifierTools);
    });
  }

  test('advertises exactly role-bounded strict schemas for Pi', () => {
    const tools = getToolDefsAsJsonSchema({ prefix: 'mcp__session__', goalRole: 'verifier' })
      .filter(def => def.name.startsWith('mcp__session__goal_'));
    expect(tools.map(def => def.name)).toEqual(verifierTools.map(name => `mcp__session__${name}`));
    expect(tools.every(def => def.inputSchema.additionalProperties === false)).toBe(true);
    const schema = tools.at(-1)!.inputSchema;
    expect(schema.required).toEqual(['goalId', 'revision', 'results', 'message']);
    expect(JSON.stringify(schema)).not.toMatch(/sessionId|workspaceId|set_caps/);
  });

  test('Explore exposes read only in the safe allowlist, not mutations or verification dispatch', () => {
    for (const goalRole of ['owner', 'verifier'] as const) {
      const allowed = [...getSessionSafeAllowedToolNames({ goalRole })].filter(name => name.startsWith('goal_'));
      expect(allowed).toEqual(['goal_get']);
    }
    expect(SESSION_TOOL_REGISTRY.get('goal_get')?.readOnly).toBe(true);
    expect(SESSION_TOOL_REGISTRY.get('goal_request_verification')?.safeMode).toBe('block');
  });
});

describe('actor-bound Goals session handlers', () => {
  test('reads only bounded actor fields and does not expose activity or actor identity', async () => {
    const response = await handleGoalGet(ctx({ get: id => {
      expect(id).toBe('goal-test');
      return { ...snapshot, ownerSessionId: 'internal-id', activity: [{ message: 'unbounded history' }] };
    } }), { goalId: input.goalId });
    expect(response.isError).toBe(false);
    expect(JSON.parse(response.content[0]!.text)).toEqual(snapshot);
  });

  test('routes typed inputs only to injected callbacks, with current revisions and no actor selector', async () => {
    const calls: unknown[][] = [];
    const host = ctx({
      progress: (...args) => { calls.push(args); return { ...snapshot, revision: 3 }; },
      ask: (...args) => { calls.push(args); return { ...snapshot, state: 'waiting_on_user' }; },
      evidence: (...args) => { calls.push(args); return 'evidence/test.md'; },
      requestVerification: async (...args) => { calls.push(args); return { ...snapshot, state: 'verifying' }; },
      verdict: (...args) => { calls.push(args); return { ...snapshot, state: 'done' }; },
    });
    expect(JSON.parse((await handleGoalProgress(host, { ...input, message: ' Checked ' })).content[0]!.text)).toEqual({ id: input.goalId, state: 'active', revision: 3 });
    expect(JSON.parse((await handleGoalAsk(host, { ...input, question: 'What input?' })).content[0]!.text).state).toBe('waiting_on_user');
    expect(JSON.parse((await handleGoalEvidence(host, { ...input, filename: 'test.md', content: 'Actual test' })).content[0]!.text)).toEqual({ evidence: 'evidence/test.md' });
    expect(JSON.parse((await handleGoalRequestVerification(host, input)).content[0]!.text).state).toBe('verifying');
    expect(JSON.parse((await handleGoalVerdict(host, { ...input, results: [result()], message: 'Checked fixture' })).content[0]!.text).state).toBe('done');
    expect(calls).toEqual([
      ['goal-test', 2, 'Checked'], ['goal-test', 2, 'What input?'], ['goal-test', 2, 'test.md', 'Actual test'],
      ['goal-test', 2], ['goal-test', 2, [result()], 'Checked fixture'],
    ]);
  });

  test('fails closed without an assigned callback and on authorization failures', async () => {
    for (const [name, args] of [
      ['goal_get', { goalId: input.goalId }], ['goal_progress', { ...input, message: 'Checked' }],
      ['goal_ask', { ...input, question: 'What next?' }], ['goal_evidence', { ...input, filename: 'test.md', content: 'Checked' }],
      ['goal_request_verification', input], ['goal_verdict', { ...input, results: [result()], message: 'Checked' }],
    ] as const) {
      const result = await SESSION_TOOL_REGISTRY.get(name)!.handler!(ctx(), args);
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('no assigned goal role');
    }
    const denial = await handleGoalVerdict(ctx({ verdict: () => { throw new Error('untrusted runtime text'); } }),
      { ...input, results: [result()], message: 'Forged verdict' });
    expect(denial.isError).toBe(true);
    expect(denial.content[0]!.text).not.toContain('untrusted runtime text');
  });

  test('rejects invalid revisions, impersonation, paths, evidence sizes and verdicts before callbacks', async () => {
    let calls = 0;
    const sideEffect = () => { calls++; return snapshot; };
    const host = ctx({ progress: sideEffect, ask: sideEffect, evidence: () => { calls++; return 'evidence/test.md'; }, verdict: sideEffect });
    const attempts = [
      handleGoalProgress(host, { ...input, sessionId: 'spoofed-verifier', message: 'Checked' }),
      handleGoalProgress(host, { ...input, revision: Number.MAX_SAFE_INTEGER + 1, message: 'Checked' }),
      handleGoalProgress(host, { ...input, goalId: '../other', message: 'Checked' }),
      handleGoalAsk(host, { ...input, question: '   ' }),
      handleGoalAsk(host, { ...input, question: 'a'.repeat(20001) }),
      handleGoalEvidence(host, { ...input, filename: '../test.md', content: 'Checked' }),
      handleGoalEvidence(host, { ...input, filename: 'test.md', sourcePath: '/unrelated', content: 'Checked' }),
      handleGoalEvidence(host, { ...input, filename: 'test.md', content: '😀'.repeat(300000) }),
      handleGoalVerdict(host, { ...input, results: [result(), result()], message: 'duplicate' }),
      handleGoalVerdict(host, { ...input, results: [{ ...result(), evidence: 'evidence/../outside' }], message: 'escape' }),
      handleGoalVerdict(host, { ...input, results: [{ ...result(), status: 'pending' }], message: 'Not a verdict' }),
    ];
    expect((await Promise.all(attempts)).every(response => response.isError)).toBe(true);
    expect(calls).toBe(0);
  });

  test('stale revisions give a refresh hint without retrying an effect', async () => {
    let changes = 0;
    const response = await handleGoalProgress(ctx({ progress: () => {
      changes++;
      throw new Error('Goal revision conflict; reload before retrying');
    } }), { ...input, message: 'old revision' });
    expect(changes).toBe(1);
    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain('Call goal_get to refresh');
  });
});
