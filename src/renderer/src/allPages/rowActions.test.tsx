// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetDrawersForTests } from '../shell/drawers'
import { AllPagesScreen } from '.'
import { DATA, fakeSource, PROJECT, row } from './fixtures.test-helper'

/** Row menu, Stop tracking with Undo, the header, and Needs attention over a long grid (deep audit §7). */

beforeEach(() => {
  resetDrawersForTests()
  window.location.hash = '#/pages'
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
})

function screenWith(source = fakeSource()): {
  view: ReturnType<typeof render>
  source: ReturnType<typeof fakeSource>
} {
  const view = render(
    <AllPagesScreen
      source={source}
      project={PROJECT}
      onPin={async () => undefined}
      onOpenPage={() => undefined}
    />
  )
  return { view, source }
}

function menuLabels(view: ReturnType<typeof render>, rowName: string): string[] {
  fireEvent.click(view.getByRole('button', { name: `Actions for ${rowName}` }))
  const menu = view.getByRole('menu', { name: `Actions for ${rowName}` })
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => (item.textContent ?? '').trim())
}

function hashParams(): URLSearchParams {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
}

describe('All pages row menu (deep audit §7b)', () => {
  test('a tracked page has the full menu, Stop tracking last', async () => {
    const { view } = screenWith()
    await view.findByRole('grid', { name: 'Pages' })
    const labels = menuLabels(view, 'Bulk SMS pricing')
    expect(labels).toEqual([
      'Open page',
      'Check now…',
      'Pause tracking',
      'Rename…',
      'Add questions…',
      'Add to group…',
      'Move to cluster…',
      'Pin Bulk SMS pricing',
      'Copy URL',
      'Open live page',
      'Stop tracking…'
    ])
  })

  test('a page not tracked offers Track, group, copy, open and pin', async () => {
    const { view } = screenWith()
    await view.findByRole('grid', { name: 'Pages' })
    expect(menuLabels(view, 'SMS opt-in rules')).toEqual([
      'Track this page',
      'Add to group…',
      'Pin SMS opt-in rules',
      'Copy URL',
      'Open live page'
    ])
  })

  test('Pause, Check now, Rename and Move to cluster', async () => {
    const { view, source } = screenWith()
    await view.findByRole('grid', { name: 'Pages' })
    menuLabels(view, 'Bulk SMS pricing')
    fireEvent.click(view.getByRole('menuitem', { name: 'Pause tracking' }))
    await waitFor(() =>
      expect(source.updatePage).toHaveBeenCalledWith({
        projectId: 'proj-1',
        pageId: 'pricing',
        status: 'paused'
      })
    )
    expect(await view.findByText(/Paused Bulk SMS pricing/)).toBeTruthy()

    menuLabels(view, 'Bulk SMS pricing')
    fireEvent.click(view.getByRole('menuitem', { name: 'Check now…' }))
    expect(hashParams().get('drawer')).toBe('check-now')
    expect(hashParams().get('check.ids')).toBe('pricing')

    window.location.hash = '#/pages'
    resetDrawersForTests()
    menuLabels(view, 'Bulk SMS pricing')
    fireEvent.click(view.getByRole('menuitem', { name: 'Rename…' }))
    expect(hashParams().get('drawer')).toBe('rename-page')
    expect(hashParams().get('rename.id')).toBe('pricing')

    window.location.hash = '#/pages'
    resetDrawersForTests()
    menuLabels(view, 'Bulk SMS pricing')
    fireEvent.click(view.getByRole('menuitem', { name: 'Move to cluster…' }))
    expect(hashParams().get('drawer')).toBe('move-pages')
    expect(hashParams().get('move.to')).toBe('cluster')
  })

  test('Stop tracking asks first, then offers Undo', async () => {
    const { view, source } = screenWith()
    await view.findByRole('grid', { name: 'Pages' })
    menuLabels(view, 'Bulk SMS pricing')
    fireEvent.click(view.getByRole('menuitem', { name: 'Stop tracking…' }))
    const confirm = await view.findByRole('alertdialog')
    expect(confirm.textContent).toContain('Stop tracking Bulk SMS pricing?')
    expect(confirm.textContent).toContain('History stays; no more searches are used.')
    expect(source.removePage).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop tracking' }))
    await waitFor(() =>
      expect(source.removePage).toHaveBeenCalledWith({ projectId: 'proj-1', pageId: 'pricing' })
    )
    const notice = await view.findByText(/Stopped tracking Bulk SMS pricing/)
    fireEvent.click(
      within(notice.parentElement as HTMLElement).getByRole('button', { name: 'Undo' })
    )
    await waitFor(() =>
      expect(source.undoTrack).toHaveBeenCalledWith({
        projectId: 'proj-1',
        pageId: 'pricing',
        previousStatus: 'tracked'
      })
    )
  })

  test('bulk Stop tracking shows its cost, runs, and Undo restores each page', async () => {
    const { view, source } = screenWith()
    fireEvent.click(await view.findByRole('checkbox', { name: 'Select Text alerts for business' }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Bulk SMS pricing' }))
    const bar = view.getByRole('region', { name: 'Bulk actions' })
    fireEvent.click(within(bar).getByRole('button', { name: /^More/ }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Stop tracking…' }))
    const confirm = within(bar).getByRole('group', { name: 'Stop tracking: cost and confirm' })
    await waitFor(() => expect(confirm.textContent).toContain('Stop tracking 2 pages?'))
    fireEvent.click(within(confirm).getByRole('button', { name: 'Run stop tracking' }))
    await waitFor(() => expect(source.runs[0]).toMatchObject({ action: 'stop' }))
    const notice = await view.findByText('Stopped tracking 2 pages.')
    fireEvent.click(
      within(notice.parentElement as HTMLElement).getByRole('button', { name: 'Undo' })
    )
    await waitFor(() => expect(source.undoTrack).toHaveBeenCalledTimes(2))
  })
})

describe('All pages header and long grids', () => {
  test('Add a page opens its drawer; Import pages links to the importer', async () => {
    const { view } = screenWith()
    await view.findByRole('grid', { name: 'Pages' })
    expect(view.queryByRole('button', { name: 'Add page or topic' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Add a page' }))
    expect(hashParams().get('drawer')).toBe('add-page')
    // Import pages sits under the header's ⋯ and opens the importer.
    fireEvent.click(view.getByRole('button', { name: 'Page actions' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Import pages' }))
    expect(window.location.hash).toContain('import-pages')
  })

  test('over 50 rows Needs attention is one line; Review opens it on the URL', async () => {
    const source = fakeSource()
    const rows = Array.from({ length: 60 }, (_, index) => row(`p${index}`))
    vi.mocked(source.list).mockResolvedValue({ ...DATA, rows })
    const { view } = screenWith(source)
    const bar = await view.findByRole('region', { name: 'Needs attention' })
    const review = within(bar).getByRole('button', { name: /Review/ })
    expect(review.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(review)
    expect(hashParams().get('attention')).toBe('open')
    fireEvent.click(await view.findByRole('button', { name: 'Show less' }))
    expect(hashParams().get('attention')).toBeNull()
    expect(await view.findByRole('button', { name: /Review/ })).toBeTruthy()
  })

  test('a drawer opened after picking a view keeps the picked rows', async () => {
    const source = fakeSource()
    const props = {
      source,
      project: PROJECT,
      onPin: async () => undefined,
      onOpenPage: () => undefined
    }
    const view = render(<AllPagesScreen {...props} params={{}} />)
    await view.findByRole('grid', { name: 'Pages' })
    fireEvent.click(view.getByRole('button', { name: /^Tracked/ }))
    expect(window.location.hash).toContain('preset=tracked')
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Text alerts for business' }))
    fireEvent.click(view.getByRole('checkbox', { name: 'Select Bulk SMS pricing' }))
    // The shell sees the URL the grid wrote only when a drawer opens.
    view.rerender(<AllPagesScreen {...props} params={{ preset: 'tracked', drawer: 'check-now' }} />)
    expect(view.getByText('2 selected')).toBeTruthy()
    // A deep link to another view still starts the grid over.
    view.rerender(<AllPagesScreen {...props} params={{ preset: 'untracked' }} />)
    expect(view.queryByText('2 selected')).toBeNull()
  })
})
