import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync, linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activity, assertGoalEvidence, createGoal, getGoal, getGoals, GoalRevisionConflict, updateGoal, writeGoalEvidence } from './storage'
import { createGoalSchema, userActionSchema, validateGoal } from './validation'

let root: string
const now = new Date('2026-11-24T15:15:23.876Z')
const input = { title: 'Ship native Goals', criteria: ['Persist across restart', 'Reject impersonation'] }
beforeEach(() => { root = mkdtempSync(join(realpathSync(tmpdir()), 'craft-goals-test-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function update(id: string, revision: number, message = 'Checked') {
  return updateGoal(root, id, revision, goal => { goal.activity.push(activity('progress', message, now)) }, now)
}

describe('authoritative Goals storage', () => {
  test('creates native files, stable criteria and default safety caps', () => {
    const goal = createGoal(root, input, now)
    expect(goal.state).toBe('draft')
    expect(goal.criteria.map(c => c.id)).toEqual(['criterion-1', 'criterion-2'])
    expect(goal.caps).toEqual({ heartbeatHours: 4, wakesPerDay: 12, sessions: 10 })
    expect(goal.counters).toEqual({ wakesToday: 0, sessions: 0, utcDay: '2026-11-24' })
    expect(existsSync(join(goal.folderPath, 'evidence'))).toBe(true)
    expect(readFileSync(join(goal.folderPath, 'GOAL.md'), 'utf8')).toContain('Persist across restart')
    expect(getGoal(root, goal.id)).toEqual(goal)
    expect(getGoals(root)).toEqual([goal])
  })
  test('empty reads do not create a Goals directory', () => {
    expect(getGoals(root)).toEqual([])
    expect(getGoal(root, 'missing')).toBeNull()
    expect(existsSync(join(root, 'goals'))).toBe(false)
  })
  test('compare-and-swap rejects a stale update without losing prior activity', () => {
    const original = createGoal(root, input, now)
    const log = readFileSync(join(original.folderPath, 'log.md'), 'utf8')
    const next = update(original.id, original.revision)
    expect(next.revision).toBe(2)
    expect(() => update(original.id, original.revision, 'stale')).toThrow(GoalRevisionConflict)
    expect(getGoal(root, original.id)).toEqual(next)
    expect(readFileSync(join(original.folderPath, 'log.md'), 'utf8').startsWith(log)).toBe(true)
  })
  test('rejects rewriting history, identities or criteria text', () => {
    const original = createGoal(root, input, now)
    for (const mutate of [
      (g: typeof original) => { g.activity[0]!.message = 'forged' },
      (g: typeof original) => { g.title = 'changed'; g.id = 'forged' },
      (g: typeof original) => { g.criteria[0]!.text = 'easier' },
      (g: typeof original) => { g.criteria.reverse() },
    ]) expect(() => updateGoal(root, original.id, 1, g => { mutate(g); g.activity.push(activity('progress', 'extra', now)) })).toThrow()
    expect(getGoal(root, original.id)).toEqual(original)
  })
  test('rejects lock contention instead of racing writers', () => {
    const goal = createGoal(root, input, now)
    writeFileSync(join(root, 'goals', '.write-lock'), 'other writer')
    expect(() => update(goal.id, goal.revision)).toThrow('locked')
    expect(JSON.parse(readFileSync(join(goal.folderPath, 'goal.json'), 'utf8')).revision).toBe(1)
  })
  test('repairs projections after interrupted snapshot-to-log publication', () => {
    const goal = createGoal(root, input, now)
    const oldLog = readFileSync(join(goal.folderPath, 'log.md'), 'utf8')
    update(goal.id, goal.revision)
    // Simulate a crash after authoritative JSON commit but before projections.
    writeFileSync(join(goal.folderPath, 'log.md'), oldLog)
    writeFileSync(join(goal.folderPath, 'GOAL.md'), 'stale projection')
    const restored = getGoal(root, goal.id)!
    expect(readFileSync(join(goal.folderPath, 'log.md'), 'utf8')).toContain('Checked')
    expect(readFileSync(join(goal.folderPath, 'GOAL.md'), 'utf8')).toContain('Revision: 2')
    const repaired = readFileSync(join(goal.folderPath, 'log.md'), 'utf8')
    getGoal(root, restored.id)
    expect(readFileSync(join(goal.folderPath, 'log.md'), 'utf8')).toBe(repaired)
  })
  test('fails closed on corrupted JSON, identity mismatch and activity tampering', () => {
    const goal = createGoal(root, input, now)
    writeFileSync(join(goal.folderPath, 'goal.json'), '{')
    expect(() => getGoals(root)).toThrow()
    writeFileSync(join(goal.folderPath, 'goal.json'), JSON.stringify({ ...goal, folderPath: '/elsewhere' }))
    expect(() => getGoal(root, goal.id)).toThrow('identity/path')
    writeFileSync(join(goal.folderPath, 'goal.json'), JSON.stringify(goal))
    writeFileSync(join(goal.folderPath, 'log.md'), 'forged event')
    expect(() => getGoal(root, goal.id)).toThrow('authoritative history')
  })
  test('immutable evidence rejects replacement, empty content and traversal', () => {
    const goal = createGoal(root, input, now)
    const evidence = writeGoalEvidence(root, goal.id, 'check.md', 'Actual check output')
    expect(evidence).toBe('evidence/check.md')
    assertGoalEvidence(root, goal.id, evidence)
    expect(() => writeGoalEvidence(root, goal.id, 'check.md', 'replacement')).toThrow()
    expect(() => writeGoalEvidence(root, goal.id, '../outside.md', 'escape')).toThrow()
    expect(() => writeGoalEvidence(root, goal.id, 'empty.md', '')).toThrow()
    expect(() => assertGoalEvidence(root, goal.id, 'evidence/missing.md')).toThrow()
  })
})

describe('Goals path and input boundaries', () => {
  test('rejects traversal and absolute IDs', () => {
    createGoal(root, input, now)
    for (const id of ['../outside', '/tmp/x', 'a/b', '.', '..', 'A', 'a\\b', 'a\0b']) {
      expect(() => getGoal(root, id)).toThrow()
    }
  })
  test('rejects workspace, goals, goal, snapshot, projection and evidence symlinks', () => {
    const workspaceLink = join(root, 'linked-workspace')
    symlinkSync(root, workspaceLink)
    expect(() => getGoals(workspaceLink)).toThrow('Unsafe')
    const outside = join(root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, join(root, 'goals'))
    expect(() => createGoal(root, input)).toThrow('Unsafe')
  })
  for (const target of ['goal.json', 'GOAL.md', 'log.md', 'evidence']) {
    test(`rejects symlinked ${target}`, () => {
      const goal = createGoal(root, input, now)
      const outside = join(root, 'outside')
      writeFileSync(outside, 'untouched')
      rmSync(join(goal.folderPath, target), { recursive: true })
      symlinkSync(outside, join(goal.folderPath, target))
      expect(() => getGoal(root, goal.id)).toThrow('Unsafe')
      expect(readFileSync(outside, 'utf8')).toBe('untouched')
    })
  }
  test('rejects symlinked goal folder and hardlinked state files', () => {
    const goal = createGoal(root, input, now)
    symlinkSync(goal.folderPath, join(root, 'goals', 'linked-goal'))
    expect(() => getGoals(root)).toThrow('Unsafe')
    linkSync(join(goal.folderPath, 'goal.json'), join(root, 'hardlink'))
    expect(() => getGoal(root, goal.id)).toThrow('Unsafe')
  })
  test('strictly validates criteria count, finite caps, actor fields and owner/verifier separation', () => {
    for (const criteria of [[], Array.from({ length: 9 }, () => 'criterion'), ['  ']]) expect(() => createGoal(root, { ...input, criteria })).toThrow()
    expect(() => createGoalSchema.parse({ ...input, state: 'done' })).toThrow()
    expect(() => createGoalSchema.parse({ ...input, title: 'x\0y' })).toThrow()
    expect(() => userActionSchema.parse({ type: 'pause', sessionId: 'owner' })).toThrow()
    expect(() => userActionSchema.parse({ type: 'set_caps', caps: { sessions: Infinity } })).toThrow()
    expect(() => userActionSchema.parse({ type: 'set_caps', caps: { heartbeatHours: 0 } })).toThrow()
    expect(() => userActionSchema.parse({ type: 'set_caps', caps: {} })).toThrow()
    const goal = createGoal(root, input, now)
    expect(() => validateGoal({ ...goal, ownerSessionId: 'same', verifierSessionId: 'same' })).toThrow('different')
    expect(() => validateGoal({ ...goal, state: 'done' })).toThrow('independent')
  })
})


test('separate processes cannot both commit the same expected revision', async () => {
  const goal = createGoal(root, input, now)
  const code = `import { updateGoal, activity } from ${JSON.stringify(join(import.meta.dir, 'storage.ts'))};
    try {
      updateGoal(process.argv[1], process.argv[2], 1, g => g.activity.push(activity('process', 'Concurrent writer', new Date())));
      process.exit(0);
    } catch { process.exit(3); }`
  const first = Bun.spawn([process.execPath, '-e', code, root, goal.id], { stdout: 'pipe', stderr: 'pipe' })
  const second = Bun.spawn([process.execPath, '-e', code, root, goal.id], { stdout: 'pipe', stderr: 'pipe' })
  const statuses = await Promise.all([first.exited, second.exited])
  expect(statuses.sort()).toEqual([0, 3])
  expect(getGoal(root, goal.id)!.revision).toBe(2)
  expect(getGoal(root, goal.id)!.activity.length).toBe(2)
})
