import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GoalService, type GoalRuntime } from './service'
import type { Goal, GoalCriterionResult } from '@craft-agent/shared/goals/types'

let root: string
let time: Date
let service: GoalService
let calls: string[]
let runtime: GoalRuntime
let nextVerifier: number
beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'craft-goal-service-test-'))
  time = new Date('2026-11-24T15:15:23.876Z')
  calls = []
  nextVerifier = 0
  runtime = {
    createOwner: async () => { calls.push('createOwner'); return 'owner-session' },
    createVerifier: async () => { calls.push('createVerifier'); return `verifier-${++nextVerifier}` },
    wakeSession: async (goal, id, _message, signal) => {
      if (signal.aborted) throw new Error('aborted')
      expect(service.get(goal.id)!.state).toBe(goal.state)
      calls.push(`wake:${id}`)
    },
    cancelSession: async (_goal, id) => { calls.push(`cancel:${id}`) },
  }
  service = new GoalService(root, () => runtime, () => time)
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })
const create = () => service.create({ title: 'Native goal', criteria: ['Prove the real outcome', 'Keep permissions'] })
const read = (goal: Goal) => service.get(goal.id)!
const owner = () => service.forSession('owner-session')

async function active() { return service.userAction(create().id, { type: 'start' }) }
async function verifying() {
  const goal = await active()
  return owner().requestVerification(goal.id, goal.revision)
}
function results(goal: Goal, status: 'pass' | 'fail' = 'pass'): GoalCriterionResult[] {
  const actor = service.forSession(goal.verifierSessionId!)
  return goal.criteria.map((criterion, i) => ({
    id: criterion.id, status, evidence: actor.evidence(goal.id, goal.revision, `verdict-${i}.md`, 'Checked actual result; generated test evidence.'),
  }))
}

