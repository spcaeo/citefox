import { describe, expect, test } from 'vitest'
import {
  businessBlock,
  buyerBlock,
  competitorBlock,
  marketBlock,
  productBlock
} from '../prompts/blocks'
import { withValues } from './prompt'

/** The blocks for a project with almost nothing filled in yet. */
const SPARSE = [
  businessBlock({ domain: 'textbolt.com', summary: null, brandNames: [] }),
  productBlock(null),
  marketBlock({ country: 'US', language: 'en' }),
  buyerBlock({ who: ['Office managers'], environment: ['They send email'], triggers: [] }),
  competitorBlock({
    product: null,
    direct: [{ name: 'SimpleTexting', domain: 'simpletexting.com' }],
    partial: [],
    switchingFrom: [],
    integrations: []
  })
]

describe('withValues', () => {
  test('leaves out the context lines that have no value', () => {
    const lines = withValues(SPARSE)
    const text = lines.join('\n')
    for (const filler of [
      'What it does: not given',
      'Brand names: none given',
      'Product: not set',
      'Triggers: not known',
      'Partial overlap: none saved',
      'Buyers switch from these',
      'Tools used with it'
    ]) {
      expect(text).not.toContain(filler)
    }
    expect(lines).toContain('Business: textbolt.com.')
    expect(lines).toContain('Buyer: Office managers.')
    expect(lines).toContain('Environment: They send email.')
    expect(text).toContain('Market: United States (English).')
    expect(text).toMatch(/^Direct competitors of this business: SimpleTexting/mu)
    expect(lines.every((line) => line.trim().length > 0)).toBe(true)
  })

  test('the shared blocks the in-app prompts use still carry those lines', () => {
    const shared = SPARSE.join('\n')
    expect(shared).toContain('What it does: not given.')
    expect(shared).toContain('Product: not set; treat the business as a whole.')
    expect(shared).toContain('Triggers: not known.')
    expect(shared).toContain('Partial overlap: none saved.')
  })

  test('keeps a line whose value only starts like a missing one', () => {
    expect(withValues(['Buyer: Nonprofits that are not set up for texting yet.'])).toEqual([
      'Buyer: Nonprofits that are not set up for texting yet.'
    ])
  })
})
