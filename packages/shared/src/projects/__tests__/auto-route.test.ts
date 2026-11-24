import { describe, expect, it } from 'bun:test'
import { chooseProjectForMessage } from '../auto-route.ts'
import type { ProjectConfig } from '../types.ts'

const project = (name: string, extra: Partial<ProjectConfig> = {}): ProjectConfig => ({
  id: name.toLowerCase(), slug: name.toLowerCase(), name, createdAt: 1, updatedAt: 1, ...extra,
})
const projects = [project('Growth'), project('Operations'), project('Product')]

describe('local project routing', () => {
  it.each([
    ['Write a cold email campaign for new prospects', 'growth'],
    ['Improve SEO and conversion on the landing page', 'growth'],
    ['Build a lead generation pipeline', 'growth'],
    ['Fix the Craft Agents sidebar', 'operations'],
    ['Connect an MCP server and configure agent skills', 'operations'],
    ['Reconcile invoices and payroll', 'operations'],
    ['Fix the checkout bug in our app', 'product'],
    ['Design the onboarding UI and improve accessibility', 'product'],
    ['Add unit tests for the database migration', 'product'],
    ['Create a product launch marketing campaign', 'growth'],
  ])('routes %s to %s', (message, id) => {
    expect(chooseProjectForMessage(message, projects)).toBe(id)
  })

  it.each(['Hello', 'Can you help?', 'What do you think?', 'Product growth operations', 'configuration', 'reproduction'])('leaves weak or ambiguous requests alone: %s', message => {
    expect(chooseProjectForMessage(message, projects)).toBeNull()
  })
  it('leaves a close cross-project tie unassigned', () => {
    expect(chooseProjectForMessage('SEO campaign and payroll invoices', projects)).toBeNull()
  })
  it('matches whole words, never substrings', () => {
    expect(chooseProjectForMessage('Reproduction and configuration', projects)).toBeNull()
  })
  it('does not inflate repeated evidence', () => {
    expect(chooseProjectForMessage('product '.repeat(100), projects)).toBeNull()
  })
  it('only chooses an active project in this workspace', () => {
    expect(chooseProjectForMessage('SEO campaign', [project('Product')])).toBeNull()
    expect(chooseProjectForMessage('SEO campaign', [project('Growth', { archivedAt: 2 })])).toBeNull()
    expect(chooseProjectForMessage('SEO campaign', [])).toBeNull()
  })
  it('supports custom project names and Unicode', () => {
    expect(chooseProjectForMessage('Plan the café renovation', [project('Café Renovation'), project('Garden')])).toBe('café renovation')
  })
  it('uses distinctive description terms for other project names', () => {
    const custom = [project('Orchard', { description: 'Apples, pears, irrigation and harvest' }), project('Garage', { details: 'Engines and transmission repair' })]
    expect(chooseProjectForMessage('Plan irrigation for the apple harvest', custom)).toBe('orchard')
  })
  it('does not count terms shared by every description', () => {
    const custom = [project('One', { description: 'Important work planning' }), project('Two', { description: 'Important work planning' })]
    expect(chooseProjectForMessage('Important work planning', custom)).toBeNull()
  })
  it('does not resolve duplicate names or score ties by list order', () => {
    const custom = [project('Atlas', { id: 'a' }), project('Atlas', { id: 'b' })]
    expect(chooseProjectForMessage('Fix Atlas', custom)).toBeNull()
    expect(chooseProjectForMessage('Fix Atlas', custom.toReversed())).toBeNull()
  })
})
