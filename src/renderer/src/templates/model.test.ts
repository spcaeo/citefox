import { describe, expect, test } from 'vitest'
import { formatMoment } from '../utils/dates'
import { SHIPPED_TEMPLATE_NAME, type GenerationTemplate } from '@shared/domain'
import { TEMPLATE_ERROR_MESSAGES, type TemplateUsage } from '@shared/ipc'
import {
  compareBlockReason,
  compareRunRequest,
  deletedCountLabel,
  deleteBlockedReason,
  formatLastUsed,
  pageGenerationRequest,
  singleRunRequest,
  suggestedDuplicateName,
  templateCountLabel,
  templatesOfKind,
  toggleCompareId,
  usageCountsMatch,
  usageLine,
  usageTotal
} from './model'

function template(
  id: string,
  kind: GenerationTemplate['kind'],
  extra: Partial<GenerationTemplate> = {}
): GenerationTemplate {
  return {
    id,
    kind,
    name: SHIPPED_TEMPLATE_NAME,
    notes: null,
    body: '{{ url }}',
    isShipped: true,
    isDefault: true,
    templateHash: 'ab'.repeat(32),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: null,
    version: 1,
    deletedAt: null,
    variables: ['url'],
    warnings: [],
    settings: { model: null, language: null, promptCount: null, tone: null },
    ...extra
  }
}

const rows = [
  template('buyer-profile', 'buyer_profile'),
  template('night', 'buyer_profile', {
    name: 'Nightly buyer',
    isShipped: false,
    isDefault: false,
    deletedAt: '2026-10-19T00:00:00.000Z'
  }),
  template('buyer-prompts', 'buyer_prompts'),
  template('coverage', 'coverage')
]

describe('named template model', () => {
  test('kind lists and the deleted count match the rows', () => {
    const live = templatesOfKind(rows, 'buyer_profile', false)
    const deleted = templatesOfKind(rows, 'buyer_profile', true)
    expect(live.map((item) => item.id)).toEqual(['buyer-profile'])
    expect(templateCountLabel(live.length)).toBe('1 template')
    expect(deleted).toHaveLength(1)
    expect(deletedCountLabel(deleted.length)).toBe('Deleted (1)')
    expect(templateCountLabel(0)).toBe('0 templates')
  })

  test('usage total equals the three counts that are shown', () => {
    const usage: TemplateUsage = {
      templateId: 'buyer-profile',
      buyerProfiles: 2,
      promptSets: 1,
      coverageMatrices: 0,
      lastUsedAt: '2026-10-19T12:00:00.000Z'
    }
    expect(usageTotal(usage)).toBe(3)
    expect(usageCountsMatch(usage)).toBe(true)
    expect(formatLastUsed(usage.lastUsedAt)).toBe(`Last used ${formatMoment(usage.lastUsedAt)}`)
    expect(formatLastUsed(null)).toBe('Not used yet')
    expect(usageLine('buyer_profile', { ...usage, buyerProfiles: 0, lastUsedAt: null })).toBe(
      '0 buyer profiles · Not used yet'
    )
    expect(usageLine('buyer_profile', usage)).toBe(
      `2 buyer profiles · Last used ${formatMoment(usage.lastUsedAt)}`
    )
    expect(usageLine('buyer_prompts', { ...usage, promptSets: 1 })).toBe(
      `1 prompt set · Last used ${formatMoment(usage.lastUsedAt)}`
    )
    expect(usageLine('coverage', usage)).toBe(
      `0 coverage matrices · Last used ${formatMoment(usage.lastUsedAt)}`
    )
  })

  test('blocks delete on the shipped row and on the default', () => {
    const shipped = rows[0]
    const custom = template('field', 'buyer_profile', {
      name: 'Field',
      isShipped: false,
      isDefault: true
    })
    const spare = template('spare', 'buyer_profile', {
      name: 'Spare',
      isShipped: false,
      isDefault: false
    })
    if (!shipped) return
    expect(deleteBlockedReason(shipped)).toBe(TEMPLATE_ERROR_MESSAGES.shipped_readonly)
    expect(deleteBlockedReason(custom)).toBe(TEMPLATE_ERROR_MESSAGES.default_in_use)
    expect(deleteBlockedReason(spare)).toBeNull()
  })

  test('suggests a duplicate name inside the length limit', () => {
    expect(suggestedDuplicateName('CiteFox default')).toBe('Copy of CiteFox default')
    expect(suggestedDuplicateName(` ${'n'.repeat(80)} `)).toHaveLength(80)
  })

  test('compare stays between 1 and 3 and a single run omits templateIds', () => {
    expect(compareBlockReason(0)).toBe('Pick 1 to 3 templates of one kind.')
    expect(compareBlockReason(3)).toBeNull()
    expect(compareBlockReason(4)).toBe(TEMPLATE_ERROR_MESSAGES.compare_limit)
    const blocked = toggleCompareId(['a', 'b', 'c'], 'd')
    expect(blocked.ids).toEqual(['a', 'b', 'c'])
    expect(blocked.error).toBe(TEMPLATE_ERROR_MESSAGES.compare_limit)
    expect(toggleCompareId(['a', 'b'], 'a').ids).toEqual(['b'])
    const single = singleRunRequest({
      url: 'https://textbolt.com',
      templateId: 'buyer-profile',
      overrides: null
    })
    expect(single.templateIds).toBeUndefined()
    expect(single.templateId).toBe('buyer-profile')
    const compare = compareRunRequest({
      url: 'https://textbolt.com',
      templateIds: ['a', 'b', 'c'],
      overrides: null
    })
    expect(compare.templateId).toBeUndefined()
    expect(compare.templateIds).toEqual(['a', 'b', 'c'])
  })

  test('an empty picker omits templateId', () => {
    expect(pageGenerationRequest('textbolt', 'alerts', '')).toEqual({
      projectId: 'textbolt',
      pageId: 'alerts'
    })
    expect(pageGenerationRequest('textbolt', 'alerts', 'night')).toEqual({
      projectId: 'textbolt',
      pageId: 'alerts',
      templateId: 'night'
    })
  })
})
