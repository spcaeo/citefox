// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetDrawersForTests } from '../shell/drawers'
import { TEXTBOLT_PAGE, TEXTBOLT_PAGE_ID, textboltResults } from './fixtures'
import { PageResultsScreen } from './PageResultsScreen'

beforeEach(() => {
  window.history.replaceState(null, '', `#/pages/${TEXTBOLT_PAGE_ID}/results`)
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
})

function sel(): string | null {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return at < 0 ? null : new URLSearchParams(hash.slice(at + 1)).get('sel')
}

/** The Results grid keeps its ticked prompts on the URL (`?sel=`), for the header's Check now. */
describe('Results question selection on the URL', () => {
  it('writes ticked rows as opaque ids, reads them back, and drops them on another tab', () => {
    const results = textboltResults()
    const [first, second] = results.prompts
    if (!first || !second) throw new Error('fixture needs two questions')
    const view = render(
      <PageResultsScreen
        pageId={TEXTBOLT_PAGE_ID}
        projectName="TextBolt"
        page={TEXTBOLT_PAGE}
        marketId="us-en"
        onMarketChange={() => undefined}
        results={results}
      />
    )
    fireEvent.click(view.getByRole('checkbox', { name: `Select question ${first.promptPosition}` }))
    expect(sel()).toBe(first.promptId)
    fireEvent.click(
      view.getByRole('checkbox', { name: `Select question ${second.promptPosition}` })
    )
    expect(sel()?.split(',').sort()).toEqual([first.promptId, second.promptId].sort())

    // A copied link (or Back) restores the ticks.
    act(() => {
      window.location.hash = `#/pages/${TEXTBOLT_PAGE_ID}/results?sel=${second.promptId}`
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    const box = view.getByRole('checkbox', { name: `Select question ${second.promptPosition}` })
    expect((box as HTMLInputElement).checked).toBe(true)
    expect(
      (
        view.getByRole('checkbox', {
          name: `Select question ${first.promptPosition}`
        }) as HTMLInputElement
      ).checked
    ).toBe(false)

    const tablist = view.getAllByRole('tablist', { name: 'Results sections' })[0] as HTMLElement
    fireEvent.click(within(tablist).getByRole('tab', { name: /^Breakdown/ }))
    expect(sel()).toBeNull()
  })
})
