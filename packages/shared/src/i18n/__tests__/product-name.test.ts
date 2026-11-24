import { describe, expect, it } from 'bun:test'
import { buildI18nResources } from '../setupI18n'

describe('fork product name in UI copy', () => {
  it('keeps upstream copy unchanged by default', () => {
    const en = buildI18nResources().en!.translation as Record<string, string>
    expect(en['menu.quitCraftAgents']).toBe('Quit Craft Agents')
  })
  it('renames the product in every locale for a fork', () => {
    const resources = buildI18nResources('Veto Agents')
    const en = resources.en!.translation as Record<string, string>
    expect(en['menu.quitCraftAgents']).toBe('Quit Veto Agents')
    expect(en['chat.newChatSubtitle']).toContain('Veto Agents')
    expect(JSON.stringify(resources)).not.toContain('Craft Agents')
  })
})
