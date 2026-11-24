import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { registerGoalsHandlers, HANDLED_CHANNELS } from '../handlers/rpc/goals'
import { getGoalService } from './service'
import type { HandlerFn, RequestContext, RpcServer } from '../transport/types'
import type { HandlerDeps } from '../handlers/handler-deps'

let root: string
let handlers: Map<string, HandlerFn>
let pushes: unknown[][]
let dispose: () => void
const ctx: RequestContext = { clientId: 'renderer', workspaceId: 'workspace-a', webContentsId: 1 }
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'craft-goal-rpc-test-'))
  handlers = new Map()
  pushes = []
  const server: RpcServer = {
    handle: (channel, handler) => { handlers.set(channel, handler) },
    push: (...args) => { pushes.push(args) },
    invokeClient: async () => undefined,
    hasClientCapability: () => false,
    findClientsWithCapability: () => [],
  }
  // No real workspace/config lookup or changes to the running application's workspace.
  const deps = { sessionManager: { getSessions: (id: string) => id === 'workspace-a' ? [{ id: 'existing-owner' }] : [] } } as unknown as HandlerDeps
  dispose = registerGoalsHandlers(server, deps, id =>
    id === 'workspace-a' || id === 'friendly-name' ? { id: 'workspace-a', rootPath: root } : null)
})
afterEach(() => { dispose(); rmSync(root, { recursive: true, force: true }) })
const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(ctx, ...args))

test('only four human request channels are registered; no agent identity/verdict endpoint', () => {
  expect([...handlers.keys()]).toEqual([...HANDLED_CHANNELS])
  expect([...handlers.keys()].some(key => key.includes('verdict'))).toBe(false)
})
test('renderer round-trip creates, lists, gets and controls persisted native goals', async () => {
  const goal = await invoke(RPC_CHANNELS.goals.CREATE, 'workspace-a', { title: 'Renderer goal', criteria: ['Real result'] })
  expect(goal.state).toBe('draft')
  expect(await invoke(RPC_CHANNELS.goals.GET, 'workspace-a')).toEqual([goal])
  expect(await invoke(RPC_CHANNELS.goals.GET_ONE, 'workspace-a', goal.id)).toEqual(goal)
  expect(await invoke(RPC_CHANNELS.goals.GET_ONE, 'workspace-a', 'missing')).toBeNull()
  const blocked = await invoke(RPC_CHANNELS.goals.ACTION, 'workspace-a', goal.id, { type: 'start' })
  expect(blocked.state).toBe('blocked')
  const paused = await invoke(RPC_CHANNELS.goals.ACTION, 'workspace-a', goal.id, { type: 'pause' })
  expect(paused.state).toBe('paused')
  const stopped = await invoke(RPC_CHANNELS.goals.ACTION, 'workspace-a', goal.id, { type: 'stop' })
  expect(stopped.state).toBe('stopped')
})
test('changed event is scoped to canonical workspace and carries exact renderer tuple', async () => {
  const goal = await invoke(RPC_CHANNELS.goals.CREATE, 'friendly-name', { title: 'Changed', criteria: ['Check'] })
  expect(pushes).toEqual([[RPC_CHANNELS.goals.CHANGED, { to: 'workspace', workspaceId: 'workspace-a' }, 'workspace-a', [goal]]])
  getGoalService(root).create({ title: 'Host created', criteria: ['Check'] })
  expect(pushes.length).toBe(2)
  expect((pushes[1]![3] as unknown[]).length).toBe(2)
})
test('rejects malformed payloads, traversal, unknown workspaces and cross-workspace access', async () => {
  for (const workspace of [undefined, {}, '', 'unknown']) {
    await expect(invoke(RPC_CHANNELS.goals.GET, workspace)).rejects.toThrow()
  }
  await expect(invoke(RPC_CHANNELS.goals.CREATE, 'workspace-a', { title: 'Forged', criteria: ['Check'], state: 'done' })).rejects.toThrow()
  await expect(invoke(RPC_CHANNELS.goals.GET_ONE, 'workspace-a', '../outside')).rejects.toThrow()
  await expect(invoke(RPC_CHANNELS.goals.ACTION, 'workspace-a', 'valid-id', { type: 'set_caps', caps: { sessions: -1 } })).rejects.toThrow()
  await expect(invoke(RPC_CHANNELS.goals.ACTION, 'workspace-a', 'valid-id', { type: 'pause', actor: 'user' })).rejects.toThrow()
  const handler = handlers.get(RPC_CHANNELS.goals.GET)!
  expect(() => handler({ ...ctx, workspaceId: 'workspace-b' }, 'workspace-a')).toThrow('does not match')
})
test('disposal detaches the changed subscription', async () => {
  await invoke(RPC_CHANNELS.goals.GET, 'workspace-a')
  dispose()
  getGoalService(root).create({ title: 'No stale listener', criteria: ['Check'] })
  expect(pushes).toEqual([])
})


test('only an existing session in the connected workspace can be linked on create', async () => {
  const input = { title: 'Linked', criteria: ['Check'] }
  await expect(invoke(RPC_CHANNELS.goals.CREATE, 'workspace-a', { ...input, ownerSessionId: 'unknown-owner' })).rejects.toThrow('this workspace')
  const goal = await invoke(RPC_CHANNELS.goals.CREATE, 'workspace-a', { ...input, ownerSessionId: 'existing-owner' })
  expect(goal.ownerSessionId).toBe('existing-owner')
  expect(goal.counters.sessions).toBe(1)
})
