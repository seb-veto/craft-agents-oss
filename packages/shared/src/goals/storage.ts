import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CreateGoalInput, Goal, GoalActivity } from './types'
import { DEFAULT_GOAL_CAPS } from './types'
import { createGoalSchema, evidencePathSchema, goalIdSchema, validateGoal } from './validation'

export class GoalRevisionConflict extends Error {
  constructor() { super('Goal revision conflict; reload before retrying'); this.name = 'GoalRevisionConflict' }
}

/** Reject symlinks in every existing component, including the configured workspace. */
function safePath(path: string, directory = false): void {
  const absolute = resolve(path)
  let current = parse(absolute).root
  const parts = absolute.slice(current.length).split(sep).filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!)
    let stat
    try { stat = lstatSync(current) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 || directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
      throw new Error(`Unsafe Goals path: ${current}`)
    }
  }
}

function goalsRoot(root: string, create = false): string {
  if (!isAbsolute(root)) throw new Error('Workspace root must be absolute')
  safePath(root, true)
  if (!existsSync(root)) throw new Error('Workspace root does not exist')
  const path = join(root, 'goals')
  safePath(path, true)
  if (create && !existsSync(path)) mkdirSync(path, { mode: 0o700 })
  return path
}

function folder(root: string, id: string): string {
  goalIdSchema.parse(id)
  const path = join(goalsRoot(root), id)
  safePath(path, true)
  return path
}

function readSafe(path: string): string {
  safePath(path)
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { return readFileSync(fd, 'utf8') } finally { closeSync(fd) }
}

function atomicWrite(path: string, text: string): void {
  safePath(path)
  safePath(dirname(path), true)
  const temporary = join(dirname(path), `.goal-${randomUUID()}.tmp`)
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    writeFileSync(fd, text)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  // Never follow an existing target, including a malicious symlink inserted during preparation.
  safePath(path)
  renameSync(temporary, path)
  const dir = openSync(dirname(path), constants.O_RDONLY)
  try { fsyncSync(dir) } finally { closeSync(dir) }
}

function withLock<T>(root: string, fn: () => T): T {
  const path = join(goalsRoot(root, true), '.write-lock')
  safePath(path)
  let fd: number
  try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Goals store is locked; retry later (an interrupted writer may require host recovery)')
    throw error
  }
  try { return fn() } finally { closeSync(fd); unlinkSync(path) }
}

function logText(goal: Goal): string {
  return '# Goal activity — append only\n\n' + goal.activity.map(a => `${JSON.stringify(a)}\n`).join('')
}

function checkLog(goal: Goal): void {
  const path = join(goal.folderPath, 'log.md')
  safePath(path)
  if (existsSync(path) && !logText(goal).startsWith(readSafe(path))) {
    throw new Error('Goal activity log does not match authoritative history')
  }
}

/** JSON is authoritative; repair projections after a crash between snapshot and projection writes. */
function project(goal: Goal): void {
  checkLog(goal)
  const log = join(goal.folderPath, 'log.md')
  const expected = logText(goal)
  const previous = existsSync(log) ? readSafe(log) : ''
  if (previous !== expected) {
    safePath(log)
    const fd = openSync(log, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600)
    try { writeFileSync(fd, expected.slice(previous.length)); fsyncSync(fd) } finally { closeSync(fd) }
  }
  const markdown = `# ${goal.title}\n\n${goal.description}\n\nState: ${goal.state}\nRevision: ${goal.revision}\n\n## Done criteria\n\n${goal.criteria.map(c => `- [${c.status === 'pass' ? 'x' : ' '}] ${c.id}: ${c.text}${c.evidence ? ` (${c.evidence})` : ''}`).join('\n')}\n\nGenerated from goal.json. Edits here do not change the goal.\n`
  const goalPath = join(goal.folderPath, 'GOAL.md')
  if (!existsSync(goalPath) || readSafe(goalPath) !== markdown) atomicWrite(goalPath, markdown)
}

function load(root: string, id: string): Goal | null {
  const path = folder(root, id)
  if (!existsSync(path)) return null
  const snapshot = join(path, 'goal.json')
  const goal = validateGoal(JSON.parse(readSafe(snapshot)))
  if (goal.id !== id || goal.slug !== id || goal.folderPath !== path) throw new Error('Goal identity/path mismatch')
  safePath(join(path, 'evidence'), true)
  safePath(join(path, 'GOAL.md'))
  checkLog(goal)
  return goal
}

