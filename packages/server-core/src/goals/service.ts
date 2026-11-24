import { activity, createGoal, getGoal, getGoals, updateGoal, writeGoalEvidence, assertGoalEvidence } from '@craft-agent/shared/goals'
import { criterionResultsSchema, goalMessageSchema, sessionIdSchema, userActionSchema } from '@craft-agent/shared/goals'
import type { CreateGoalInput, Goal, GoalCriterionResult, GoalUserAction } from '@craft-agent/shared/goals/types'

/** All create methods must create IDLE sessions. Verifiers must be fresh, unbranched, independent sessions.
 * wakeSession must validate workspace ownership and await message admission, not the full model turn.
 * cancelSession must stop goal work (including child work) when the human pauses/stops the goal.
 * None of these methods may interpret goal content as permissions or expand the user's budget. */
export interface GoalRuntime {
  createOwner(goal: Goal): Promise<string>
  createVerifier(goal: Goal): Promise<string>
  wakeSession(goal: Goal, sessionId: string, message: string, signal: AbortSignal): Promise<void>
  cancelSession(goal: Goal, sessionId: string): Promise<void>
}

const RUNNING = new Set<Goal['state']>(['active', 'verifying'])
const TERMINAL = new Set<Goal['state']>(['done', 'stopped'])
const RUNTIME_UNAVAILABLE = 'Automatic execution is unavailable: the host has not connected the Goals session runtime.'

export class GoalService {
  private listeners = new Set<(goals: Goal[]) => void>()
  private dispatching = new Set<string>()
  private dispatchSignals = new Map<string, AbortController>()

  constructor(
    readonly root: string,
    private runtime: () => GoalRuntime | undefined = () => undefined,
    private clock: () => Date = () => new Date(),
  ) {}

