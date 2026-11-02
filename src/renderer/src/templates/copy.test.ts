import { describe, expect, test } from 'vitest'
import { SHIPPED_TEMPLATE_NAME, type GenerationTemplate } from '@shared/domain'
import { templateFile } from './copy'

function template(
  id: string,
  kind: GenerationTemplate['kind'],
  shipped: boolean
): GenerationTemplate {
  return {
    id,
    kind,
    name: shipped ? SHIPPED_TEMPLATE_NAME : 'Nightly buyer',
    notes: null,
    body: '{{ url }}',
    isShipped: shipped,
    isDefault: shipped,
    templateHash: 'ab'.repeat(32),
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: shipped ? null : '2026-10-19T00:00:00.000Z',
    version: 1,
    deletedAt: null,
    variables: ['url'],
    warnings: [],
    settings: { model: null, language: null, promptCount: null, tone: null }
  }
}

describe('template file labels', () => {
  test('shipped and user templates share one file name per kind', () => {
    expect(templateFile(template('buyer-profile', 'buyer_profile', true))).toBe('icp.md')
    expect(templateFile(template('copy-buyer', 'buyer_profile', false))).toBe('icp.md')
    expect(templateFile(template('buyer-prompts', 'buyer_prompts', true))).toBe('buyer_prompts.md')
    expect(templateFile(template('copy-prompts', 'buyer_prompts', false))).toBe('buyer_prompts.md')
    expect(templateFile(template('coverage', 'coverage', true))).toBe('gap_matrix.md')
    expect(templateFile(template('copy-gaps', 'coverage', false))).toBe('gap_matrix.md')
  })
})
