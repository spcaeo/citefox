import { describe, expect, test } from 'vitest'
import { results, row } from './fixtures'
import { buildWhatChanged } from './changes'

describe('what changed since the last check (FR-14.1, FR-14.2)', () => {
  test('lists gained, lost, newly named, no longer named and moved, and the rest by number', () => {
    const previous = results('run-1', '2026-10-05T12:00:00.000Z', [
      row(1, 'not_cited'),
      row(2, 'other_own_page', { position: 4 }),
      row(3, 'page_cited', { position: 1 }),
      row(4, 'page_cited', { position: 5 }),
      row(5, 'not_cited'),
      row(6, 'brand_mentioned'),
      row(7, 'no_aio')
    ])
    const current = results(
      'run-2',
      '2026-10-19T12:00:00.000Z',
      [
        row(1, 'page_cited', { position: 2 }),
        row(2, 'other_own_page', { position: 2 }),
        row(3, 'page_cited', { position: 1 }),
        row(4, 'not_cited', {
          references: [
            {
              id: 'r1',
              position: 1,
              url: 'https://simpletexting.com/a',
              normalizedUrl: 'simpletexting.com/a',
              domain: 'simpletexting.com',
              title: null,
              classification: 'competitor',
              untracked: false,
              sourceType: 'web'
            }
          ]
        }),
        row(5, 'brand_mentioned'),
        row(6, 'not_cited'),
        row(7, 'no_aio'),
        row(8, 'not_cited')
      ],
      {
        contentChanged: true,
        contentChange: { summary: '5 FAQs added.', faqsAdded: 5, wordsAdded: 0, headingsChanged: 0 }
      }
    )
    current.scope.promptCount = 8
    const model = buildWhatChanged(previous, current, '🇺🇸 US · EN', [
      { number: 1, goLiveAt: '2026-10-08T12:00:00.000Z' },
      { number: 2, goLiveAt: '2026-10-21T12:00:00.000Z' }
    ])
    expect(model.heading).toBe('What changed since the last check (Oct 5 → Oct 19)')
    expect(model.intro).toBe(
      '🇺🇸 US · EN · 7 of 8 questions checked both times · 5 questions changed, 2 didn’t. The page content also changed in this period (Fix 1, Oct 8): 5 FAQs added. CiteFox shows both side by side and doesn’t claim one caused the other.'
    )
    expect(model.groups.map((group) => [group.title, group.items.map((item) => item.n)])).toEqual([
      ['Gained a citation', [1]],
      ['Lost a citation', [4]],
      ['Newly named in the text', [5]],
      ['No longer named', [6]],
      ['Moved', [2]]
    ])
    expect(model.groups[0]?.items[0]?.detail).toBe('Page cited at position 2 · was Not cited')
    expect(model.groups[1]?.items[0]?.extra).toBe('Cited instead: simpletexting.com')
    expect(model.groups[4]?.items[0]?.detail).toBe('Your other page · 4 → Your other page · 2')
    expect(model.unchanged.map((item) => [item.n, item.note])).toEqual([
      [3, 'Right page at position 1 both times'],
      [7, 'No AI Overview either time']
    ])
    expect(model.unchangedNote).toBe('Not in these lists: questions 3 and 7.')
    // NFR-14: groups and unchanged add up to the prompts checked both times.
    const listed =
      model.groups.reduce((sum, group) => sum + group.count, 0) + model.unchanged.length
    expect(listed).toBe(7)
  })

  test('says when the content did not change', () => {
    const previous = results('run-1', '2026-10-05T12:00:00.000Z', [row(1, 'not_cited')])
    const current = results('run-2', '2026-10-19T12:00:00.000Z', [row(1, 'not_cited')])
    const model = buildWhatChanged(previous, current, '🇺🇸 US · EN')
    expect(model.intro).toContain(
      'all 1 question checked both times · 0 questions changed, 1 didn’t.'
    )
    expect(model.intro).toContain('The page content didn’t change in this period.')
    expect(model.groups.every((group) => group.aria.endsWith(': none'))).toBe(true)
  })
})