  private visible(goal: Goal): Goal {
    const today = this.clock().toISOString().slice(0, 10)
    if (goal.counters.utcDay !== today) goal.counters = { ...goal.counters, utcDay: today, wakesToday: 0 }
    return goal
  }
  list(): Goal[] { return getGoals(this.root).map(goal => this.visible(goal)) }
  get(id: string): Goal | null {
    const goal = getGoal(this.root, id)
    return goal ? this.visible(goal) : null
  }
  create(input: CreateGoalInput): Goal {
    const goal = createGoal(this.root, input, this.clock())
    this.emit()
    return goal
  }
  subscribe(listener: (goals: Goal[]) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private emit(): void {
    if (!this.listeners.size) return
    const goals = this.list()
    // A broken event sink must not turn a committed operation into an apparent failure.
    for (const listener of this.listeners) { try { listener(goals) } catch { /* RPC client may have disconnected. */ } }
  }
  private require(id: string): Goal {
    const goal = this.get(id)
    if (!goal) throw new Error('Goal not found')
    return goal
  }
  private change(goal: Goal, type: string, message: string, mutate: (goal: Goal) => void = () => {}, sessionId?: string): Goal {
    const now = this.clock()
    const result = updateGoal(this.root, goal.id, goal.revision, current => {
      mutate(current)
      current.activity.push(activity(type, message, now, sessionId))
    }, now)
    this.emit()
    return this.visible(result)
  }
  private block(goal: Goal, reason: string): Goal {
    return this.change(goal, 'blocked', reason, current => {
      current.state = 'blocked'
      current.blockedReason = reason
      delete current.nextWakeAt
    })
  }

  /** Renderer/human boundary only. This method is intentionally absent from actor-bound callbacks. */
  async userAction(id: string, value: GoalUserAction): Promise<Goal> {
    const action = userActionSchema.parse(value)
    let goal = this.require(id)
    if (action.type === 'set_caps') {
      return this.change(goal, 'caps_changed', 'Human changed execution caps.', current => {
        current.caps = { ...current.caps, ...action.caps }
        if (current.nextWakeAt && current.lastCheckedAt) {
          current.nextWakeAt = new Date(Date.parse(current.lastCheckedAt) + current.caps.heartbeatHours * 3600000).toISOString()
        }
      })
    }
    if (action.type === 'pause' || action.type === 'stop') {
      if (TERMINAL.has(goal.state)) throw new Error('Goal is already terminal')
      this.dispatchSignals.get(id)?.abort()
      goal = this.change(goal, action.type, `Human ${action.type === 'pause' ? 'paused' : 'stopped'} the goal.`, current => {
        current.state = action.type === 'pause' ? 'paused' : 'stopped'
        delete current.nextWakeAt
        delete current.blockedReason
      })
      await this.cancel(goal)
      return this.require(id)
    }
    if (TERMINAL.has(goal.state)) throw new Error('Terminal goals cannot be restarted')
    if (action.type === 'answer') {
      if (goal.state !== 'waiting_on_user' || !goal.question) throw new Error('Goal is not waiting for an answer')
      goal = this.change(goal, 'answer', action.answer, current => {
        delete current.question
        current.state = 'active'
      })
      return this.dispatch(goal, 'owner', `Human answer:\n${action.answer}`)
    }
    if (action.type === 'verify') {
      if (!['active', 'blocked'].includes(goal.state)) throw new Error('Goal cannot enter verification from this state')
      return this.dispatch(goal, 'verifier')
    }
    if (action.type === 'start' && goal.state !== 'draft') throw new Error('Only a draft can be started')
    if (action.type === 'resume' && !['paused', 'blocked'].includes(goal.state)) throw new Error('Only a paused or blocked goal can be resumed')
    if (action.type === 'wake' && !RUNNING.has(goal.state)) throw new Error('Only a running goal can be woken')
    if (goal.question) {
      if (action.type === 'resume') return this.change(goal, 'resume', 'Human resumed the pending question.', current => {
        current.state = 'waiting_on_user'
        delete current.blockedReason
      })
      throw new Error('Answer the pending question before resuming')
    }
    return this.dispatch(goal, goal.state === 'verifying' ? 'existing_verifier' : 'owner')
  }

  private async cancel(goal: Goal): Promise<void> {
    const runtime = this.runtime()
    if (!runtime) return
    for (const id of new Set([goal.ownerSessionId, goal.verifierSessionId].filter((id): id is string => !!id))) {
      try { await runtime.cancelSession(goal, id) }
      catch {
        this.change(this.require(goal.id), 'cancel_failed', `The host could not confirm session ${id} stopped. Check the session manually.`)
      }
    }
  }

  private async dispatch(initial: Goal, mode: 'owner' | 'verifier' | 'existing_verifier', extra = ''): Promise<Goal> {
    if (this.dispatching.has(initial.id)) throw new Error('Goal dispatch already in progress')
    const runtime = this.runtime()
    if (!runtime) return this.block(initial, RUNTIME_UNAVAILABLE)
    if (mode !== 'owner' && !initial.ownerSessionId) throw new Error('Verification requires an owner session')
    this.dispatching.add(initial.id)
    const controller = new AbortController()
    this.dispatchSignals.set(initial.id, controller)
    let assignedId: string | undefined
    try {
      const today = this.clock().toISOString().slice(0, 10)
      const wakes = initial.counters.utcDay === today ? initial.counters.wakesToday : 0
      const needsSession = mode === 'verifier' || (mode === 'owner' && !initial.ownerSessionId)
      if (wakes >= initial.caps.wakesPerDay) return this.block(initial, 'Daily wake cap reached. A human may raise caps or resume on a later UTC day.')
      if (needsSession && initial.counters.sessions >= initial.caps.sessions) return this.block(initial, 'Session cap reached. Only a human may raise it.')
      // Reserve cost BEFORE external effects. An interrupted reservation stays blocked and is not retried automatically.
      let goal = this.change(initial, 'dispatch_reserved', `Reserved ${needsSession ? 'a session and ' : ''}one wake for ${mode}.`, current => {
        current.counters.utcDay = today
        current.counters.wakesToday = wakes + 1
        if (needsSession) current.counters.sessions++
        current.state = 'blocked'
        current.blockedReason = 'Dispatch pending or interrupted; no automatic retry. Resume explicitly if necessary.'
        delete current.nextWakeAt
      })
      let sessionId: string
      if (needsSession) {
        sessionId = sessionIdSchema.parse(await (mode === 'verifier' ? runtime.createVerifier(goal) : runtime.createOwner(goal)))
        assignedId = sessionId
        if (mode === 'verifier' && (sessionId === goal.ownerSessionId || goal.activity.some(a => a.sessionId === sessionId))) {
          throw new Error('Verifier must be a fresh session independent of the owner and earlier verifiers')
        }
      } else {
        sessionId = (mode === 'owner' ? goal.ownerSessionId : goal.verifierSessionId)!
        if (!sessionId) throw new Error('No verifier session to wake')
      }
      // Do not overwrite a pause/stop/progress that happened while the runtime was awaited.
      const fresh = this.require(goal.id)
      if (fresh.revision !== goal.revision) {
        if (assignedId) await runtime.cancelSession(fresh, assignedId)
        return fresh
      }
      goal = this.change(goal, 'session_assigned', `${mode === 'owner' ? 'Owner' : 'Independent verifier'} session assigned; waiting for host admission.`, current => {
        if (mode === 'owner') current.ownerSessionId = sessionId
        else current.verifierSessionId = sessionId
        if (mode === 'verifier') for (const criterion of current.criteria) {
          criterion.status = 'pending'
          delete criterion.evidence
          delete criterion.note
        }
        current.state = mode === 'owner' ? 'active' : 'verifying'
        delete current.blockedReason
      }, sessionId)
      const prompt = mode === 'owner'
        ? `Work on goal ${goal.id}. Read ${goal.folderPath}/GOAL.md. Call goal_get for the latest revision. Record progress and evidence, or ask one blocking question. Stop work after asking or requesting verification. Never self-certify done. ${extra}`
        : `Independently verify goal ${goal.id}. Read ${goal.folderPath}/GOAL.md and inspect the actual evidence. Call goal_get for the latest revision. Use your own checks, not the owner’s claims. Return one evidence-backed verdict per stable criterion using goal_verdict. Do not act as owner. ${extra}`
      await runtime.wakeSession(goal, sessionId, prompt, controller.signal)
      const admitted = this.require(goal.id)
      if (controller.signal.aborted) {
        await runtime.cancelSession(admitted, sessionId)
        return this.require(goal.id)
      }
      if (admitted.state !== goal.state) return admitted
      return this.change(admitted, 'session_dispatched', 'Host admitted the goal message; the turn has not been verified complete.', current => {
        const checkedAt = this.clock()
        current.lastCheckedAt = checkedAt.toISOString()
        current.nextWakeAt = new Date(checkedAt.getTime() + current.caps.heartbeatHours * 3600000).toISOString()
      }, sessionId)
    } catch {
      const latest = this.require(initial.id)
      // Runtime errors are redacted; they can contain provider credentials or prompts.
      if (RUNNING.has(latest.state) || latest.blockedReason?.startsWith('Dispatch pending')) {
        return this.block(latest, 'Host session dispatch failed. No automatic retry; inspect the session and resume explicitly.')
      }
      return latest
    } finally {
      this.dispatching.delete(initial.id)
      this.dispatchSignals.delete(initial.id)
    }
  }

  /** Host supplies the actual authenticated session identity, never tool arguments or renderer input. */
  forSession(actualSessionId: string) {
    const sessionId = sessionIdSchema.parse(actualSessionId)
    const actor = (id: string, revision: number, role: 'owner' | 'verifier'): Goal => {
      const goal = this.require(id)
      if (goal.revision !== revision) throw new Error('Goal revision conflict; reload before retrying')
      if ((role === 'owner' ? goal.ownerSessionId : goal.verifierSessionId) !== sessionId) throw new Error('Session is not the goal actor')
      if (role === 'owner' ? goal.state !== 'active' : goal.state !== 'verifying') throw new Error('Goal is not accepting updates from this actor')
      return goal
    }
    return {
      get: (id: string): Goal => {
        const goal = this.require(id)
        if (goal.ownerSessionId !== sessionId && goal.verifierSessionId !== sessionId) throw new Error('Session is not a goal actor')
        return goal
      },
      progress: (id: string, revision: number, message: string): Goal => {
        const goal = actor(id, revision, 'owner')
        return this.change(goal, 'progress', goalMessageSchema.parse(message), () => {}, sessionId)
      },
      ask: (id: string, revision: number, question: string): Goal => {
        const goal = actor(id, revision, 'owner')
        const text = goalMessageSchema.parse(question)
        return this.change(goal, 'question', text, current => {
          current.state = 'waiting_on_user'
          current.question = { text, askedAt: this.clock().toISOString() }
          delete current.nextWakeAt
        }, sessionId)
      },
      evidence: (id: string, revision: number, name: string, content: string): string => {
        const goal = this.require(id)
        actor(id, revision, goal.state === 'verifying' ? 'verifier' : 'owner')
        return writeGoalEvidence(this.root, id, name, content)
      },
      requestVerification: async (id: string, revision: number): Promise<Goal> => {
        const goal = actor(id, revision, 'owner')
        return this.dispatch(goal, 'verifier')
      },
      verdict: (id: string, revision: number, value: GoalCriterionResult[], message: string): Goal => {
        const goal = actor(id, revision, 'verifier')
        const results = criterionResultsSchema.parse(value)
        const text = goalMessageSchema.parse(message)
        if (results.length !== goal.criteria.length || new Set(results.map(r => r.id)).size !== results.length
          || results.some(r => !goal.criteria.some(c => c.id === r.id))) throw new Error('Verdict must cover every criterion exactly once')
        for (const result of results) assertGoalEvidence(this.root, id, result.evidence)
        return this.change(goal, 'verdict', text, current => {
          for (const result of results) Object.assign(current.criteria.find(c => c.id === result.id)!, result)
          current.state = results.every(r => r.status === 'pass') ? 'done' : 'blocked'
          if (current.state === 'blocked') current.blockedReason = 'Independent verification failed. Review evidence and resume owner work explicitly.'
          else delete current.blockedReason
          delete current.nextWakeAt
          current.lastCheckedAt = this.clock().toISOString()
        }, sessionId)
      },
    }
  }

  /** Explicit host scheduler seam. No timer, model call or workspace scan is started by importing this module. */
  async tick(signal?: AbortSignal, limit = 10): Promise<void> {
    let attempted = 0
    const due = this.list().filter(goal => goal.nextWakeAt && RUNNING.has(goal.state))
      .sort((a, b) => a.nextWakeAt!.localeCompare(b.nextWakeAt!))
    for (const goal of due) {
      if (signal?.aborted || attempted >= limit) return
      if (this.dispatching.has(goal.id) || this.get(goal.id)?.revision !== goal.revision) continue
      if (RUNNING.has(goal.state) && goal.nextWakeAt && Date.parse(goal.nextWakeAt) <= this.clock().getTime()) {
        attempted++
        await this.dispatch(goal, goal.state === 'verifying' ? 'existing_verifier' : 'owner')
      }
    }
  }

  /** Call once during host startup, before accepting Goals work. Never silently relaunch persisted sessions. */
  recoverInterrupted(): Goal[] {
    for (const goal of this.list()) {
      if (RUNNING.has(goal.state)) this.block(goal, 'Host restarted. Session execution is unconfirmed; resume explicitly after checking the linked session.')
    }
    return this.list()
  }
}

let runtime: { adapter: GoalRuntime; accepts: (root: string) => boolean } | undefined
const services = new Map<string, GoalService>()
/** Host-only configuration; call before exposing agent callbacks. Does not start any work. */
export function configureGoalRuntime(value: GoalRuntime | undefined, accepts: (root: string) => boolean = () => true): () => void {
  const configured = value ? { adapter: value, accepts } : undefined
  runtime = configured
  return () => { if (runtime === configured) runtime = undefined }
}
export function getGoalService(workspaceRootPath: string): GoalService {
  let service = services.get(workspaceRootPath)
  if (!service) {
    service = new GoalService(workspaceRootPath, () => runtime?.accepts(workspaceRootPath) ? runtime.adapter : undefined)
    services.set(workspaceRootPath, service)
  }
  return service
}
