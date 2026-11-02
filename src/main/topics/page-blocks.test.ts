import { describe, expect, test } from 'vitest'
import { blocksForPrompt, blocksFromMarkdown, blocksFromText, MAX_PAGE_BLOCKS } from './page-blocks'

describe('blocksFromMarkdown', () => {
  test('headings, joined paragraphs, list items, quotes, code and tables in order', () => {
    const blocks = blocksFromMarkdown(
      [
        '# AT&T email to text alternative',
        '',
        'Carrier gateways stopped',
        'delivering in 2025. See [the notice](https://example.com).',
        '',
        '## How to switch',
        '- Pick a **service**',
        '2. Replace the address',
        '',
        '> Texts arrive as normal SMS.',
        '> No app needed.',
        '',
        '```',
        'number@gateway.example',
        '```',
        '',
        '| Plan | Price |',
        '| --- | --- |',
        '| Team | [check] |',
        '',
        '#### Small print',
        '---'
      ].join('\n')
    )
    expect(blocks).toEqual([
      { id: 'b1', kind: 'h1', text: 'AT&T email to text alternative' },
      { id: 'b2', kind: 'p', text: 'Carrier gateways stopped delivering in 2025. See the notice.' },
      { id: 'b3', kind: 'h2', text: 'How to switch' },
      { id: 'b4', kind: 'li', text: 'Pick a service' },
      { id: 'b5', kind: 'li', text: 'Replace the address' },
      { id: 'b6', kind: 'quote', text: 'Texts arrive as normal SMS. No app needed.' },
      { id: 'b7', kind: 'code', text: 'number@gateway.example' },
      { id: 'b8', kind: 'table', text: '| Plan | Price |\n| --- | --- |\n| Team | [check] |' },
      { id: 'b9', kind: 'h4', text: 'Small print' }
    ])
  })

  test('keeps at most the block cap', () => {
    const markdown = Array.from({ length: MAX_PAGE_BLOCKS + 20 }, (_, i) => `Line ${i}`).join(
      '\n\n'
    )
    const blocks = blocksFromMarkdown(markdown)
    expect(blocks).toHaveLength(MAX_PAGE_BLOCKS)
    expect(blocks.at(-1)?.id).toBe(`b${MAX_PAGE_BLOCKS}`)
  })

  test('an empty page has no blocks', () => {
    expect(blocksFromMarkdown('  \n\n ')).toEqual([])
  })
})

describe('blocksFromText', () => {
  test('the H1 and h2/h3 outline lines become headings; other lines are paragraphs', () => {
    const blocks = blocksFromText(
      'Plans and prices\nPricing plans\nThree plans.\n\nFAQ\nIs there an app?\nTalk to sales',
      [
        { level: 'h2', text: 'Pricing  plans' },
        { level: 'h3', text: 'FAQ' },
        { level: 'cta', text: 'Talk to sales' }
      ],
      'Plans and prices'
    )
    expect(blocks.map((block) => [block.kind, block.text])).toEqual([
      ['h1', 'Plans and prices'],
      ['h2', 'Pricing plans'],
      ['p', 'Three plans.'],
      ['h3', 'FAQ'],
      ['p', 'Is there an app?'],
      ['p', 'Talk to sales']
    ])
  })
})

test('blocksForPrompt numbers each block with its kind', () => {
  expect(
    blocksForPrompt([
      { id: 'b1', kind: 'h1', text: 'Title' },
      { id: 'b2', kind: 'p', text: 'Body.' }
    ])
  ).toBe('b1 [h1] Title\nb2 [p] Body.')
})

test('the page starts at its H1: the site menu and table of contents before it go, and image captions too', () => {
  const blocks = blocksFromMarkdown(
    [
      '![Image 1: Header Logo](https://example.com/logo.png)',
      '- [Pricing](https://example.com/pricing)',
      '- [Blog](https://example.com/blog)',
      '',
      '# AT&T email to text alternative',
      '',
      '![Image 2: Rakesh Patel](https://example.com/me.png)',
      '',
      'AT&T shut down its gateway.'
    ].join('\n')
  )
  expect(blocks.map((block) => [block.id, block.kind, block.text])).toEqual([
    ['b1', 'h1', 'AT&T email to text alternative'],
    ['b2', 'p', 'AT&T shut down its gateway.']
  ])
})