export function getGoal(root: string, id: string): Goal | null {
  // Projection repair is serialized with writes, so two readers cannot append the same history.
  if (!existsSync(goalsRoot(root))) { goalIdSchema.parse(id); return null }
  return withLock(root, () => {
    const goal = load(root, id)
    if (goal) project(goal)
    return goal
  })
}

export function getGoals(root: string): Goal[] {
  const path = goalsRoot(root)
  if (!existsSync(path)) return []
  return withLock(root, () => readdirSync(path, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unsafe entry in Goals store')
      const goal = load(root, entry.name)!
      project(goal)
      return goal
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
}

export function activity(type: string, message: string, now: Date, sessionId?: string): GoalActivity {
  return { id: randomUUID(), at: now.toISOString(), type, message, ...(sessionId ? { sessionId } : {}) }
}

export function createGoal(root: string, value: CreateGoalInput, now = new Date()): Goal {
  const input = createGoalSchema.parse(value)
  return withLock(root, () => {
    const id = `goal-${randomUUID()}`
    const path = folder(root, id)
    mkdirSync(path, { mode: 0o700 })
    mkdirSync(join(path, 'evidence'), { mode: 0o700 })
    const goal: Goal = validateGoal({
      id, slug: id, title: input.title, description: input.description ?? '', state: 'draft', revision: 1,
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
      criteria: input.criteria.map((text, i) => ({ id: `criterion-${i + 1}`, text, status: 'pending' })),
      activity: [activity('created', 'Goal created. Automatic execution requires a connected host runtime.', now)],
      ownerSessionId: input.ownerSessionId, caps: { ...DEFAULT_GOAL_CAPS },
      counters: { wakesToday: 0, sessions: input.ownerSessionId ? 1 : 0, utcDay: now.toISOString().slice(0, 10) },
      folderPath: path,
    })
    atomicWrite(join(path, 'goal.json'), JSON.stringify(goal, null, 2) + '\n')
    project(goal)
    return goal
  })
}

/** Host-only compare-and-swap. Immutable identity, criteria text and prior activity cannot be rewritten. */
export function updateGoal(root: string, id: string, revision: number, mutate: (goal: Goal) => void, now = new Date()): Goal {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid expected revision')
  return withLock(root, () => {
    const previous = load(root, id)
    if (!previous) throw new Error('Goal not found')
    if (previous.revision !== revision) throw new GoalRevisionConflict()
    const goal = structuredClone(previous)
    mutate(goal)
    if (['id', 'slug', 'folderPath', 'createdAt', 'revision'].some(key => goal[key as keyof Goal] !== previous[key as keyof Goal])
      || JSON.stringify(goal.criteria.map(c => [c.id, c.text])) !== JSON.stringify(previous.criteria.map(c => [c.id, c.text]))
      || JSON.stringify(goal.activity.slice(0, previous.activity.length)) !== JSON.stringify(previous.activity)
      || goal.activity.length <= previous.activity.length) throw new Error('Goal immutable history was changed or no activity was appended')
    goal.revision++
    goal.updatedAt = now.toISOString()
    validateGoal(goal)
    for (const criterion of goal.criteria) if (criterion.evidence) assertGoalEvidence(root, id, criterion.evidence)
    checkLog(goal)
    atomicWrite(join(goal.folderPath, 'goal.json'), JSON.stringify(goal, null, 2) + '\n')
    project(goal)
    return goal
  })
}

export function assertGoalEvidence(root: string, id: string, evidence: string): void {
  evidencePathSchema.parse(evidence)
  const path = join(folder(root, id), evidence)
  safePath(path)
  if (!existsSync(path) || lstatSync(path).size === 0) throw new Error('Evidence file must exist and be nonempty')
}

/** Evidence is immutable once published. The host supplies content, never an arbitrary filesystem source. */
export function writeGoalEvidence(root: string, id: string, name: string, content: string): string {
  const evidence = evidencePathSchema.parse(`evidence/${name}`)
  if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > 1024 * 1024) throw new Error('Invalid evidence content')
  return withLock(root, () => {
    if (!load(root, id)) throw new Error('Goal not found')
    const path = join(folder(root, id), evidence)
    safePath(path)
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { writeFileSync(fd, content); fsyncSync(fd) } finally { closeSync(fd) }
    return evidence
  })
}
