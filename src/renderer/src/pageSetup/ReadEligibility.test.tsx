// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageEligibility } from '@shared/domain'
import { alertsRead } from '../mocks/m2/textboltPage'
import { ReadHead } from './ReadHead'

afterEach(cleanup)

function show(eligibility: PageEligibility | null): HTMLElement {
  render(
    <ReadHead
      result={{ ...alertsRead(), eligibility }}
      pageUrl="https://textbolt.com/blog/alerts/"
    />
  )
  return screen.getByTestId('read-eligibility')
}

describe('ReadHead: Shown in AI Overviews', () => {
  it('sits in What Google sees first', () => {
    show({ issues: [] })
    expect(screen.getByText('Shown in AI Overviews')).toBeTruthy()
  })

  it('says it was not checked when the read did not see the HTML', () => {
    const row = show(null)
    expect(row.textContent).toContain('not through the backup reader')
    expect(within(row).queryByRole('button')).toBeNull()
  })

  it('a clean page is an ok flag that explains Google-Extended is not the control', () => {
    const row = show({ issues: [] })
    const flag = within(row).getByRole('button', { name: /Google may show and quote this page/ })
    expect(flag.className).toContain('ok')
    fireEvent.click(flag)
    expect(row.textContent).toContain('Google-Extended in robots.txt does not control AI Overviews')
  })

  it('each problem is a flag with what it means and the fix', () => {
    const row = show({
      issues: [
        { code: 'noindex', where: 'meta', detail: 'noindex' },
        { code: 'nosnippet', where: 'header', detail: 'nosnippet' },
        { code: 'max_snippet', where: 'meta', detail: 'max-snippet:20' },
        { code: 'data_nosnippet', where: 'html', detail: 'data-nosnippet on 80% of the text' }
      ]
    })
    const flags = within(row).getAllByRole('button')
    expect(flags.map((flag) => flag.textContent)).toEqual([
      'Hidden from Google (noindex)',
      'Google may not quote it (nosnippet)',
      'Snippets limited to 20 characters',
      'Most of the text is marked data-nosnippet'
    ])
    for (const flag of flags) expect(flag.className).not.toContain('ok')
    fireEvent.click(flags[1] as HTMLElement)
    expect(row.textContent).toContain(
      'Remove nosnippet from the X-Robots-Tag header your server sends.'
    )
    fireEvent.click(flags[2] as HTMLElement)
    expect(row.textContent).toContain('max-snippet:-1 (no limit)')
  })
})
