import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Circle, ExternalLink, FolderOpen, MessageCircleQuestion, Pause, Play, Send, Square, X } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { useNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { cn } from '@/lib/utils'
import { GOAL_OWNER_TOOL_ACCESS, type Goal, type GoalUserAction } from '@craft-agent/shared/goals/types'
import { GoalStatus } from './GoalStatus'
import { canPause, canStop, verifiedCount } from './goal-model'
import { errorMessage } from './useGoals'

interface GoalDetailProps {
  goal: Goal
  onAction(action: GoalUserAction): Promise<Goal>
  onBack(): void
}

export function GoalDetail({ goal, onAction, onBack }: GoalDetailProps) {
  const { t, i18n } = useTranslation()
  const { navigate } = useNavigation()
  const { onOpenFile } = useAppShellContext()
  const sessions = useAtomValue(sessionMetaMapAtom)
  const [answer, setAnswer] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmStop, setConfirmStop] = React.useState(false)
  const pending = React.useRef(false)
  const fields = React.useId()
  const waiting = goal.state === 'waiting_on_user'

  const date = (value?: string) => {
    if (!value || !Number.isFinite(Date.parse(value))) return t('goals.notYet', { defaultValue: 'Not yet' })
    return new Date(value).toLocaleString(i18n.language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  async function act(action: GoalUserAction) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await onAction(action)
      if (action.type === 'answer') setAnswer('')
      setConfirmStop(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const sessionLink = (id: string, label?: string) => (
    <button type="button" className="text-label text-secondary hover:text-accent inline-flex items-center gap-1.5 max-w-full min-w-0 text-left rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => navigate(routes.view.allSessions(id))} title={id}>
      <span className="truncate">{label || sessions.get(id)?.name || id}</span><ExternalLink className="size-3 shrink-0" />
    </button>
  )
  const property = (label: string, value: React.ReactNode) => <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3 py-2"><dt className="text-tertiary">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>
  const linkedSessions = [...new Set([goal.ownerSessionId, goal.verifierSessionId, ...goal.activity.map(item => item.sessionId)].filter((id): id is string => Boolean(id)))]
  const resumable = goal.state === 'paused' || goal.state === 'blocked'
  const draft = goal.state === 'draft'

  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelHeader titleRow={<nav aria-label={t('goals.breadcrumb', { defaultValue: 'Breadcrumb' })} className="flex items-center gap-2 text-label min-w-0"><button type="button" className="text-tertiary hover:text-foreground rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent shrink-0" onClick={onBack}>{t('goals.title', { defaultValue: 'Goals' })}</button><ChevronRight className="size-3 text-tertiary shrink-0" /><span className="truncate">{goal.title}</span></nav>} actions={
        (canPause(goal.state) || resumable || draft) && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void act({ type: resumable ? 'resume' : draft ? 'start' : 'pause' })}>{resumable || draft ? <Play /> : <Pause />}{resumable ? t('goals.resume', { defaultValue: 'Resume' }) : draft ? t('goals.start', { defaultValue: 'Start goal' }) : t('goals.pause', { defaultValue: 'Pause' })}</Button>
      } />
      <div className="overflow-y-auto flex-1 min-h-0 @container">
        <div className="max-w-[1100px] mx-auto px-5 sm:px-8 py-8 grid grid-cols-1 @min-[740px]:grid-cols-[minmax(0,1fr)_250px] gap-10 @min-[740px]:gap-12">
          <main className="min-w-0 space-y-9">
            <header>
              <GoalStatus state={goal.state} className="mb-3" />
              <h1 className="text-2xl font-semibold tracking-tight break-words">{goal.title}</h1>
              {goal.description && <p className="text-label text-secondary mt-3 whitespace-pre-wrap break-words leading-relaxed">{goal.description}</p>}
            </header>

            {GOAL_OWNER_TOOL_ACCESS === 'goal-only' && <p className="text-label text-secondary rounded-lg border border-border-subtle p-4">{t('goals.ownerToolLimit', { defaultValue: 'Goal sessions can read and record evidence and ask questions. Use a separate chat for project edits, shell commands, or connected sources.' })}</p>}

            {error && <p role="alert" className="text-label text-destructive bg-destructive-tint rounded-lg p-3 whitespace-pre-wrap break-words">{error}</p>}
            {busy && <p role="status" className="sr-only">{t('goals.saving', { defaultValue: 'Saving…' })}</p>}

            {waiting && <section className="rounded-lg border border-[var(--info-border)] bg-info-tint p-5 space-y-4" aria-labelledby={`${fields}-question-heading`}>
              <div className="flex gap-3">
                <MessageCircleQuestion className="size-5 text-info shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h2 id={`${fields}-question-heading`} className="text-label font-medium text-info">{t('goals.waiting', { defaultValue: 'Waiting on you' })}</h2>
                  <p className="text-label mt-2 whitespace-pre-wrap break-words">{goal.question?.text || t('goals.waitingFallback', { defaultValue: 'Your input is needed before this goal can continue.' })}</p>
                </div>
              </div>
              <form onSubmit={event => { event.preventDefault(); if (answer.trim()) void act({ type: 'answer', answer: answer.trim() }) }} className="space-y-3">
                <label htmlFor={`${fields}-answer`} className="sr-only">{t('goals.yourAnswer', { defaultValue: 'Your answer' })}</label>
                <Textarea id={`${fields}-answer`} placeholder={t('goals.answerPlaceholder', { defaultValue: 'Write your answer…' })} value={answer} onChange={event => setAnswer(event.target.value)} maxLength={20000} disabled={busy} className="min-h-24" />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-label-sm text-secondary">{t('goals.noChecksWaiting', { defaultValue: 'No checks while waiting for your answer.' })}</p>
                  <Button type="submit" size="sm" disabled={busy || !answer.trim()}><Send />{t('goals.sendAnswer', { defaultValue: 'Send answer' })}</Button>
                </div>
              </form>
            </section>}

            {goal.blockedReason && goal.state === 'blocked' && <p className="text-label text-destructive bg-destructive-tint rounded-lg p-4 whitespace-pre-wrap break-words">{goal.blockedReason}</p>}

            <section aria-labelledby={`${fields}-criteria-heading`}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 id={`${fields}-criteria-heading`} className="text-label-lg font-medium">{t('goals.doneWhen', { defaultValue: 'Done when' })}</h2>
                <span className="text-label-sm text-tertiary tabular-nums">{t('goals.verified', { defaultValue: '{{passed}}/{{total}} verified', passed: verifiedCount(goal), total: goal.criteria.length })}</span>
              </div>
              <ul className="divide-y divide-border-subtle">
                {goal.criteria.map(criterion => <li key={criterion.id} className="flex gap-3 py-4">
                  <span className={cn('mt-0.5 shrink-0', criterion.status === 'pass' ? 'text-success' : criterion.status === 'fail' ? 'text-destructive' : 'text-tertiary')}>
                    {criterion.status === 'pass' ? <Check className="size-4" /> : criterion.status === 'fail' ? <X className="size-4" /> : <Circle className="size-4" />}
                    <span className="sr-only">{criterion.status === 'pass' ? t('goals.criterionPass', { defaultValue: 'Verified' }) : criterion.status === 'fail' ? t('goals.criterionFail', { defaultValue: 'Verification failed' }) : t('goals.criterionPending', { defaultValue: 'Not verified' })}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-label whitespace-pre-wrap break-words">{criterion.text}</p>
                    {criterion.note && <p className="text-label-sm text-tertiary mt-2 whitespace-pre-wrap break-words">{criterion.note}</p>}
                    {criterion.evidence && <details className="mt-2 text-label-sm"><summary className="text-secondary cursor-pointer w-fit">{t('goals.evidence', { defaultValue: 'Verification evidence' })}</summary><p className="mt-2 text-tertiary whitespace-pre-wrap break-words">{criterion.evidence}</p>{/^evidence\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(criterion.evidence) && <Button variant="link" size="sm" className="mt-2" onClick={() => { setError(null); onOpenFile(`${goal.folderPath}/${criterion.evidence}`) }}>{t('goals.openEvidence', { defaultValue: 'Open evidence file' })}<ExternalLink className="size-3" /></Button>}</details>}
                  </div>
                </li>)}
              </ul>
              <p className="text-label-sm text-tertiary mt-3">{t('goals.independentVerification', { defaultValue: 'Only independent server verification can mark this goal done.' })}</p>
              {(goal.state === 'active' || (goal.state === 'blocked' && goal.ownerSessionId)) && <Button variant="secondary" size="sm" className="mt-3" disabled={busy} onClick={() => void act({ type: 'verify' })}>{t('goals.requestVerification', { defaultValue: 'Request verification' })}</Button>}
            </section>

            <section aria-labelledby={`${fields}-activity-heading`}>
              <h2 id={`${fields}-activity-heading`} className="text-label-lg font-medium mb-5">{t('goals.activity', { defaultValue: 'Activity' })}</h2>
              {!goal.activity.length ? <p className="text-label text-tertiary">{t('goals.noActivity', { defaultValue: 'No activity yet.' })}</p> : <ol className="ml-1.5 border-l border-border-subtle space-y-6">
                {goal.activity.map(item => <li key={item.id} className="relative pl-5">
                  <span className="absolute -left-[3px] top-1.5 size-[5px] rounded-full bg-[var(--text-tertiary)] ring-4 ring-paper" />
                  <p className="text-label text-secondary whitespace-pre-wrap break-words">{item.message}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5"><time className="text-label-sm text-tertiary" dateTime={item.at} title={item.at}>{date(item.at)}</time>{item.sessionId && sessionLink(item.sessionId)}</div>
                </li>)}
              </ol>}
            </section>
          </main>

          <aside className="min-w-0 space-y-8 @min-[740px]:border-l @min-[740px]:border-border-subtle @min-[740px]:pl-6">
            <section aria-labelledby={`${fields}-properties-heading`}>
              <h2 id={`${fields}-properties-heading`} className="text-label font-medium mb-3">{t('goals.properties', { defaultValue: 'Properties' })}</h2>
              <dl className="text-label-sm">
                {property(t('goals.stateLabel', { defaultValue: 'State' }), <GoalStatus state={goal.state} className="text-label-sm" />)}
                {property(t('goals.owner', { defaultValue: 'Owner session' }), goal.ownerSessionId ? sessionLink(goal.ownerSessionId) : <span className="text-tertiary">{t('goals.unassigned', { defaultValue: 'Unassigned' })}</span>)}
                {property(t('goals.nextWake', { defaultValue: 'Next wake' }), waiting ? t('goals.noChecks', { defaultValue: 'No checks while waiting' }) : goal.state === 'paused' || goal.state === 'stopped' || goal.state === 'done' ? t('goals.notScheduled', { defaultValue: 'Not scheduled' }) : goal.nextWakeAt ? date(goal.nextWakeAt) : t('goals.notScheduled', { defaultValue: 'Not scheduled' }))}
                {property(t('goals.lastChecked', { defaultValue: 'Last checked' }), date(goal.lastCheckedAt))}
                {property(t('goals.heartbeat', { defaultValue: 'Check interval' }), t('goals.hours', { defaultValue: '{{count}} hours', count: goal.caps.heartbeatHours }))}
                {property(t('goals.wakesToday', { defaultValue: 'Wakes (UTC day)' }), <span title={goal.counters.utcDay} className="tabular-nums">{goal.counters.wakesToday} / {goal.caps.wakesPerDay}</span>)}
                {property(t('goals.sessionsCap', { defaultValue: 'Sessions used' }), <span className="tabular-nums">{goal.counters.sessions} / {goal.caps.sessions}</span>)}
              </dl>
            </section>
            <section aria-labelledby={`${fields}-sessions-heading`}>
              <h2 id={`${fields}-sessions-heading`} className="text-label font-medium mb-3">{t('goals.sessions', { defaultValue: 'Sessions' })}</h2>
              {linkedSessions.length ? <ul className="space-y-3">{linkedSessions.map(id => <li key={id} className="min-w-0">{sessionLink(id)}<p className="text-label-sm text-tertiary mt-0.5">{id === goal.ownerSessionId ? t('goals.ownerRole', { defaultValue: 'Owner' }) : id === goal.verifierSessionId ? t('goals.verifierRole', { defaultValue: 'Independent verifier' }) : t('goals.relatedRole', { defaultValue: 'Related session' })}</p></li>)}</ul> : <p className="text-label-sm text-tertiary">{t('goals.noSessions', { defaultValue: 'No sessions linked yet.' })}</p>}
            </section>
            <section aria-labelledby={`${fields}-files-heading`}>
              <h2 id={`${fields}-files-heading`} className="text-label font-medium mb-3">{t('goals.files', { defaultValue: 'Files' })}</h2>
              <Button variant="ghost" size="sm" className="-ml-2" disabled={!goal.folderPath || busy} title={goal.folderPath} onClick={() => { setError(null); onOpenFile(goal.folderPath) }}><FolderOpen />{t('goals.openFolder', { defaultValue: 'Open goal folder' })}</Button>
            </section>
            {canStop(goal.state) && <div className="pt-2 border-t border-border-subtle"><Button variant="danger" size="sm" className="-ml-2 mt-3" disabled={busy} onClick={() => setConfirmStop(true)}><Square />{t('goals.stop', { defaultValue: 'Stop goal' })}</Button></div>}
          </aside>
        </div>
      </div>
      <Dialog open={confirmStop} onOpenChange={value => { if (!busy) setConfirmStop(value) }}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader><DialogTitle>{t('goals.stopConfirm', { defaultValue: 'Stop this goal?' })}</DialogTitle><DialogDescription>{t('goals.stopHint', { defaultValue: 'Stop further work and checks. The goal, evidence and activity will stay available.' })}</DialogDescription></DialogHeader>
          {error && <p role="alert" className="text-label text-destructive break-words">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setConfirmStop(false)}>{t('goals.cancel', { defaultValue: 'Cancel' })}</Button><Button variant="danger-solid" disabled={busy} onClick={() => void act({ type: 'stop' })}>{busy ? t('goals.stopping', { defaultValue: 'Stopping…' }) : t('goals.stop', { defaultValue: 'Stop goal' })}</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
