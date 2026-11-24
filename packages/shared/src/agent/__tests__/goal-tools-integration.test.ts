import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { GoalToolCallbacks } from '@craft-agent/session-tools-core'
import { goalToolDenial } from '../goal-tool-policy.ts'
import { getSessionScopedTools } from '../session-scoped-tools.ts'
import { getSessionToolProxyDefs } from '../backend/pi/session-tool-defs.ts'
import { PiAgent } from '../pi-agent.ts'
import { mergeSessionScopedToolCallbacks, unregisterSessionScopedToolCallbacks } from '../session-scoped-tool-callback-registry.ts'
import { attachSessionSelfManagementBindings } from '../session-self-management-bindings.ts'
import { modeManager, setPermissionMode, shouldAllowToolInMode } from '../mode-manager.ts'

const sessionId = 'goals-tool-registration-test'
const root = import.meta.dir
const goal = { id: 'goal-fixture', title: 'Fixture', description: '', state: 'active' as const, revision: 1,
  criteria: [{ id: 'criterion-1', text: 'Check', status: 'pending' as const }], folderPath: root }
const owner = ['goal_ask', 'goal_evidence', 'goal_get', 'goal_progress', 'goal_request_verification']
const verifier = ['goal_evidence', 'goal_get', 'goal_verdict']
let mutations = 0
const mutate = () => { mutations++; return goal }
const callbacks: GoalToolCallbacks = {
  get: () => goal, progress: mutate, ask: mutate, evidence: () => { mutate(); return 'evidence/test.md' },
  requestVerification: mutate, verdict: mutate,
}
afterEach(() => { unregisterSessionScopedToolCallbacks(sessionId); modeManager.cleanupSession(sessionId); mutations = 0 })

async function claudeClient() {
  const server = getSessionScopedTools(sessionId, root, undefined, { profile: 'coding' })
  const client = new Client({ name: 'goals-registration', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.instance.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}
const goalNames = (names: string[]) => names.map(name => name.replace(/^mcp__session__/, '')).filter(name => name.startsWith('goal_')).sort()

function piExecutor() {
  const ctx = {} as Parameters<typeof attachSessionSelfManagementBindings>[0]
  attachSessionSelfManagementBindings(ctx, sessionId)
  const pi = Object.create(PiAgent.prototype) as {
    _sessionId: string; _sessionToolContext: unknown;
    executeSessionTool: (name: string, args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>;
  }
  pi._sessionId = sessionId
  pi._sessionToolContext = ctx
  return pi
}

describe('live Goal session tool catalogs, no provider request', () => {
  test('Claude SDK server and Pi proxy select the live role and invalidate stale Claude catalog keys', async () => {
    for (const [role, expected] of [[undefined, []], ['owner', owner], ['verifier', verifier], [undefined, []]] as const) {
      mergeSessionScopedToolCallbacks(sessionId, { goalRole: role, goals: role ? callbacks : undefined })
      const claude = await claudeClient()
      try {
        expect(goalNames((await claude.listTools()).tools.map(t => t.name))).toEqual([...expected])
        expect(goalNames(getSessionToolProxyDefs({ profile: 'coding' }, sessionId).map(t => t.name))).toEqual([...expected])
      } finally { await claude.close() }
    }
  })

  test('both execution adapters reject mutations in Explore and permit assigned reads', async () => {
    mergeSessionScopedToolCallbacks(sessionId, { goalRole: 'owner', goals: callbacks, goalReadFolders: [root] })
    setPermissionMode(sessionId, 'safe')
    const claude = await claudeClient()
    const pi = piExecutor()
    const base = { goalId: goal.id, revision: goal.revision }
    try {
      expect((await claude.callTool({ name: 'goal_get', arguments: { goalId: goal.id } })).isError).toBeUndefined()
      expect((await pi.executeSessionTool('goal_get', { goalId: goal.id })).isError).toBe(false)
      for (const [name, params] of [
        ['goal_progress', { ...base, message: 'progress' }],
        ['goal_ask', { ...base, question: 'question' }],
        ['goal_evidence', { ...base, filename: 'test.md', content: 'output' }],
        ['goal_request_verification', base],
      ] as const) {
        expect((await claude.callTool({ name, arguments: params })).isError).toBe(true)
        expect((await pi.executeSessionTool(name, params)).isError).toBe(true)
        expect(shouldAllowToolInMode(`mcp__session__${name}`, params, 'safe').allowed).toBe(false)
      }
      expect(shouldAllowToolInMode('mcp__session__goal_get', base, 'safe').allowed).toBe(true)
      expect(mutations).toBe(0)
    } finally { await claude.close() }

    mergeSessionScopedToolCallbacks(sessionId, { goalRole: 'verifier' })
    const independent = await claudeClient()
    const verdict = { ...base, message: 'Checked', results: [{ id: 'criterion-1', status: 'pass', evidence: 'evidence/test.md' }] }
    try {
      expect((await independent.callTool({ name: 'goal_verdict', arguments: verdict })).isError).toBe(true)
      expect((await pi.executeSessionTool('goal_verdict', verdict)).isError).toBe(true)
      expect(shouldAllowToolInMode('mcp__session__goal_verdict', verdict, 'safe').allowed).toBe(false)
      expect(mutations).toBe(0)
      setPermissionMode(sessionId, 'allow-all')
      expect((await pi.executeSessionTool('goal_verdict', verdict)).isError).toBe(false)
      expect(mutations).toBe(1)
      // Even a stale provider server cannot call a goal tool after its role is revoked.
      mergeSessionScopedToolCallbacks(sessionId, { goalRole: undefined, goals: undefined })
      expect((await independent.callTool({ name: 'goal_verdict', arguments: verdict })).isError).toBe(true)
      expect((await pi.executeSessionTool('goal_verdict', verdict)).isError).toBe(true)
      expect(mutations).toBe(1)
    } finally { await independent.close() }
  })
})


test('assigned sessions cannot read other files or launch work outside the Goal budget', () => {
  const fixture = mkdtempSync(join(realpathSync(tmpdir()), 'veto-goal-tool-policy-'))
  try {
    const folder = join(fixture, 'goal')
    const evidence = join(folder, 'evidence')
    mkdirSync(evidence, { recursive: true })
    const report = join(folder, 'GOAL.md')
    const outside = join(fixture, 'unrelated.txt')
    const link = join(evidence, 'link.md')
    writeFileSync(report, 'Goal fixture')
    writeFileSync(outside, 'Unrelated generated fixture')
    symlinkSync(outside, link)
    mergeSessionScopedToolCallbacks(sessionId, { goalRole: 'owner', goals: callbacks, goalReadFolders: [folder] })
    setPermissionMode(sessionId, 'allow-all')
    expect(goalToolDenial(sessionId, 'goal_progress')).toBeUndefined()
    expect(goalToolDenial(sessionId, 'goal_verdict')).toContain('not assigned')
    expect(goalToolDenial(sessionId, 'Read', { file_path: report })).toBeUndefined()
    expect(goalToolDenial(sessionId, 'Glob', { path: evidence, pattern: '*.md' })).toBeUndefined()
    for (const [name, args] of [
      ['Read', { file_path: outside }], ['read', { path: link }],
      ['Read', { file_path: report, path: outside }], ['Glob', { path: evidence, pattern: '../*' }],
      ['Bash', { command: 'echo fixture' }], ['Agent', {}], ['mcp__session__spawn_session', {}], ['mcp__session__call_llm', {}],
    ]) expect(goalToolDenial(sessionId, name as string, args)).toContain('Goal sessions only allow')
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
