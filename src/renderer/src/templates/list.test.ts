import { describe, expect, test } from 'vitest'
import { formatMoment } from '../utils/dates'
import type { GenerationTemplate } from '@shared/domain'
import {
  listLabel,
  statusCounts,
  templateVersionLine,
  templateWhen,
  visibleTemplates
} from './list'

function template(
  id: string,
  name: string,
  kind: GenerationTemplate['kind'],
  isDefault: boolean,
  updatedAt: string | null,
  version = 1
): GenerationTemplate {
  return {
    id,
    kind,
    name,
    notes: null,
    body: '{{ url }}',
    isShipped: updatedAt === null,
    isDefault,
    templateHash: 'ab'.repeat(32),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt,
    version,
    deletedAt: null,
    variables: ['url'],
    warnings: [],
    settings: { model: null, language: null, promptCount: null, tone: null }
  }
}

const items = [
  template('buyer-profile', 'Buyer profile', 'buyer_profile', true, null, 1),
  template('buyer-prompts', 'Buyer prompts', 'buyer_prompts', false, '2026-10-12T00:00:00.000Z', 3),
  template('coverage', 'Content gaps', 'coverage', false, '2026-10-19T00:00:00.000Z', 2)
]

describe('template list counts', () => {
  test('status counts add up to the templates on screen', () => {
    expect(statusCounts(items)).toEqual({ Default: 1, Edited: 2 })
    expect(statusCounts(items).Default + statusCounts(items).Edited).toBe(items.length)
    const edited = visibleTemplates(items, '', ['Edited'], 'edited', 'desc')
    expect(edited).toHaveLength(2)
    expect(listLabel(edited.length, items.length, true)).toBe('Showing 2 of 3 templates')
    expect(edited.map((item) => item.id)).toEqual(['coverage', 'buyer-prompts'])
  })

  test('search matches the file name and an empty result is zero rows', () => {
    expect(visibleTemplates(items, 'icp.md', [], 'run', 'asc').map((item) => item.name)).toEqual([
      'Buyer profile'
    ])
    expect(visibleTemplates(items, 'missing', [], 'name', 'asc')).toHaveLength(0)
    expect(listLabel(0, 3, true)).toBe('Showing 0 of 3 templates')
  })

  test('search matches a template name, and status filters narrow that result', () => {
    expect(
      visibleTemplates(items, 'content gaps', [], 'name', 'asc').map((item) => item.name)
    ).toEqual(['Content gaps'])
    expect(visibleTemplates(items, 'buyer', [], 'name', 'asc').map((item) => item.name)).toEqual([
      'Buyer profile',
      'Buyer prompts'
    ])
    const named = visibleTemplates(items, 'buyer', ['Default'], 'name', 'asc')
    expect(named.map((item) => item.name)).toEqual(['Buyer profile'])
    expect(listLabel(named.length, items.length, true)).toBe('Showing 1 of 3 templates')
    expect(visibleTemplates(items, '', ['Default', 'Edited'], 'run', 'asc')).toHaveLength(
      items.length
    )
  })

  test('the row shows the stored version, the short hash, and the when line', () => {
    const shipped = items[0]
    const edited = items[1]
    expect(shipped).toBeDefined()
    expect(edited).toBeDefined()
    if (!shipped || !edited) return
    expect(templateWhen(shipped)).toBe('—')
    expect(templateVersionLine(shipped)).toBe('v1 · abab…ab')
    expect(templateWhen(edited)).toBe(formatMoment('2026-10-12T00:00:00.000Z'))
    expect(templateVersionLine(edited)).toBe('v3 · abab…ab')
    expect(templateVersionLine(edited)).not.toContain('Oct')
  })
})
