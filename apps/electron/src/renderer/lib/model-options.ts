import type { ModelDefinition } from '@config/models'

// Hidden from choices only: keep registry/runtime support for existing sessions,
// utility completions and compaction. Provider refreshes must not restore these rows.
const HIDDEN_MODEL_IDS = new Set([
  'gpt-5.3-codex-spark',
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-6-astra',
  'gpt-6-luna',
  'gpt-6-sol',
  'claude-haiku-5-5',
  'claude-fable-5-1',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
])

/** Filter selectable choices, not the runtime catalog or saved session models. */
export function selectableModelOptions<T extends ModelDefinition | string>(models: readonly T[]): T[] {
  return models.filter(model => {
    const id = typeof model === 'string' ? model : model.id
    const bareId = id.startsWith('pi/') ? id.slice(3) : id
    return !HIDDEN_MODEL_IDS.has(bareId)
  })
}
