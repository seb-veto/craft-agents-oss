import { describe, expect, test } from 'bun:test'
import { selectableModelOptions } from '../model-options'

const hidden = [
  'gpt-5.3-codex-spark', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra',
  'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol', 'claude-haiku-5-5', 'claude-fable-5-1',
  'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-opus-4-8',
  'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001',
]
const kept = ['gpt-6.1-sol', 'gpt-6.2-sol', 'claude-fable-5-2', 'claude-sonnet-5-5', 'claude-opus-5-5']

describe('selectableModelOptions', () => {
  test('removes every highlighted model, bare or Pi-prefixed', () => {
    expect(selectableModelOptions(hidden)).toEqual([])
    expect(selectableModelOptions(hidden.map(id => `pi/${id}`))).toEqual([])
  })
  test('keeps the unmarked models in their original order', () => {
    expect(selectableModelOptions([...hidden, ...kept])).toEqual(kept)
    expect(selectableModelOptions(kept.map(id => `pi/${id}`))).toEqual(kept.map(id => `pi/${id}`))
  })
  test('preserves metadata, unknown/custom models, and the original runtime array', () => {
    const retained = { id: 'pi/gpt-6.2-sol', name: 'GPT-6.2 Sol', shortName: 'Sol', description: 'Current', provider: 'pi' as const, contextWindow: 272000 }
    const source = Object.freeze([retained, 'pi/gpt-6-luna', 'custom-model', 'gpt-6.3-sol'])
    expect(selectableModelOptions(source)).toEqual([retained, 'custom-model', 'gpt-6.3-sol'])
    expect(selectableModelOptions(source)[0]).toBe(retained)
    expect(source).toContain('pi/gpt-6-luna')
  })
  test('provider refresh cannot restore hidden choices', () => {
    const refreshed = [...kept, ...hidden].map(id => ({ id, name: id, shortName: id, description: '', provider: 'pi' as const, contextWindow: 1000000 }))
    expect(selectableModelOptions(refreshed).map(m => m.id)).toEqual(kept)
  })
  test('handles empty lists', () => expect(selectableModelOptions([])).toEqual([]))
})
