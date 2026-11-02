// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AllPagesScreen } from '.'
import { DATA, fakeSource, PROJECT, US } from './fixtures.test-helper'
import { createShellAllPagesSource } from './shellSource'

afterEach(() => cleanup())

/** Opens a row's ⋯ menu in `scope` and picks an item. */
function pick(
  view: ReturnType<typeof render>,
  scope: HTMLElement,
  trigger: string | RegExp,
  item: string
): void {
  fireEvent.click(within(scope).getByRole('button', { name: trigger }))
  fireEvent.click(view.getByRole('menuitem', { name: item }))
}

describe('All pages (FR-20.1–20.5, 20.7, 20.9)', () => {
  test('shows the tiles and the grid over every found page, with no explainer line', async () => {
    const source = fakeSource()
    const view = render(
      <AllPagesScreen
        source={source}
        project={PROJECT}
        onPin={async () => undefined}
        onOpenPage={() => undefined}
      />
    )
    const summary = await view.findByRole('region', { name: 'Summary' })
    await waitFor(() => expect(within(summary).getByText('3')).toBeTruthy())
    expect(summary.textContent).toContain('2 tracked · 1 found, not tracked')
    expect(within(summary).getByText('3,760 left this month')).toBeTruthy()
    expect(
      await within(summary).findByRole('button', { name: '2 pages due today: show them' })
    ).toBeTruthy()
    expect(view.getByText('Showing 3 pages')).toBeTruthy()
    // The Score column's own note says "Default market": no line over the grid repeats it.
    expect(view.queryByText(/for each page's default market/)).toBeNull()
    const grid = view.getByRole('grid', { name: 'Pages' })
    expect(within(grid).getByRole('link', { name: 'Text alerts for business' })).toBeTruthy()
    expect(
      within(grid).getAllByRole('button', { name: /^Page cited in 3 of 8 questions/ })
    ).toHaveLength(2)
    const results = await axe.run(view.container, { rules: { region: { enabled: false } } })
    expect(results.violations).toEqual([])
  })

  test('a bulk action shows its search cost before it runs', async () => {
    const source = fakeSource()
    const view = render(
      <AllPagesScreen
        source={source}
        project={PROJECT}
        onPin={async () => undefined}
        onOpenPage={() => undefined}
      />
    )
    fireEvent.click(await view.findByRole('checkbox', { name: 'Select Text alerts for business' }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Bulk SMS pricing' }))
    const bar = view.getByRole('region', { name: 'Bulk actions' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Pause' }))
    const confirm = within(bar).getByRole('group', { name: 'Pause: cost and confirm' })
    await waitFor(() => expect(source.estimate).toHaveBeenCalled())
    expect(source.run).not.toHaveBeenCalled()
    // Add to group shows even without groups: it opens Move pages on "New group".
    expect(within(bar).getByRole('button', { name: 'Add to group' })).toBeTruthy()
    // Every selected page is tracked, so Track is left out.
    expect(within(bar).queryByRole('button', { name: 'Track' })).toBeNull()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Run pause' }))
    await waitFor(() => expect(source.runs).toHaveLength(1))
    expect(source.runs[0]).toMatchObject({ action: 'pause', pageIds: ['alerts', 'pricing'] })
  })

  test('bulk Check now opens the Check now drawer with the picked pages', async () => {
    window.location.hash = '#/pages'
    const source = fakeSource()
    const view = render(
      <AllPagesScreen
        source={source}
        project={PROJECT}
        onPin={async () => undefined}
        onOpenPage={() => undefined}
      />
    )
    fireEvent.click(await view.findByRole('checkbox', { name: 'Select Text alerts for business' }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Bulk SMS pricing' }))
    const bar = view.getByRole('region', { name: 'Bulk actions' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(window.location.hash).toContain('drawer=check-now'))
    const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    expect(query.get('check.scope')).toBe('pages')
    expect(query.get('check.ids')).toBe('alerts,pricing')
    expect(source.run).not.toHaveBeenCalled()
  })

  test('Needs attention: Wrong page cited offers Point it here and Merge with Undo in the row menu', async () => {
    const source = fakeSource()
    const view = render(
      <AllPagesScreen
        source={source}
        project={PROJECT}
        onPin={async () => undefined}
        onOpenPage={() => undefined}
      />
    )
    const section = await view.findByRole('region', { name: 'Needs attention' })
    expect(section.textContent).toContain('1\u00a0case on 1 tracked page')
    const row = /^Actions for Text alerts for business: “Crew alerts”/
    pick(view, section, row, 'Point it here')
    expect(await within(section).findByText(/now belongs to Bulk SMS pricing/)).toBeTruthy()
    pick(view, section, row, 'Undo')
    await waitFor(() => expect(source.undoPoint).toHaveBeenCalled())
    await waitFor(() => expect(within(section).queryByText(/now belongs to/)).toBeNull())
    pick(view, section, row, 'Merge')
    expect(await within(section).findByText('Fix #1 added.')).toBeTruthy()
  })

  test('Needs attention: cited but not tracked marks noise and offers Track and Ignore', async () => {
    const source = fakeSource()
    const view = render(
      <AllPagesScreen
        source={source}
        project={PROJECT}
        onPin={async () => undefined}
        onOpenPage={() => undefined}
      />
    )
    const section = await view.findByRole('region', { name: 'Needs attention' })
    expect(within(section).getByText(/Probably ignore: login page/)).toBeTruthy()
    pick(view, section, 'Actions for /login/', 'Ignore')
    expect(await within(section).findByText('Ignored')).toBeTruthy()
    pick(view, section, 'Actions for /login/', 'Undo ignore')
    await waitFor(() => expect(within(section).queryByText('Ignored')).toBeNull())
    pick(view, section, 'Actions for /login/', 'Track')
    await waitFor(() => expect(source.trackUrl).toHaveBeenCalled())
  })

  test('the picked view goes in the URL', async () => {
    window.location.hash = '#/pages'
    const view = render(
      <AllPagesScreen
        source={fakeSource()}
        project={PROJECT}
        onPin={async () => undefined}
        onOpenPage={() => undefined}
      />
    )
    const views = await view.findByRole('group', { name: 'View' })
    fireEvent.click(within(views).getByRole('button', { name: /^Lost/ }))
    expect(window.location.hash).toBe('#/pages?preset=lost')
    const again = view.getByRole('group', { name: 'View' })
    fireEvent.click(within(again).getByRole('button', { name: /^All/ }))
    expect(window.location.hash).toBe('#/pages')
  })

  test('pins a page to the sidebar from the grid', async () => {
    const onPin = vi.fn(async () => undefined)
    const view = render(
      <AllPagesScreen
        source={fakeSource()}
        project={PROJECT}
        onPin={onPin}
        onOpenPage={() => undefined}
      />
    )
    fireEvent.click(
      await view.findByRole('button', { name: 'Actions for Text alerts for business' })
    )
    fireEvent.click(view.getByRole('menuitem', { name: /Unpin Text alerts for business/ }))
    expect(onPin).toHaveBeenCalledWith({ id: 'alerts', pinned: true })
  })

  test('the shell-client source keeps the mock build working', async () => {
    const source = createShellAllPagesSource({
      getProject: async () => ({
        ...PROJECT,
        foundPageCount: 2014,
        trackedPageCount: 186,
        defaultMarket: US
      }),
      listPages: async () => ({ foundPageCount: 2014, pages: [] }),
      listPageScores: async () => ({ projectId: 'proj-1', summary: DATA.summary, pages: [] })
    } as unknown as Parameters<typeof createShellAllPagesSource>[0])
    const data = await source.list('proj-1')
    expect(data.foundPageCount).toBe(2014)
    expect(data.rows).toEqual([])
    expect((await source.citations('proj-1')).wrongPage).toEqual([])
  })
})