describe('native Goal lifecycle with injected runtime', () => {
  test('start persists owner and counts before waking; heartbeat is actually bounded', async () => {
    const goal = await active()
    expect(goal.state).toBe('active')
    expect(goal.ownerSessionId).toBe('owner-session')
    expect(goal.counters).toEqual({ wakesToday: 1, sessions: 1, utcDay: '2026-11-24' })
    expect(calls).toEqual(['createOwner', 'wake:owner-session'])
    await service.tick()
    expect(calls.length).toBe(2)
    time = new Date(time.getTime() + 4 * 3600000)
    await service.tick()
    expect(read(goal).counters.wakesToday).toBe(2)
    expect(calls).toEqual(['createOwner', 'wake:owner-session', 'wake:owner-session'])
    expect(read(goal).counters.sessions).toBe(1)
  })
  test('without runtime a start is visibly blocked and never claims execution', async () => {
    const disconnected = new GoalService(root)
    const goal = disconnected.create({ title: 'No runtime', criteria: ['Check'] })
    const blocked = await disconnected.userAction(goal.id, { type: 'start' })
    expect(blocked.state).toBe('blocked')
    expect(blocked.blockedReason).toContain('unavailable')
    expect(blocked.counters.sessions).toBe(0)
    expect(blocked.nextWakeAt).toBeUndefined()
    expect(calls).toEqual([])
  })
  test('owner progress cannot self-certify and waits for human answer', async () => {
    let goal = await active()
    const callbacks = owner()
    expect('userAction' in callbacks).toBe(false)
    goal = callbacks.progress(goal.id, goal.revision, 'Real output recorded')
    expect(goal.state).toBe('active')
    expect(() => callbacks.verdict(goal.id, goal.revision, [], 'I passed')).toThrow('not the goal actor')
    goal = callbacks.ask(goal.id, goal.revision, 'Which result should I use?')
    expect(goal.state).toBe('waiting_on_user')
    expect(goal.question?.text).toBe('Which result should I use?')
    expect(goal.nextWakeAt).toBeUndefined()
    time = new Date(time.getTime() + 8 * 3600000)
    await service.tick()
    expect(calls.filter(c => c.startsWith('wake:')).length).toBe(1)
    expect(() => callbacks.progress(goal.id, goal.revision, 'ignore question')).toThrow('not accepting')
    await expect(service.userAction(goal.id, { type: 'resume' })).rejects.toThrow()
    goal = await service.userAction(goal.id, { type: 'answer', answer: 'Use the tested result.' })
    expect(goal.state).toBe('active')
    expect(goal.question).toBeUndefined()
    expect(goal.activity.find(a => a.type === 'answer')?.message).toBe('Use the tested result.')
    expect(goal.counters.sessions).toBe(1)
  })
  test('only assigned independent verifier can submit a complete evidence-backed verdict', async () => {
    let goal = await verifying()
    expect(goal.state).toBe('verifying')
    expect(goal.verifierSessionId).not.toBe(goal.ownerSessionId)
    expect(goal.counters.sessions).toBe(2)
    expect(() => owner().progress(goal.id, goal.revision, 'change during verification')).toThrow()
    const verdict = results(goal)
    const verifier = service.forSession(goal.verifierSessionId!)
    expect(() => owner().verdict(goal.id, goal.revision, verdict, 'fake')).toThrow()
    expect(() => service.forSession('other').verdict(goal.id, goal.revision, verdict, 'fake')).toThrow()
    expect(() => verifier.verdict(goal.id, goal.revision, verdict.slice(1), 'incomplete')).toThrow('every criterion')
    expect(() => verifier.verdict(goal.id, goal.revision, [verdict[0]!, verdict[0]!], 'duplicates')).toThrow('every criterion')
    expect(() => verifier.verdict(goal.id, goal.revision, verdict.map(v => ({ ...v, evidence: 'evidence/missing.md' })), 'missing')).toThrow('nonempty')
    goal = verifier.verdict(goal.id, goal.revision, verdict, 'Independently checked every outcome.')
    expect(goal.state).toBe('done')
    expect(goal.criteria.every(c => c.status === 'pass' && c.evidence)).toBe(true)
    expect(goal.nextWakeAt).toBeUndefined()
    await expect(service.userAction(goal.id, { type: 'resume' })).rejects.toThrow('Terminal')
    expect(() => verifier.verdict(goal.id, goal.revision, verdict, 'replay')).toThrow('not accepting')
  })
  test('failed verification blocks, never automatically returns to owner work', async () => {
    let goal = await verifying()
    goal = service.forSession(goal.verifierSessionId!).verdict(goal.id, goal.revision, results(goal, 'fail'), 'The actual test failed.')
    expect(goal.state).toBe('blocked')
    expect(goal.blockedReason).toContain('verification failed')
    const count = calls.length
    time = new Date(time.getTime() + 12 * 3600000)
    await service.tick()
    expect(calls.length).toBe(count)
    goal = await service.userAction(goal.id, { type: 'resume' })
    expect(goal.state).toBe('active')
  })
  test('rejects runtime using owner as verifier', async () => {
    const goal = await active()
    runtime.createVerifier = async () => 'owner-session'
    const blocked = await owner().requestVerification(goal.id, goal.revision)
    expect(blocked.state).toBe('blocked')
    expect(blocked.verifierSessionId).toBeUndefined()
    expect(blocked.counters.sessions).toBe(2) // reservation is never refunded optimistically
    expect(calls.filter(c => c === 'wake:owner-session').length).toBe(1)
  })
  test('rejects reuse of a prior verifier', async () => {
    let goal = await verifying()
    const firstVerifier = goal.verifierSessionId!
    goal = service.forSession(firstVerifier).verdict(goal.id, goal.revision, results(goal, 'fail'), 'failed')
    goal = await service.userAction(goal.id, { type: 'resume' })
    runtime.createVerifier = async () => firstVerifier
    goal = await owner().requestVerification(goal.id, goal.revision)
    expect(goal.state).toBe('blocked')
  })
  test('pause/resume/stop are human-only, cancel sessions and block all agent callbacks', async () => {
    let goal = await active()
    goal = await service.userAction(goal.id, { type: 'pause' })
    expect(goal.state).toBe('paused')
    expect(calls).toContain('cancel:owner-session')
    expect(goal.nextWakeAt).toBeUndefined()
    expect(() => owner().progress(goal.id, goal.revision, 'ignore pause')).toThrow()
    await expect(owner().requestVerification(goal.id, goal.revision)).rejects.toThrow()
    goal = await service.userAction(goal.id, { type: 'resume' })
    expect(goal.state).toBe('active')
    expect(goal.counters.sessions).toBe(1)
    goal = await service.userAction(goal.id, { type: 'stop' })
    expect(goal.state).toBe('stopped')
    await expect(service.userAction(goal.id, { type: 'wake' })).rejects.toThrow('Terminal')
  })
  test('pause racing idle session creation prevents any wake and cancels orphan session', async () => {
    let complete!: (id: string) => void
    runtime.createOwner = () => new Promise(resolve => { complete = resolve })
    const goal = create()
    const pending = service.userAction(goal.id, { type: 'start' })
    expect(read(goal).state).toBe('blocked')
    await service.userAction(goal.id, { type: 'pause' })
    complete('late-owner')
    expect((await pending).state).toBe('paused')
    expect(calls).toEqual(['cancel:late-owner'])
    expect(read(goal).ownerSessionId).toBeUndefined()
  })
  test('pause aborts in-flight admission and cancels again when it finishes', async () => {
    let complete!: () => void
    let admissionSignal: AbortSignal | undefined
    runtime.wakeSession = async (_goal, _id, _message, signal) => {
      admissionSignal = signal
      await new Promise<void>(resolve => { complete = resolve })
    }
    const goal = create()
    const pending = service.userAction(goal.id, { type: 'start' })
    await Promise.resolve()
    expect(admissionSignal).toBeDefined()
    await service.userAction(goal.id, { type: 'pause' })
    expect(admissionSignal!.aborted).toBe(true)
    complete()
    expect((await pending).state).toBe('paused')
    expect(calls.filter(c => c === 'cancel:owner-session').length).toBe(2)
  })
  test('concurrent dispatch is rejected and stale callbacks cannot overwrite state', async () => {
    let complete!: (id: string) => void
    runtime.createOwner = () => new Promise(resolve => { complete = resolve })
    const goal = create()
    const pending = service.userAction(goal.id, { type: 'start' })
    await expect(service.userAction(goal.id, { type: 'resume' })).rejects.toThrow('dispatch already')
    complete('owner-session')
    const current = await pending
    expect(() => owner().progress(goal.id, current.revision - 1, 'stale')).toThrow('revision conflict')
    expect(read(goal).revision).toBe(current.revision)
  })
  test('daily cap blocks before runtime effects; UTC rollover resets only wake counter', async () => {
    let goal = create()
    goal = await service.userAction(goal.id, { type: 'set_caps', caps: { wakesPerDay: 1 } })
    goal = await service.userAction(goal.id, { type: 'start' })
    goal = await service.userAction(goal.id, { type: 'wake' })
    expect(goal.state).toBe('blocked')
    expect(goal.counters.wakesToday).toBe(1)
    expect(calls).toEqual(['createOwner', 'wake:owner-session'])
    time = new Date('2026-11-25T00:01:00.000Z')
    goal = await service.userAction(goal.id, { type: 'resume' })
    expect(goal.state).toBe('active')
    expect(goal.counters).toEqual({ wakesToday: 1, sessions: 1, utcDay: '2026-11-25' })
  })
  test('session cap blocks verification; only human caps update unlocks another reservation', async () => {
    let goal = create()
    goal = await service.userAction(goal.id, { type: 'set_caps', caps: { sessions: 1 } })
    goal = await service.userAction(goal.id, { type: 'start' })
    goal = await owner().requestVerification(goal.id, goal.revision)
    expect(goal.state).toBe('blocked')
    expect(goal.blockedReason).toContain('Session cap')
    expect(calls).not.toContain('createVerifier')
    goal = await service.userAction(goal.id, { type: 'set_caps', caps: { sessions: 2 } })
    goal = await service.userAction(goal.id, { type: 'verify' })
    expect(goal.state).toBe('verifying')
    expect(goal.counters.sessions).toBe(2)
  })
  test('dispatch failure is durable, redacts runtime error and never automatically retries', async () => {
    runtime.wakeSession = async () => { throw new Error('sensitive-provider-detail') }
    const goal = await active()
    expect(goal.state).toBe('blocked')
    expect(JSON.stringify(goal)).not.toContain('sensitive-provider-detail')
    expect(goal.counters.wakesToday).toBe(1)
    expect(goal.counters.sessions).toBe(1)
    await service.tick()
    expect(calls).toEqual(['createOwner'])
  })
  test('restart reports execution unconfirmed and never silently starts a model', async () => {
    const goal = await active()
    const before = calls.length
    const restarted = new GoalService(root, () => runtime, () => time)
    const recovered = restarted.recoverInterrupted()[0]!
    expect(recovered.state).toBe('blocked')
    expect(recovered.blockedReason).toContain('restarted')
    expect(recovered.ownerSessionId).toBe(goal.ownerSessionId)
    await restarted.tick()
    expect(calls.length).toBe(before)
    expect(restarted.get(goal.id)!.nextWakeAt).toBeUndefined()
  })
  test('changed snapshots publish agent and user updates; broken listener cannot undo a commit', async () => {
    const snapshots: Goal[][] = []
    const unsubscribe = service.subscribe(goals => { snapshots.push(goals) })
    service.subscribe(() => { throw new Error('disconnected') })
    let goal = await active()
    const count = snapshots.length
    goal = owner().progress(goal.id, goal.revision, 'checked')
    expect(snapshots.length).toBe(count + 1)
    expect(snapshots.at(-1)![0]!.revision).toBe(goal.revision)
    unsubscribe()
    owner().progress(goal.id, goal.revision, 'more')
    expect(snapshots.length).toBe(count + 1)
  })
  test('rejects actor impersonation, invalid user action fields and invalid state transitions', async () => {
    const goal = await active()
    expect(() => service.forSession('../owner')).toThrow()
    expect(() => service.forSession('stranger').progress(goal.id, goal.revision, 'fake')).toThrow('not the goal actor')
    await expect(service.userAction(goal.id, { type: 'start' })).rejects.toThrow('draft')
    await expect(service.userAction(goal.id, { type: 'answer', answer: 'unexpected' })).rejects.toThrow('not waiting')
    await expect(service.userAction(goal.id, { type: 'pause', actor: 'human' } as never)).rejects.toThrow()
  })
})

test('a paused waiting question resumes to the question, not unwanted owner work', async () => {
  let goal = await active()
  goal = owner().ask(goal.id, goal.revision, 'Please choose the input.')
  goal = await service.userAction(goal.id, { type: 'pause' })
  const count = calls.length
  goal = await service.userAction(goal.id, { type: 'resume' })
  expect(goal.state).toBe('waiting_on_user')
  expect(goal.question?.text).toBe('Please choose the input.')
  expect(calls.length).toBe(count)
  goal = await service.userAction(goal.id, { type: 'answer', answer: 'Use generated fixtures.' })
  expect(goal.state).toBe('active')
})

test('daily counters display zero after UTC rollover even without another dispatch', async () => {
  const goal = await active()
  time = new Date('2026-11-25T00:00:00.000Z')
  expect(service.get(goal.id)!.counters).toEqual({ wakesToday: 0, sessions: 1, utcDay: '2026-11-25' })
  expect(service.list()[0]!.counters.wakesToday).toBe(0)
})
