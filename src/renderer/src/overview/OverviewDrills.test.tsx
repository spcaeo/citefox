// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rollupPageFixes } from '@shared/page-fixes'
import { DrillHost } from '../drill'
import { projectSearches } from '../fixes/searchFixtures'
import type { OverviewClient } from './client'
import { OverviewScreen } from './index'
import { overview } from './summaryFixture.test-helper'

/**
 * Summary drill-downs end to end in the screen: each number opens the drill drawer on
 * the URL over Summary, listing exactly as many rows as it says, with its insight line.
 */

function client(): OverviewClient {
  const searches = projectSearches()
  return {
    'visibility:overview': (request) => Promise.resolve({ ...overview(), period: request.period }),
    'fixes:searches': () => Promise.resolve(searches)
  }
}

async function drawerRows(dialog: HTMLElement): Promise<number> {
  const grid = within(dialog).queryByRole('grid')
  if (grid === null) return 0
  await waitFor(() => expect(grid.querySelectorAll('[data-drill-row]').length).toBeGreaterThan(0))
  return Number(grid.getAttribute('aria-rowcount')) - 1
}

async function opens(
  view: ReturnType<typeof render>,
  control: HTMLElement,
  rows: number
): Promise<HTMLElement> {
  fireEvent.click(control)
  const dialog = await view.findByRole('dialog')
  expect(window.location.hash).toMatch(/[?&]drawer=drill&drill=/)
  expect(await drawerRows(dialog)).toBe(rows)
  return dialog
}

async function close(view: ReturnType<typeof render>, dialog: HTMLElement): Promise<void> {
  fireEvent.keyDown(dialog, { key: 'Escape' })
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
}

beforeEach(() => {
  window.location.hash = '#/overview'
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('Summary drill-downs', () => {
  it('opens what moved behind a tile’s change chip', async () => {
    const view = render(
      <DrillHost>
        <OverviewScreen projectId="p1" client={client()} />
      </DrillHost>
    )
    const kpis = await view.findByRole('region', { name: 'Headline numbers' })
    const aio = within(kpis).getByRole('region', { name: 'AI Overview shows' })
    const chip = within(aio).getByRole('button', { name: /^\+1 since the compared check/ })
    const dialog = await opens(view, chip, 1)
    expect(within(dialog).getByTestId('drill-insight').textContent).toBe(
      '1 gained, 0 lost: +1 net.'
    )
    await close(view, dialog)
  })

  it('opens this week’s cited searches, each week’s point, and the change since the first check', async () => {
    const view = render(
      <DrillHost>
        <OverviewScreen projectId="p1" client={client()} />
      </DrillHost>
    )
    const chart = await view.findByRole('region', { name: /where you’re cited, by week/ })
    const big = within(chart).getByRole('button', { name: '2 questions cited this week' })
    let dialog = await opens(view, big, 2)
    expect(window.location.hash).toMatch(/drill=week%3A0|drill=week:0/)
    expect(within(dialog).getByTestId('drill-insight').textContent).toContain(
      'Against the week before'
    )
    await close(view, dialog)

    const point = within(chart).getByRole('button', { name: /^Week to Oct 9: 2 questions cited/ })
    dialog = await opens(view, point, 2)
    await close(view, dialog)

    const change = within(chart).getByRole('button', { name: /that moved$/ })
    dialog = await opens(view, change, 2)
    expect(within(dialog).getByRole('button', { name: /Gained/ })).toBeTruthy()
    await close(view, dialog)
  })

  it('opens every page fix and one fix’s searches; a fix opens the page fix drawer on top', async () => {
    const fixes = rollupPageFixes(projectSearches().searches).fixes
    const view = render(
      <DrillHost>
        <OverviewScreen projectId="p1" client={client()} />
      </DrillHost>
    )
    const panel = await view.findByRole('region', { name: 'Next fixes' })
    const all = await within(panel).findByRole('button', {
      name: `All ${fixes.length} page fixes: open them`
    })
    let dialog = await opens(view, all, fixes.length)
    const first = fixes[0]
    if (!first) throw new Error('no fix')
    const row = within(dialog).getAllByRole('link')[0] as HTMLAnchorElement
    expect(row.getAttribute('href')).toMatch(
      new RegExp(`drawer=drill&drill=fixes%3Aall&drawer=page-fix&pfx\\.id=${first.id}$`)
    )
    await close(view, dialog)

    const searches = within(panel).getAllByRole('button', {
      name: /in this fix$/
    })[0] as HTMLElement
    dialog = await opens(view, searches, first.searches.length)
    await close(view, dialog)

    // The same list opens from "N page fixes" in the verdict card.
    const verdict = view.getByRole('region', { name: 'Results at a glance' })
    const count = within(verdict).getByRole('button', {
      name: `${fixes.length} page fixes: open them`
    })
    dialog = await opens(view, count, fixes.length)
    await close(view, dialog)
  })
})
