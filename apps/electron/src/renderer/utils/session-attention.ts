import type { SessionMeta } from '../atoms/sessions'

export type SessionAttention = 'needs-you' | 'running' | 'failed' | 'plan-ready' | 'result-ready' | 'idle'

/** Live attention is NOT workflow status. A finished turn never completes a task. */
export function getSessionAttention(
  item: Pick<SessionMeta, 'isProcessing' | 'lastMessageRole' | 'hasUnread'>,
  hasPendingPrompt = false,
): SessionAttention {
  if (hasPendingPrompt) return 'needs-you'
  if (item.isProcessing) return 'running'
  if (item.lastMessageRole === 'error') return 'failed'
  if (item.lastMessageRole === 'plan') return 'plan-ready'
  if (item.hasUnread && item.lastMessageRole === 'assistant') return 'result-ready'
  return 'idle'
}
