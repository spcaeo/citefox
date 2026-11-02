import { describe, expect, it } from 'vitest'
import {
  overviewFromSample,
  parseAiOverview,
  segments,
  segmentsText,
  type AioBlock,
  type AioOverview
} from './aio-overview'
import koha from './fixtures/aio-overview-koha.json'

function parsed(value: unknown): AioOverview {
  const overview = parseAiOverview(value)
  if (!overview) throw new Error('no overview')
  return overview
}

function only<K extends AioBlock['kind']>(
  blocks: readonly AioBlock[],
  kind: K
): Extract<AioBlock, { kind: K }>[] {
  return blocks.filter((block): block is Extract<AioBlock, { kind: K }> => block.kind === kind)
}

describe('parseAiOverview with a stored SerpApi overview', () => {
  const overview = parsed(koha)

  it('keeps Google’s block order and kinds', () => {
    expect(overview.blocks.map((block) => block.kind)).toEqual([
      'paragraph',
      'paragraph',
      'heading',
      'paragraph',
      'table',
      'heading',
      'paragraph',
      'table',
      'heading',
      'paragraph',
      'list',
      'paragraph',
      'list'
    ])
  })

  it('reads every reference with its index, site name and icon', () => {
    expect(overview.sources).toHaveLength(12)
    expect(overview.sources[1]).toMatchObject({
      index: 1,
      source: 'TextBolt',
      url: 'https://textbolt.com/blog/att-email-to-text-shutdown/',
      title: 'When Did AT&T Shut Down Email-to-Text?'
    })
    expect(overview.sources[0]?.icon).toMatch(/^https:\/\/encrypted-tbn1\.gstatic\.com\//)
  })

  it('marks inline code and keeps the citations of a paragraph', () => {
    const first = only(overview.blocks, 'paragraph')[0]
    expect(first?.refs).toEqual([0, 1, 2, 3, 4])
    expect(first?.text.filter((part) => part.kind === 'code').map((part) => part.text)).toEqual([
      '@txt.att.net',
      'SMS::Send::Email'
    ])
  })

  it('pads a table header to the widest row', () => {
    const table = only(overview.blocks, 'table')[0]
    expect(table?.header).toEqual(['Option', 'Approach / Driver', 'Cons', ''])
    expect(table?.rows).toHaveLength(2)
    expect(table?.rows[0]).toHaveLength(4)
    expect(table?.rows[0]?.[0]).toBe('Twilio Integration')
  })

  it('shows a short lead before a colon as the list item label', () => {
    const list = only(overview.blocks, 'list')[0]
    expect(list?.items.map((item) => item.label)).toEqual(['How it works', 'Pros', 'Cons'])
    expect(segmentsText(list?.items[1]?.text ?? [])).toBe(
      'Highly convenient. No need to clear out or modify old patron "Provider" fields or rewrite notices.'
    )
    expect(list?.items[2]?.refs).toEqual([5, 11])
    const questions = only(overview.blocks, 'list')[1]
    expect(questions?.items.every((item) => item.label === null)).toBe(true)
  })

  it('accepts the overview object itself as well as the whole body', () => {
    expect(parsed(koha.ai_overview).blocks).toHaveLength(overview.blocks.length)
  })
})

describe('overviewFromSample', () => {
  const body = JSON.stringify(koha)

  it('prefers the follow-up body, then the overview in the search body', () => {
    expect(overviewFromSample({ rawAioJson: body, rawSearchJson: null })?.sources).toHaveLength(12)
    expect(overviewFromSample({ rawAioJson: null, rawSearchJson: body })?.sources).toHaveLength(12)
    const tokenOnly = JSON.stringify({ ai_overview: { page_token: 'abc' } })
    expect(overviewFromSample({ rawAioJson: body, rawSearchJson: tokenOnly })).not.toBeNull()
    expect(overviewFromSample({ rawAioJson: tokenOnly, rawSearchJson: body })).not.toBeNull()
  })

  it('is null for missing, broken or empty JSON', () => {
    expect(overviewFromSample({ rawAioJson: null, rawSearchJson: null })).toBeNull()
    expect(overviewFromSample({ rawAioJson: '{not json', rawSearchJson: '' })).toBeNull()
    expect(
      overviewFromSample({ rawAioJson: '{"ai_overview":{"text_blocks":[]}}', rawSearchJson: null })
    ).toBeNull()
  })
})

describe('parseAiOverview with other SerpApi shapes', () => {
  it('reads expandable sections with their nested blocks', () => {
    const overview = parsed({
      text_blocks: [
        {
          type: 'expandable',
          title: 'Pricing details',
          text_blocks: [
            { type: 'paragraph', snippet: 'Plans start at $29.', reference_indexes: [0] }
          ]
        }
      ],
      references: [{ index: 0, link: 'https://a.example/', title: 'A' }]
    })
    expect(overview.blocks).toEqual([
      {
        kind: 'expandable',
        title: 'Pricing details',
        blocks: [
          { kind: 'paragraph', text: [{ kind: 'text', text: 'Plans start at $29.' }], refs: [0] }
        ]
      }
    ])
  })

  it('turns a comparison into a table with the product labels as header', () => {
    const overview = parsed({
      text_blocks: [
        {
          type: 'comparison',
          product_labels: ['TextBolt', 'Twilio'],
          comparison: [
            { feature: 'Price', values: ['$29', 'Pay as you go'] },
            { feature: 'Setup', values: ['Minutes'] }
          ]
        }
      ]
    })
    expect(overview.blocks).toEqual([
      {
        kind: 'table',
        header: ['', 'TextBolt', 'Twilio'],
        rows: [
          ['Price', '$29', 'Pay as you go'],
          ['Setup', 'Minutes', '']
        ],
        refs: []
      }
    ])
  })

  it('reads list titles, string items and nested lists', () => {
    const overview = parsed({
      text_blocks: [
        {
          type: 'list',
          list: [
            {
              title: 'Twilio:',
              snippet: 'An API for developers.',
              list: [{ snippet: 'Needs code.' }, 'Pay per message.']
            },
            'A plain item'
          ]
        }
      ]
    })
    const list = only(overview.blocks, 'list')[0]
    expect(list?.items[0]?.label).toBe('Twilio')
    expect(segmentsText(list?.items[0]?.text ?? [])).toBe('An API for developers.')
    const nested = only(list?.items[0]?.children ?? [], 'list')[0]
    expect(nested?.items.map((item) => segmentsText(item.text))).toEqual([
      'Needs code.',
      'Pay per message.'
    ])
    expect(list?.items[1]).toEqual({
      label: null,
      text: [{ kind: 'text', text: 'A plain item' }],
      refs: [],
      children: []
    })
  })

  it('does not treat a sentence or a long lead as a label', () => {
    const overview = parsed({
      text_blocks: [
        {
          type: 'list',
          list: [
            { snippet: 'Note that this works on every carrier in the country: yes it does.' },
            { snippet: 'It works. Then: more.' }
          ]
        }
      ]
    })
    expect(only(overview.blocks, 'list')[0]?.items.map((item) => item.label)).toEqual([null, null])
  })

  it('drops citations that point at no reference', () => {
    const overview = parsed({
      text_blocks: [{ type: 'paragraph', snippet: 'Hi.', reference_indexes: [0, 7, 0, -1, 'x'] }],
      references: [{ index: 0, link: 'https://a.example/' }]
    })
    expect(only(overview.blocks, 'paragraph')[0]?.refs).toEqual([0])
  })

  it('keeps references without a usable link but drops their URL', () => {
    const overview = parsed({
      references: [
        { title: 'No link' },
        { index: 4, link: 'javascript:alert(1)', source: 'Bad' },
        'junk'
      ]
    })
    expect(overview.sources).toEqual([
      expect.objectContaining({ index: 0, title: 'No link', url: null }),
      expect.objectContaining({ index: 4, source: 'Bad', url: null })
    ])
  })

  it('reads a table from detailed cells or formatted rows when there is no table', () => {
    const detailed = parsed({
      text_blocks: [{ type: 'table', detailed: [[{ snippet: 'A' }], [{ snippet: '1' }]] }]
    })
    expect(only(detailed.blocks, 'table')[0]).toMatchObject({ header: ['A'], rows: [['1']] })
    const formatted = parsed({
      text_blocks: [{ type: 'table', formatted: [{ plan_name: 'Pro', price: '$9' }] }]
    })
    expect(only(formatted.blocks, 'table')[0]).toMatchObject({
      header: ['Plan name', 'Price'],
      rows: [['Pro', '$9']]
    })
  })

  it('is null for something that is not an overview', () => {
    expect(parseAiOverview(null)).toBeNull()
    expect(parseAiOverview('text')).toBeNull()
    expect(parseAiOverview({ search_metadata: {} })).toBeNull()
  })
})

describe('segments', () => {
  it('marks highlighted words bold, links and inline code, without overlaps', () => {
    const parts = segments('Use TextBolt or Twilio with SMS::Send to text.', {
      snippet_highlighted_words: ['TextBolt', 'text', 'Twilio'],
      snippet_links: [{ text: 'Twilio', link: 'https://www.twilio.com/' }],
      snippet_inline_code: ['SMS::Send']
    })
    expect(parts).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'bold', text: 'TextBolt' },
      { kind: 'text', text: ' or ' },
      { kind: 'link', text: 'Twilio', href: 'https://www.twilio.com/' },
      { kind: 'text', text: ' with ' },
      { kind: 'code', text: 'SMS::Send' },
      { kind: 'text', text: ' to ' },
      { kind: 'bold', text: 'text' },
      { kind: 'text', text: '.' }
    ])
  })

  it('leaves Markdown-looking characters as plain text', () => {
    expect(segments('~$112.00 / mo ~ and *not* _bold_', {})).toEqual([
      { kind: 'text', text: '~$112.00 / mo ~ and *not* _bold_' }
    ])
  })

  it('ignores links that are not http(s) and words that are not in the text', () => {
    expect(
      segments('Click here', {
        snippet_links: [{ text: 'here', link: 'javascript:void(0)' }],
        snippet_highlighted_words: ['missing']
      })
    ).toEqual([{ kind: 'text', text: 'Click here' }])
  })
})
