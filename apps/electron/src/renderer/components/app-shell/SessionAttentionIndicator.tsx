import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { SessionAttention } from '@/utils/session-attention'

const STYLES: Record<Exclude<SessionAttention, 'idle'>, string> = {
  'needs-you': 'bg-info-solid rounded-sm',
  running: 'bg-foreground/70 rounded-full motion-safe:animate-pulse',
  failed: 'bg-destructive-solid rotate-45 rounded-[1px]',
  'plan-ready': 'border-2 border-success rounded-full',
  'result-ready': 'bg-success-solid rounded-full',
}

/** Separate from the clickable workflow glyph: color + shape + accessible name. */
export function SessionAttentionIndicator({ state }: { state: SessionAttention }) {
  const { t } = useTranslation()
  if (state === 'idle') return null
  const label = t(`session.attention.${state}`)
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center" role="img" aria-label={label} title={label} data-attention={state}>
      <span aria-hidden="true" className={cn('size-2.5 shrink-0', STYLES[state])} />
    </span>
  )
}
