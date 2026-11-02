// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CitationsScreen } from './CitationsScreen'
import { mockVisibilitySource } from './mocks'

afterEach(() => {
  cleanup()
})

const source = mockVisibilitySource()

/** The text of each body row of a grid. */
function rowTexts(grid: HTMLElement): string[] {
  return within(grid)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent ?? '')
}

describe('Citations: every list of sites shows icon, name, website and type', () => {
  it('Who gets cited: platforms by name and role, never "Observed"', async () => {
    const view = render(
      <CitationsScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    const grid = await view.findByRole('grid', { name: 'Domains cited in the AI Overviews' })
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((item) => item.textContent)
    expect(headers.slice(0, 4)).toEqual(['Site icon', 'Name', 'Website', 'Type'])
    const rows = rowTexts(grid)
    expect(rows.some((row) => row.startsWith('Reddit') && row.includes('Community'))).toBe(true)
    expect(rows.some((row) => row.includes('Your site'))).toBe(true)
    expect(rows.join(' ')).not.toMatch(/Observed|Tracked/)
    // The type filter uses the same words, with counts.
    const filter = within(grid.closest('.ui-lg') ?? grid).getByRole('group', { name: 'Type' })
    fireEvent.click(within(filter).getByRole('button', { name: /^Platforms/ }))
    await waitFor(() =>
      expect(rowTexts(grid).every((row) => !row.includes('Competitor'))).toBe(true)
    )
    expect(rowTexts(grid).some((row) => row.startsWith('Reddit'))).toBe(true)
    // The filter is in the URL, and comes back from it.
    expect(window.location.hash).toContain('citedType=platform')
    cleanup()
    const again = render(
      <CitationsScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    const restored = await again.findByRole('grid', { name: 'Domains cited in the AI Overviews' })
    expect(rowTexts(restored).every((row) => !row.includes('Competitor'))).toBe(true)
    window.location.hash = ''
  })

  it('Sources Google listed: the type filter is in the URL', async () => {
    window.location.hash = '#/pages/alerts/results?sourceType=target'
    const view = render(
      <CitationsScreen
        source={source}
        projectId="textbolt"
        pageId="alerts"
        marketId="us"
        withSharedSections={false}
      />
    )
    const grid = await view.findByRole('grid', { name: 'Sources Google listed' })
    expect(rowTexts(grid).length).toBeGreaterThan(0)
    expect(rowTexts(grid).every((row) => row.includes('This page'))).toBe(true)
    const filter = within(grid.closest('.ui-lg') ?? grid).getByRole('group', {
      name: 'Source type'
    })
    fireEvent.click(within(filter).getByRole('button', { name: /^All/ }))
    await waitFor(() => expect(window.location.hash).not.toContain('sourceType'))
    window.location.hash = ''
  })

  it('Sources Google listed: the type says Neutral, not Other', async () => {
    const view = render(
      <CitationsScreen
        source={source}
        projectId="textbolt"
        pageId="alerts"
        marketId="us"
        withSharedSections={false}
      />
    )
    const grid = await view.findByRole('grid', { name: 'Sources Google listed' })
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((item) => item.textContent)
    expect(headers).toEqual(
      expect.arrayContaining(['Site icon', 'Name', 'Website', 'Type', 'Page'])
    )
    const rows = rowTexts(grid)
    expect(rows.some((row) => row.includes('Neutral'))).toBe(true)
    expect(rows.some((row) => row.includes('This page'))).toBe(true)
    expect(rows.some((row) => /\bOther\b/.test(row))).toBe(false)
  })
})
