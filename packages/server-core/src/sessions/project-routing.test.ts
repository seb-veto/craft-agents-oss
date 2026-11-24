import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProject } from '@craft-agent/shared/projects'
import { loadSession, writeSessionJsonl, getSessionFilePath } from '@craft-agent/shared/sessions'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('first-message project routing in SessionManager', () => {
  let root: string
  let sm: SessionManager
  let events: Array<any>
  let projects: Record<string, string>
  let projectAtAgentSetup: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'chat-project-routing-'))
    sm = new SessionManager()
    events = []
    projects = Object.fromEntries(['Growth', 'Operations', 'Product'].map(name => [name, createProject(root, { name }).id]))
    sm.setEventSink((_channel, _target, event) => events.push(event))
    ;(sm as any).decisionFeatureActive = () => false
    ;(sm as any).startPreTurnDecisions = () => null
    ;(sm as any).getOrCreateAgent = async (managed: any) => {
      projectAtAgentSetup = managed.projectId
      // Stop at the real agent-creation boundary; never launch a provider or use real data.
      throw new Error('test stops before provider initialization')
    }
    projectAtAgentSetup = undefined
  })
  afterEach(async () => {
    for (const id of (sm as any).sessions.keys()) await sm.flushSession(id)
    rmSync(root, { recursive: true, force: true })
  })
  function session(overrides: Record<string, unknown> = {}) {
    const workspace = { id: 'test', slug: 'test', name: 'Test', rootPath: root, createdAt: 1 }
    const managed = createManagedSession({ id: 'route-test', name: 'Routing test', createdAt: 1, ...overrides }, workspace, { messagesLoaded: true, ...overrides })
    ;(sm as any).sessions.set(managed.id, managed)
    return managed
  }
  async function send(managed: ReturnType<typeof session>, text: string, options?: any) {
    await sm.sendMessage(managed.id, text, undefined, undefined, options).catch(() => {})
    await sm.flushSession(managed.id)
  }
  it('routes the first message before model setup, persists it, and emits the existing UI event', async () => {
    const managed = session({ workingDirectory: '/explicit/work', sdkCwd: '/stable/sdk' })
    await send(managed, 'Fix the Craft Agents sidebar')
    expect(managed.projectId).toBe(projects.Operations)
    expect(projectAtAgentSetup).toBe(projects.Operations)
    expect(loadSession(root, managed.id)?.projectId).toBe(projects.Operations)
    expect(events.filter(e => e.type === 'project_id_changed').map(e => e.projectId)).toEqual([projects.Operations])
    expect(managed.workingDirectory).toBe('/explicit/work')
    expect(managed.sdkCwd).toBe('/stable/sdk')
  })
  it('preserves an explicit or inherited project even when the message matches another', async () => {
    const managed = session({ projectId: projects.Product })
    await send(managed, 'SEO marketing campaign')
    expect(managed.projectId).toBe(projects.Product)
    expect(events.some(e => e.type === 'project_id_changed')).toBe(false)
  })
  it('keeps a manual No project selection across persistence and restart, even before the first message', async () => {
    const managed = session()
    await sm.setSessionProjectId(managed.id, null)
    const stored = loadSession(root, managed.id)!
    const { messages: _messages, ...metadata } = stored
    const restarted = createManagedSession(metadata, managed.workspace, { messagesLoaded: true })
    ;(sm as any).sessions.set(managed.id, restarted)
    await send(restarted, 'SEO marketing campaign')
    expect(restarted.projectId).toBeUndefined()
    expect(loadSession(root, restarted.id)?.projectRoutingDisabled).toBe(true)
  })
  it('keeps an older child manually cleared before project override metadata existed', async () => {
    const parent = session({ id: 'route-parent', projectId: projects.Product })
    const child = session({ id: 'route-manual-clear', parentSessionId: parent.id, projectRoutingDisabled: true })
    const follower = session({ id: 'route-follower', parentSessionId: parent.id })
    await sm.setSessionProjectId(parent.id, projects.Growth)
    expect(child.projectId).toBeUndefined()
    expect(follower.projectId).toBe(projects.Growth)

    // A child selected together with its parent is not a manual exception to that parent.
    await sm.setSessionProjectId(parent.id, null, [follower.id])
    await sm.setSessionProjectId(parent.id, projects.Product)
    expect(follower.projectId).toBe(projects.Product)
    expect(child.projectId).toBeUndefined()
    expect(loadSession(root, follower.id)?.projectId).toBe(projects.Product)
    await send(child, 'SEO marketing campaign')
    expect(loadSession(root, child.id)).toMatchObject({ projectRoutingDisabled: true })
  })
  it('leaves old unassigned conversations alone (including after a cold restart)', async () => {
    const managed = session()
    const file = getSessionFilePath(root, managed.id)
    mkdirSync(dirname(file), { recursive: true })
    writeSessionJsonl(file, { id: managed.id, workspaceRootPath: root, createdAt: 1, lastUsedAt: 1,
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 },
      messages: [{ id: 'old', type: 'user', content: 'hello', timestamp: 1 }] })
    managed.messagesLoaded = false
    await send(managed, 'SEO marketing campaign')
    expect(managed.projectId).toBeUndefined()
  })
  it('never changes an established automatic route on later topic changes', async () => {
    const managed = session()
    await send(managed, 'SEO marketing campaign')
    await send(managed, 'Payroll and invoices')
    expect(managed.projectId).toBe(projects.Growth)
    expect(events.filter(e => e.type === 'project_id_changed')).toHaveLength(1)
  })
  it.each([
    { parentSessionId: 'parent' }, { taskSlug: 'task' }, { hidden: true },
    { triggeredBy: { automationId: 'test' } }, { branchFromMessageId: 'source' },
    { isArchived: true }, { systemPromptPreset: 'mini' }, { unattended: true },
  ])('leaves non-interactive and explicitly scoped sessions alone: %j', async overrides => {
    const managed = session(overrides)
    await send(managed, 'SEO marketing campaign')
    expect(managed.projectId).toBeUndefined()
  })
  it('does not classify hidden app-generated messages or slash commands', async () => {
    const managed = session()
    await send(managed, 'SEO marketing campaign', { hidden: true })
    expect(managed.projectId).toBeUndefined()
    // A separate empty session, not a later turn.
    const fresh = session()
    await send(fresh, '/compact SEO marketing campaign')
    expect(fresh.projectId).toBeUndefined()
  })
  it('leaves ambiguous input unassigned', async () => {
    const managed = session()
    await send(managed, 'Can you help?')
    expect(managed.projectId).toBeUndefined()
  })
  it('does not classify a queued message into a running session', async () => {
    const managed = session({ isProcessing: true })
    await send(managed, 'SEO marketing campaign')
    expect(managed.projectId).toBeUndefined()
  })
})
