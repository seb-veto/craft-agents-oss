import { Circle, CircleCheck, CirclePause, CircleStop, CircleAlert, MessageCircleQuestion, ScanLine, Target } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { GoalState } from '@craft-agent/shared/goals/types'

const STATES = {
  draft: { label: 'Draft', icon: Circle, className: 'text-tertiary' },
  active: { label: 'Active', icon: Target, className: 'text-accent' },
  waiting_on_user: { label: 'Needs you', icon: MessageCircleQuestion, className: 'text-info' },
  verifying: { label: 'Verifying', icon: ScanLine, className: 'text-accent' },
  done: { label: 'Done', icon: CircleCheck, className: 'text-success' },
  paused: { label: 'Paused', icon: CirclePause, className: 'text-tertiary' },
  stopped: { label: 'Stopped', icon: CircleStop, className: 'text-tertiary' },
  blocked: { label: 'Blocked', icon: CircleAlert, className: 'text-destructive' },
} satisfies Record<GoalState, { label: string; icon: typeof Circle; className: string }>

export function GoalStatus({ state, iconOnly = false, className }: { state: GoalState; iconOnly?: boolean; className?: string }) {
  const { t } = useTranslation()
  const config = STATES[state]
  const Icon = config.icon
  const label = t(`goals.state.${state}`, { defaultValue: config.label })
  return <span className={cn('inline-flex items-center gap-2 text-label', config.className, className)} title={label}><Icon className="size-4 shrink-0" aria-hidden="true" />{iconOnly ? <span className="sr-only">{label}</span> : label}</span>
}
