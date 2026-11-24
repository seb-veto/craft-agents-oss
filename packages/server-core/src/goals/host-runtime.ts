import { dirname, join } from 'node:path'
import type { Goal } from '@craft-agent/shared/goals/types'
import { configureGoalRuntime, getGoalService, type GoalRuntime } from './service'

interface GoalWorkspace { id: string; rootPath: string; remoteServer?: unknown }
interface GoalHostDeps {
  workspaces(): GoalWorkspace[]
  create(workspace: GoalWorkspace, goal: Goal, role: 'owner' | 'verifier'): Promise<string>
  wake(workspace: GoalWorkspace, goal: Goal, sessionId: string, message: string, signal: AbortSignal): Promise<void>
  cancel(workspace: GoalWorkspace, goal: Goal, sessionId: string): Promise<void>
  warn(message: string): void
}

const TICK_MS = 60_000

/** Only this host's local, successfully recovered workspaces are eligible. */
export function startGoalHost(deps: GoalHostDeps, intervalMs = TICK_MS): () => void {
  const stopped = new AbortController()
  const recovered = new Map<string, string>()
  const localWorkspaces = () => deps.workspaces().filter(workspace => !workspace.remoteServer)
  function recover(workspace: GoalWorkspace): boolean {
    if (recovered.get(workspace.rootPath) === workspace.id) return true
    try {
      getGoalService(workspace.rootPath).recoverInterrupted()
      recovered.set(workspace.rootPath, workspace.id)
      return true
    } catch {
      deps.warn('A Goals workspace could not be recovered; automatic execution is disabled there.')
      return false
    }
  }
  for (const workspace of localWorkspaces()) recover(workspace)

  function workspaceOf(goal: Goal, cancelling = false): GoalWorkspace {
    if (!cancelling) stopped.signal.throwIfAborted()
    const root = dirname(dirname(goal.folderPath))
    const workspace = localWorkspaces().find(w => w.rootPath === root)
    if (!workspace || recovered.get(root) !== workspace.id || goal.folderPath !== join(root, 'goals', goal.id)) {
      throw new Error('Goals runtime is unavailable for this workspace')
    }
    return workspace
  }
  const runtime: GoalRuntime = {
    createOwner: goal => deps.create(workspaceOf(goal), goal, 'owner'),
    createVerifier: goal => deps.create(workspaceOf(goal), goal, 'verifier'),
    wakeSession: (goal, sessionId, message, signal) => {
      const combined = AbortSignal.any([stopped.signal, signal])
      combined.throwIfAborted()
      return deps.wake(workspaceOf(goal), goal, sessionId, message, combined)
    },
    cancelSession: (goal, sessionId) => deps.cancel(workspaceOf(goal, true), goal, sessionId),
  }
  const unconfigure = configureGoalRuntime(runtime, root => {
    if (stopped.signal.aborted) return false
    const workspace = localWorkspaces().find(w => w.rootPath === root)
    return !!workspace && recover(workspace)
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  async function run() {
    try {
      for (const workspace of localWorkspaces()) {
        if (stopped.signal.aborted) return
        if (!recover(workspace)) continue
        try { await getGoalService(workspace.rootPath).tick(stopped.signal, 10) }
        catch { deps.warn('A Goals scheduler pass failed; no extra attempts were started.') }
      }
    } catch { deps.warn('The Goals scheduler could not resolve local workspaces.') }
    finally { schedule() }
  }
  function schedule() {
    if (stopped.signal.aborted) return
    timer = setTimeout(() => void run(), intervalMs)
    timer.unref?.()
  }
  schedule()
  return () => { stopped.abort(); clearTimeout(timer); unconfigure() }
}
