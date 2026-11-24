import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreateGoalInput, Goal, GoalUserAction } from '@craft-agent/shared/goals/types'
import { mergeGoal } from './goal-model'
import type { ElectronAPI } from '../../../shared/types'

/** Goals methods of the typed ElectronAPI. Human controls only; agent callbacks are host-bound. */
type GoalsAPI = Pick<ElectronAPI, 'getGoals' | 'getGoal' | 'createGoal' | 'goalAction' | 'onGoalsChanged'>

export function useGoals(workspaceId: string) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    const request = ++generation.current
    let changed = false
    setGoals([])
    setLoading(true)
    setError(null)
    if (!workspaceId) {
      setLoading(false)
      return
    }
    const api = window.electronAPI
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = api.onGoalsChanged((changedWorkspace, next) => {
        if (changedWorkspace !== workspaceId || request !== generation.current) return
        changed = true
        setGoals(next)
        setLoading(false)
        setError(null)
      })
      void api.getGoals(workspaceId).then(next => {
        if (request === generation.current && !changed) setGoals(next)
      }).catch((cause: unknown) => {
        if (request === generation.current && !changed) setError(errorMessage(cause))
      }).finally(() => {
        if (request === generation.current) setLoading(false)
      })
    } catch (cause) {
      setError(errorMessage(cause))
      setLoading(false)
    }
    return () => { generation.current = request + 1; unsubscribe?.() }
  }, [workspaceId, reload])

  const run = useCallback(async (operation: (api: GoalsAPI) => Promise<Goal>) => {
    const request = generation.current
    const goal = await operation(window.electronAPI)
    if (request === generation.current) setGoals(current => mergeGoal(current, goal))
    return goal
  }, [])

  const create = useCallback((input: CreateGoalInput) => run(api => api.createGoal(workspaceId, input)), [workspaceId, run])
  const act = useCallback((goalId: string, action: GoalUserAction) => run(api => api.goalAction(workspaceId, goalId, action)), [workspaceId, run])
  const retry = useCallback(() => setReload(value => value + 1), [])
  return { goals, loading, error, retry, create, act }
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
