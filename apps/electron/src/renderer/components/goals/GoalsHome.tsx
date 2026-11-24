import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Target, ChevronRight } from 'lucide-react'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { GOAL_GROUPS, filterGoals, goalGroup, verifiedCount } from './goal-model'
import { GoalCreateDialog } from './GoalCreateDialog'
import { GoalDetail } from './GoalDetail'
import { GoalStatus } from './GoalStatus'
import { useGoals } from './useGoals'

const GROUP_LABELS = { needsYou: 'Needs you', needsAttention: 'Needs attention', active: 'Active', closed: 'Closed' }

export function GoalsHome({ workspaceId, goalId }: { workspaceId: string; goalId?: string }) {
  const { t } = useTranslation()
  const { navigate } = useNavigation()
  const { goals, loading, error, retry, create, act } = useGoals(workspaceId)
  const [query, setQuery] = React.useState('')
  const [assigned, setAssigned] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const visible = React.useMemo(() => filterGoals(goals, query, assigned), [goals, query, assigned])
  const selected = goalId ? goals.find(goal => goal.id === goalId) : undefined
  const openGoal = (id: string) => navigate(routes.view.goals(id))
  const back = () => navigate(routes.view.goals())

  if (goalId && selected) return <GoalDetail key={selected.id} goal={selected} onAction={action => act(selected.id, action)} onBack={back} />

  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelHeader title={t('goals.title', { defaultValue: 'Goals' })} actions={!goalId && <Button variant="secondary" size="sm" disabled={!workspaceId || loading || Boolean(error)} onClick={() => setCreating(true)}><Plus />{t('goals.new', { defaultValue: 'New goal' })}</Button>} />
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-[1000px] mx-auto px-5 sm:px-8 py-7">
          {loading ? (
            <p role="status" className="text-label text-tertiary py-16 text-center">{t('goals.loading', { defaultValue: 'Loading goals…' })}</p>
          ) : error ? (
            <div className="py-12 space-y-3 text-center">
              <p role="alert" className="text-label text-destructive whitespace-pre-wrap break-words">{error}</p>
              <Button variant="secondary" onClick={retry}>{t('goals.retry', { defaultValue: 'Try again' })}</Button>
            </div>
          ) : !workspaceId ? (
            <p className="text-label text-tertiary py-16 text-center">{t('goals.chooseWorkspace', { defaultValue: 'Choose a workspace to view goals.' })}</p>
          ) : goalId ? (
            <div className="py-16 text-center space-y-3">
              <p className="text-label text-tertiary">{t('goals.notFound', { defaultValue: 'This goal is not in this workspace.' })}</p>
              <Button variant="secondary" onClick={back}>{t('goals.back', { defaultValue: 'Back to Goals' })}</Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-7">
                <div className="flex items-center gap-1 p-1 rounded-lg bg-sunken" role="group" aria-label={t('goals.filter', { defaultValue: 'Filter goals' })}>
                  {[false, true].map(value => <Button key={String(value)} variant="ghost" size="sm" aria-pressed={assigned === value} className={cn(assigned === value && 'bg-raised shadow-elev-1')} onClick={() => setAssigned(value)}>{value ? t('goals.assigned', { defaultValue: 'Assigned' }) : t('goals.all', { defaultValue: 'All' })}</Button>)}
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-tertiary pointer-events-none" />
                  <Input type="search" aria-label={t('goals.search', { defaultValue: 'Search goals' })} placeholder={t('goals.search', { defaultValue: 'Search goals' })} value={query} onChange={event => setQuery(event.target.value)} className="pl-9 h-control" />
                </div>
              </div>
              {assigned && <p className="text-label-sm text-tertiary mb-5">{t('goals.assignedHint', { defaultValue: 'Goals with an owner session in this workspace.' })}</p>}
              {visible.length === 0 ? (
                <div className="py-20 text-center flex flex-col items-center gap-3">
                  <Target className="size-7 text-tertiary mb-1" />
                  <h2 className="text-label-lg font-medium">{goals.length ? t('goals.noMatches', { defaultValue: 'No matching goals' }) : t('goals.empty', { defaultValue: 'No goals yet' })}</h2>
                  <p className="text-label text-tertiary max-w-sm">{goals.length ? t('goals.changeFilters', { defaultValue: 'Try a different search or show all goals.' }) : t('goals.emptyHint', { defaultValue: 'Set an outcome, define what done means, and follow the work here.' })}</p>
                  {goals.length === 0 && <Button variant="secondary" className="mt-2" onClick={() => setCreating(true)}><Plus />{t('goals.new', { defaultValue: 'New goal' })}</Button>}
                </div>
              ) : GOAL_GROUPS.map(group => {
                const rows = visible.filter(goal => goalGroup(goal.state) === group)
                if (!rows.length) return null
                return <section key={group} className="mb-8" aria-label={t(`goals.group.${group}`, { defaultValue: GROUP_LABELS[group] })}>
                  <h2 className="text-label-sm font-medium text-secondary flex items-center gap-2 px-3 mb-2">{t(`goals.group.${group}`, { defaultValue: GROUP_LABELS[group] })}<span className="text-tertiary font-normal tabular-nums">{rows.length}</span></h2>
                  <ul className="divide-y divide-border-subtle">
                    {rows.map(goal => <li key={goal.id}>
                      <button type="button" className="group w-full flex items-center gap-3 px-3 py-4 text-left rounded-lg hover:bg-fill-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-press" onClick={() => openGoal(goal.id)}>
                        <GoalStatus state={goal.state} iconOnly className="self-start mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-label font-medium truncate">{goal.title}</h3>
                          <p className={cn('text-label-sm mt-1 truncate', goal.state === 'waiting_on_user' ? 'text-info' : 'text-tertiary')}>{goal.question?.text || goal.blockedReason || goal.description || t('goals.noDescription', { defaultValue: 'No description' })}</p>
                        </div>
                        <span className="text-label-sm text-tertiary tabular-nums shrink-0">{t('goals.verified', { defaultValue: '{{passed}}/{{total}} verified', passed: verifiedCount(goal), total: goal.criteria.length })}</span>
                        <ChevronRight className="size-3.5 text-tertiary opacity-0 group-hover:opacity-100 shrink-0" aria-hidden="true" />
                      </button>
                    </li>)}
                  </ul>
                </section>
              })}
            </>
          )}
        </div>
      </div>
      {creating && <GoalCreateDialog open onOpenChange={setCreating} onCreate={create} onCreated={goal => openGoal(goal.id)} />}
    </div>
  )
}
