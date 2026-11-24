import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activity, updateGoal } from '@craft-agent/shared/goals'
import { GoalService, getGoalService } from './service'
import { startGoalHost } from './host-runtime'

const input = { title: 'Runtime fixture', criteria: ['Check generated evidence'] }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(condition: () => boolean) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await delay(5) }
  throw new Error('Timed out waiting for bounded scheduler')
}

test('automatic host recovers before work, skips remote roots, serializes wakes, forwards abort and unconfigures on shutdown', async () => {
  const local = mkdtempSync(join(realpathSync(tmpdir()), 'craft-goal-host-local-'))
  const remote = mkdtempSync(join(realpathSync(tmpdir()), 'craft-goal-host-remote-'))
  const service = getGoalService(local)
  const remoteService = getGoalService(remote)
  const outOfProcess = new GoalService(local, () => ({
    createOwner: async () => 'previous-owner', createVerifier: async () => 'previous-verifier',
    wakeSession: async () => {}, cancelSession: async () => {},
  }))
  const old = await outOfProcess.userAction(outOfProcess.create(input).id, { type: 'start' })
  let stop = () => {}
  let pendingSignal: AbortSignal | undefined
  let finishWake: (() => void) | undefined
  let holdWake = false
  const observed: string[] = []
  try {
    stop = startGoalHost({
      workspaces: () => [{ id: 'local', rootPath: local }, { id: 'remote', rootPath: remote, remoteServer: {} }],
      create: async (workspace, _goal, role) => { observed.push(`create:${workspace.id}:${role}`); return `new-${role}` },
      wake: async (workspace, _goal, id, _message, signal) => {
        observed.push(`wake:${workspace.id}:${id}`)
        if (holdWake) {
          pendingSignal = signal
          await new Promise<void>(resolve => { finishWake = resolve })
        }
      },
      cancel: async () => {},
      warn: message => { observed.push(message) },
    }, 5)
    expect(service.get(old.id)?.state).toBe('blocked')
    expect(observed).toEqual([])
    const remoteDraft = remoteService.create(input)
    const remoteBlocked = await remoteService.userAction(remoteDraft.id, { type: 'start' })
    expect(remoteBlocked.blockedReason).toContain('Automatic execution is unavailable')
    expect(observed).toEqual([])
    const draft = service.create(input)
    const active = await service.userAction(draft.id, { type: 'start' })
    expect(active.state).toBe('active')
    expect(observed).toEqual(['create:local:owner', 'wake:local:new-owner'])

    holdWake = true
    updateGoal(local, active.id, active.revision, goal => {
      goal.nextWakeAt = new Date(Date.now() - 1_000).toISOString()
      goal.activity.push(activity('fixture', 'Make one heartbeat eligible', new Date()))
    })
    await waitFor(() => !!pendingSignal)
    await delay(30)
    expect(observed.filter(event => event.startsWith('wake:')).length).toBe(2)
    expect(service.get(active.id)?.counters.wakesToday).toBe(2)
    stop()
    expect(pendingSignal!.aborted).toBe(true)
    finishWake?.()
    await delay(15)
    expect(observed.filter(event => event.startsWith('wake:')).length).toBe(2)
    const draftAfterShutdown = service.create(input)
    expect((await service.userAction(draftAfterShutdown.id, { type: 'start' })).blockedReason).toContain('unavailable')
  } finally {
    stop()
    finishWake?.()
    rmSync(local, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})
