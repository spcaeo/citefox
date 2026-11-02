import { describe, expect, test } from 'vitest'
import { overviewHasContent, readAiOverview } from './overview'

describe('readAiOverview', () => {
  test('reads paragraphs, headings, list item titles, and nested lists in order', () => {
    const parsed = readAiOverview({
      text_blocks: [
        { type: 'heading', snippet: 'Ways to alert staff' },
        {
          type: 'list',
          list: [
            { title: 'TextBolt:', snippet: 'turns email into SMS.' },
            {
              title: 'Group texts',
              list: [{ snippet: 'Send to a whole shift.' }, 'Plain string item']
            }
          ]
        },
        { type: 'expandable', title: 'More', text_blocks: [{ snippet: 'Hidden detail.' }] }
      ],
      references: [{ title: 'Title only in a reference', link: 'https://textbolt.com/a' }]
    })
    expect(parsed?.text).toBe(
      'Ways to alert staff TextBolt: turns email into SMS. Group texts Send to a whole shift. Plain string item More Hidden detail.'
    )
    expect(parsed?.text).not.toContain('Title only in a reference')
    expect(parsed?.references).toEqual([
      { url: 'https://textbolt.com/a', title: 'Title only in a reference' }
    ])
  })

  test('reads tables and comparison blocks', () => {
    const parsed = readAiOverview({
      text_blocks: [
        {
          type: 'table',
          table: [
            ['Tool', 'Price'],
            ['TextBolt', '$29']
          ]
        },
        {
          type: 'comparison',
          product_labels: ['TextBolt', 'Twilio'],
          comparison: [{ feature: 'Setup', values: ['No code', 'API'] }]
        }
      ]
    })
    expect(parsed?.text).toBe('Tool | Price TextBolt | $29 TextBolt | Twilio Setup | No code | API')
  })

  test('keeps the page token and SerpApi overview errors apart from content', () => {
    const token = readAiOverview({ page_token: ' tok ' })
    expect(token).toMatchObject({ pageToken: 'tok', error: null, text: null })
    expect(token === null ? true : overviewHasContent(token)).toBe(false)
    expect(readAiOverview({ error: 'Google did not load the overview.' })?.error).toBe(
      'Google did not load the overview.'
    )
    expect(readAiOverview(undefined)).toBeNull()
    expect(readAiOverview('text')).toBeNull()
  })
})
