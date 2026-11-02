import { describe, expect, it } from 'vitest'
import { pageEditResult } from '../../fixtures'
import {
  pageEditFileName,
  pageEditHtml,
  pageEditMarkdown,
  pageEditMdFileName
} from '@shared/page-edit-html'
import {
  EMPTY_STATE,
  changeSummaryText,
  decide,
  decideAll,
  docRows,
  openCount,
  parseState,
  tableCells,
  typed
} from '@shared/page-edit'

const when = (iso: string): string => iso
const EDIT = pageEditResult('pf1', 'https://textbolt.com/blog/att-email-to-text-alternative')

function shape(state = EMPTY_STATE): string[] {
  return docRows(EDIT, state).map((row) =>
    row.type === 'block' ? `${row.cut ? '-' : ' '}${row.key}` : `${row.open ? '+' : ' '}${row.key}`
  )
}

describe('page edits document', () => {
  it('shows each change where it lands: the rewrite after its block, the cut struck, the insert after its anchor', () => {
    expect(shape()).toEqual([' b:b1', '-b:b2', '+c:c1', '-b:b3', ' b:b4', ' b:b5', '+c:c3'])
    expect(openCount(EDIT, EMPTY_STATE)).toBe(3)
  })

  it('Keep applies a change; Undo puts the page back', () => {
    let state = decide(EMPTY_STATE, 'c1', 'kept')
    state = decide(state, 'c2', 'undone')
    expect(shape(state)).toEqual([' b:b1', ' c:c1', ' b:b3', ' b:b4', ' b:b5', '+c:c3'])
    state = decideAll(EDIT, state, 'kept')
    expect(openCount(EDIT, state)).toBe(0)
    expect(shape(state)).toEqual([' b:b1', ' c:c1', ' b:b3', ' b:b4', ' b:b5', ' c:c3'])
  })

  it('typed text wins over the page and the suggestion', () => {
    const state = typed(typed(EMPTY_STATE, 'b:b1', 'New title'), 'c:c3', 'Your FAQ')
    const rows = docRows(EDIT, state)
    expect(rows[0]?.text).toBe('New title')
    expect(rows.at(-1)?.text).toBe('Your FAQ')
  })

  it('reads saved choices safely', () => {
    expect(
      parseState('{"decisions":{"c1":"kept","c2":"bad"},"texts":{"b:b1":"x","b:b2":3}}')
    ).toEqual({
      decisions: { c1: 'kept' },
      texts: { 'b:b1': 'x' }
    })
    expect(parseState('nope')).toEqual(EMPTY_STATE)
    expect(parseState(null)).toEqual(EMPTY_STATE)
  })

  it('splits a markdown table into cells', () => {
    expect(tableCells('| Plan | Price |\n|---|---|\n| Basic | [check] |')).toEqual([
      ['Plan', 'Price'],
      ['Basic', '[check]']
    ])
  })
})

describe('change summary for Log a fix', () => {
  it('lists every change not undone, with typed text in place of the suggestion', () => {
    let state = decide(EMPTY_STATE, 'c2', 'undone')
    state = typed(state, 'c:c3', 'My own FAQ line')
    const text = changeSummaryText(EDIT, state)
    expect(text.split('\n')[0]).toBe(
      'Page edits on https://textbolt.com/blog/att-email-to-text-alternative:'
    )
    expect(text).toContain('- Rewrote: ')
    expect(text).toContain('- Added: My own FAQ line')
    expect(text).not.toContain('Removed:')
  })
})

describe('page edits HTML', () => {
  it('marks removals and additions with their reasons, escaped, and lists the searches', () => {
    const html = pageEditHtml(
      { ...EDIT, blocks: [...EDIT.blocks, { id: 'b6', kind: 'p', text: '<script>x</script>' }] },
      EMPTY_STATE,
      ['att email to text alternative'],
      when
    )
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<del>Many teams used carrier gateways for years.</del>')
    expect(html).toContain('<ins>Carrier addresses such as @txt.att.net no longer deliver.')
    expect(html).toContain('<span class="why">Says nothing the buyer asked for.</span>')
    expect(html).toContain('<li>att email to text alternative</li>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('reads kept changes as plain text and leaves undone ones out', () => {
    const state = decide(decide(EMPTY_STATE, 'c1', 'kept'), 'c3', 'undone')
    const html = pageEditHtml(EDIT, state, [], when)
    expect(html).not.toContain('Many teams used carrier gateways')
    expect(html).toContain('<p>Carrier addresses such as @txt.att.net')
    expect(html).not.toContain('What can I use instead')
  })

  it('names the file after the page', () => {
    expect(pageEditFileName('https://textbolt.com/blog/att-email-to-text-alternative')).toBe(
      'att-email-to-text-alternative-edits.html'
    )
    expect(pageEditFileName('https://textbolt.com/')).toBe('home-edits.html')
  })

  it('writes Markdown: struck to remove, marked to add, each reason in italics', () => {
    const md = pageEditMarkdown(EDIT, EMPTY_STATE, ['att email to text alternative'], when)
    expect(md).toContain('# Page edits · /blog/att-email-to-text-alternative')
    expect(md).toContain('1. att email to text alternative')
    expect(md).toContain('# AT&T email to text alternative')
    expect(md).toContain('~~Many teams used carrier gateways for years.~~')
    expect(md).toContain('<mark>Carrier addresses such as @txt.att.net no longer deliver.')
    expect(md).toContain('*Why: Says nothing the buyer asked for.*')
    expect(md).toContain(
      '## <mark>What can I use instead of the AT&T email-to-text gateway?</mark>'
    )
    expect(md).toContain('- Pick a number')
    expect(pageEditMdFileName(EDIT.url)).toBe('att-email-to-text-alternative-edits.md')
  })
})
