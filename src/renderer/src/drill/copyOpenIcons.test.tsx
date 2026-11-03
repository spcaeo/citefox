// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AskResults } from '../assistant/results/AskResults'
import { askMockQuestion } from '../assistant/results/rows.fixtures.test-helper'
import { setFetchIconsForTests } from '../siteIcon/loader'
import { DrillHost } from './index'
import { ItemList } from './ItemList'

afterEach(() => {
  cleanup()
  setFetchIconsForTests(null)
})

describe('every URL and domain gets Copy and Open (owner rule)', () => {
  it('a drawer item that links to its page has both icons', () => {
    setFetchIconsForTests(() => Promise.resolve({ icons: [] }))
    const view = render(
      <ItemList
        label="Pages"
        primaryLabel="Page"
        columns={[]}
        items={[{ id: 'a', primary: 'Pricing plans', url: 'https://example.com/pricing' }]}
        onOpen={() => undefined}
      />
    )
    const url = view.container.querySelector('[data-url-text]') as HTMLElement
    expect(url).not.toBeNull()
    expect(within(url).getByRole('button', { name: /copy/i })).toBeTruthy()
    expect(url.querySelector('.ui-url-actions a[target="_blank"]')).not.toBeNull()
  })

  it('a cited domain in the Ask CiteFox list has both icons', () => {
    setFetchIconsForTests(() => Promise.resolve({ icons: [] }))
    const answer = askMockQuestion({ projectId: 'proj-1', question: 'Where am I not cited?' })
    const rows = answer.rows.map((row, at) =>
      at === 0 ? { ...row, citedDomains: ['rival-example.com'] } : row
    )
    const view = render(
      <DrillHost>
        <AskResults rows={rows} total={answer.total} projectId="proj-1" />
      </DrillHost>
    )
    const url = view.container.querySelector('[data-url-text="domain"]') as HTMLElement
    expect(url).not.toBeNull()
    expect(within(url).getByRole('button', { name: /copy rival-example\.com/i })).toBeTruthy()
    expect(within(url).getByRole('link', { name: /open rival-example\.com/i })).toBeTruthy()
  })
})
