// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuildToolsContext, ipcBuildClient, type BuildTools } from '../../buildMenu/buildClient'
import { DrillHost } from '../../drill/DrillHost'
import { drillDrawerRows, expectDrillMatches } from '../../drill/count.test-helper'
import { ProjectHistoryScreen } from './index'
import { NEWEST, OLDEST, TOPIC, check, fakeSource, history } from './ProjectHistory.fixtures'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function setup(data = history()): ReturnType<typeof fakeSource> & {
  view: ReturnType<typeof render>
  notify: ReturnType<typeof vi.fn>
} {
  const fake = fakeSource(data)
  const notify = vi.fn()
  const tools: BuildTools = { client: ipcBuildClient, notify }
  const wrap = ({ children }: { children: ReactNode }): ReactNode => (
    <BuildToolsContext.Provider value={tools}>
      <DrillHost>{children}</DrillHost>
    </BuildToolsContext.Provider>
  )
  const view = render(<ProjectHistoryScreen projectId="proj-1" source={fake.source} />, {
    wrapper: wrap
  })
  return { ...fake, view, notify }
}

function openMenu(view: ReturnType<typeof render>, row: RegExp): HTMLElement {
  fireEvent.click(view.getByRole('button', { name: row }))
  return view.getByRole('menu')
}

describe('Check history row menu', () => {
  it('lists the actions that fit the check: no stop on an ended check, retry only with failed questions', async () => {
    window.location.hash = '#/history'
    const { view } = setup()
    await view.findByRole('treegrid', { name: 'Check history' })
    const menu = openMenu(view, /^Actions for Alerts · .*Oct 19,/)
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent ?? '')
    expect(names.map((name) => name.replace(/\d.*searches$/, ''))).toEqual([
      'Open results',
      'Compare with previous',
      'Re-run',
      'Copy link',
      'Delete check'
    ])
    expect(names[2]).toContain('3–6 searches')
    fireEvent.keyDown(menu, { key: 'Escape' })

    const topic = openMenu(view, /^Actions for Crew alerts/)
    expect(within(topic).getByRole('menuitem', { name: /Retry 2 failed questions/ })).toBeTruthy()
  })

  it('re-runs a check with the same page, market and questions after a confirm, and toasts how it went', async () => {
    window.location.hash = '#/history'
    const { view, starts, notify, finishStarts } = setup()
    await view.findByRole('treegrid', { name: 'Check history' })
    const menu = openMenu(view, /^Actions for Alerts · .*Oct 12,/)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Re-run/ }))
    const confirm = view.getByRole('alertdialog', { name: /^Re-run the Oct 12, .+ check\?$/ })
    expect(confirm.textContent).toContain('with the same 1 question')
    expect(confirm.textContent).toContain('Uses about 1–2 searches')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Re-run check' }))
    expect(starts).toEqual([
      { projectId: 'proj-1', pageIds: ['page-1'], marketIds: ['mkt-us'], promptIds: ['prompt-1'] }
    ])
    expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/Re-run of Alerts started/), 'ok')
    await act(async () => {
      finishStarts()
      await Promise.resolve()
    })
    await waitFor(() => expect(notify).toHaveBeenLastCalledWith('Re-run of Alerts finished.', 'ok'))
  })

  it('retries only the questions without a result', async () => {
    window.location.hash = '#/history'
    const { view, starts } = setup()
    await view.findByRole('treegrid', { name: 'Check history' })
    const menu = openMenu(view, /^Actions for Crew alerts/)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Retry 2 failed questions/ }))
    const confirm = view.getByRole('alertdialog', { name: 'Retry 2 failed questions?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Retry questions' }))
    expect(starts[0]?.promptIds).toEqual(['tq-13', 'tq-14'])
    expect(starts[0]?.pageIds).toEqual(['topic-1'])
  })

  it('stops a running check by its job, and does not offer to delete it', async () => {
    window.location.hash = '#/history'
    const running = check({
      runId: 'run-live',
      jobId: 'job-live',
      status: 'running',
      startedAt: '2026-10-20T08:00:00.000Z',
      finishedAt: null,
      durationMs: null,
      score: null
    })
    const { view, cancels, notify } = setup(history([running, NEWEST, OLDEST]))
    await view.findByRole('treegrid', { name: 'Check history' })
    const menu = openMenu(view, /^Actions for Alerts · .*Oct 20,/)
    expect(within(menu).queryByRole('menuitem', { name: /Re-run/ })).toBeNull()
    const remove = within(menu).getByRole('menuitem', { name: /Delete check/ }) as HTMLButtonElement
    expect(remove.getAttribute('aria-disabled') === 'true' || remove.disabled).toBe(true)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Stop this check' }))
    const confirm = view.getByRole('alertdialog', { name: 'Stop this check?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop check' }))
    await waitFor(() => expect(cancels).toEqual(['job-live']))
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringMatching(/stopped/), 'ok'))
  })

  it('copies the link that opens the check in this project', async () => {
    window.location.hash = '#/history'
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { view } = setup()
    await view.findByRole('treegrid', { name: 'Check history' })
    const menu = openMenu(view, /^Actions for Alerts · .*Oct 19,/)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '#/p/proj-1/pages/page-1/results?market=mkt-us&run=run-3'
      )
    )
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: 'Link copied' })).toBeTruthy()
    )
  })

  it('deletes a check after the confirm, and the list drops it', async () => {
    window.location.hash = '#/history?sel=run-1'
    const { view, deletes, notify, lists } = setup()
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    const menu = openMenu(view, /^Actions for Alerts · .*US · EN · Oct 5,/)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Delete check/ }))
    const confirm = view.getByRole('alertdialog', { name: /^Delete the Oct 5, .+ check\?$/ })
    expect(confirm.textContent).toContain(
      'Its results leave history and trends. Searches already used are not refunded.'
    )
    const before = lists()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete check' }))
    await waitFor(() => expect(deletes).toEqual([{ projectId: 'proj-1', runId: 'run-1' }]))
    await waitFor(() => expect(lists()).toBeGreaterThan(before))
    await waitFor(() => expect(checkRows(grid)).toHaveLength(4))
    expect(notify).toHaveBeenCalledWith('Deleted 1 check.', 'ok')
    // The deleted check leaves the selection in the URL.
    await waitFor(() => expect(window.location.hash).toBe('#/history'))
  })

  it('bulk: deletes the ticked checks and exports only them', async () => {
    window.location.hash = '#/history?sel=run-1%2Crun-uk'
    const { view, deletes, csv } = setup()
    await view.findByRole('treegrid', { name: 'Check history' })
    fireEvent.click(view.getByRole('button', { name: 'Export CSV', hidden: false }))
    await waitFor(() => expect(csv).toHaveLength(1))
    expect(csv[0]?.rows).toHaveLength(2)
    fireEvent.click(view.getByRole('button', { name: 'Delete' }))
    const confirm = view.getByRole('alertdialog', { name: 'Delete 2 checks?' })
    expect(confirm.textContent).toContain('Their results leave history and trends.')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete checks' }))
    await waitFor(() =>
      expect(deletes.map((item) => item.runId).sort()).toEqual(['run-1', 'run-uk'])
    )
  })
})

describe('Compare checks drawer', () => {
  it('compares two checks results first, with the pair and the tab in the URL', async () => {
    window.location.hash = '#/history'
    const { view, resultsCalls, compares } = setup()
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    fireEvent.click(view.getByRole('checkbox', { name: /^Select Alerts · .*Oct 19,/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /^Select Crew alerts/ }))
    const compare = view.getByRole('button', { name: 'Compare' }) as HTMLButtonElement
    expect(compare.disabled).toBe(true)
    expect(view.getByText(/different pages or topics/)).toBeTruthy()
    fireEvent.click(view.getByRole('checkbox', { name: /^Select Crew alerts/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /^Select Alerts · .*US · EN · Oct 5,/ }))
    fireEvent.click(view.getByRole('button', { name: 'Compare' }))
    await waitFor(() =>
      expect(window.location.hash).toMatch(/drawer=compare-checks&cmp\.a=run-1&cmp\.b=run-3$/)
    )
    const dialog = await view.findByRole('dialog', { name: /^Compare Oct 5, .+ vs Oct 19, .+$/ })
    const totals = await within(dialog).findByTestId('compare-totals')
    expect(totals.textContent).toContain('Score')
    expect(totals.textContent).toContain('+27')
    expect(totals.textContent).toContain('1 gained, 0 lost')
    expect(resultsCalls.map((call) => call.runId).sort()).toEqual(['run-1', 'run-3'])
    const questions = within(dialog).getByRole('grid', { name: 'Questions in both checks' })
    const q1 = within(questions).getAllByRole('row')[1] as HTMLElement
    expect(q1.textContent).toContain('Question 1?')
    expect(q1.textContent).toContain('Gained')
    // Both rows of the pair are marked in the list.
    expect(rowOf(grid, 'Oct 19, 2026').className).toMatch(/\bcur\b/)

    // Page content: the two checks read different versions of the page.
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Page content' }))
    await waitFor(() => expect(window.location.hash).toContain('cmp.tab=content'))
    await within(dialog).findByText('Added 2 FAQs and 6 words.')
    expect(compares).toEqual([
      { projectId: 'proj-1', pageId: 'page-1', fromSnapshotId: 'snap-1', toSnapshotId: 'snap-2' }
    ])
  })

  it('opens Compare with previous from the row menu, and from a pasted link', async () => {
    window.location.hash = '#/history?drawer=compare-checks&cmp.a=run-2&cmp.b=run-3'
    const first = setup()
    await first.view.findByRole('dialog', { name: /^Compare Oct 12, .+ vs Oct 19, / })
    cleanup()

    window.location.hash = '#/history'
    const { view } = setup()
    await view.findByRole('treegrid', { name: 'Check history' })
    const menu = openMenu(view, /^Actions for Alerts · .*Oct 19,/)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Compare with previous' }))
    await waitFor(() => expect(window.location.hash).toContain('cmp.a=run-2&cmp.b=run-3'))
  })

  it('turns an old ?compare= link into the drawer on its Page content tab', async () => {
    window.location.hash = '#/history?compare=run-1%2Crun-3'
    const { view } = setup()
    await view.findByRole('dialog', { name: /^Compare Oct 5, .+ vs Oct 19, / })
    expect(window.location.hash).toBe(
      '#/history?drawer=compare-checks&cmp.a=run-1&cmp.b=run-3&cmp.tab=content'
    )
  })

  it('says why a pasted link of two different subjects cannot be compared', async () => {
    window.location.hash = `#/history?drawer=compare-checks&cmp.a=${TOPIC.runId}&cmp.b=run-3`
    const { view } = setup()
    const dialog = await view.findByRole('dialog', { name: 'Compare checks' })
    expect(dialog.textContent).toMatch(/different pages or topics/)
  })
})

describe('Drill numbers', () => {
  it('a Cited number opens the questions behind it, read from that check', async () => {
    window.location.hash = '#/history'
    const { view, resultsCalls } = setup()
    await view.findByRole('treegrid', { name: 'Check history' })
    fireEvent.click(
      view.getByRole('button', {
        name: /^2 questions: Questions whose AI Overview cited you, Oct 19/
      })
    )
    await waitFor(() => expect(resultsCalls.map((call) => call.runId)).toEqual(['run-3']))
    const drawer = await view.findByRole('dialog', {
      name: /Questions whose AI Overview cited you/
    })
    expect(within(drawer).getByText('Question 1?')).toBeTruthy()
    expect(within(drawer).getByText('Question 2?')).toBeTruthy()
  })

  it('every count opens a list as long as the number, on the URL', async () => {
    window.location.hash = '#/history'
    const { view } = setup()
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    const cited = within(grid).getByRole('button', {
      name: /^2 questions: Questions whose AI Overview cited you, Oct 19/
    })
    expect(await expectDrillMatches(cited)).toEqual({ id: 'history:cited:run-3', count: 2 })
  })

  it('a day total and the All checks total open their questions too (audit #3)', async () => {
    window.location.hash = '#/history'
    const { view } = setup()
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    const day = within(grid).getByRole('button', {
      name: /^2 questions: Questions whose AI Overview cited you, all checks on Oct 19, 2026$/
    })
    const opened = await expectDrillMatches(day)
    expect(opened.id).toMatch(/^history:cited:day-/)
    expect(opened.count).toBe(2)
    const all = within(grid).getByRole('button', {
      name: /questions: Questions whose AI Overview cited you, every check$/
    })
    expect(all.closest('.ui-lg-tree-total')).not.toBeNull()
    expect(all.getAttribute('data-nfr-drill')).toBe('history:cited:all')
  })

  it('a copied link to a count reopens its list once the grid draws it', async () => {
    window.location.hash = '#/history?drawer=drill&drill=history%3Acited%3Arun-3'
    const { view, resultsCalls } = setup()
    const drawer = await view.findByRole('dialog', {
      name: /Questions whose AI Overview cited you/
    })
    expect(resultsCalls.map((call) => call.runId)).toEqual(['run-3'])
    expect(await drillDrawerRows(drawer)).toBe(2)
  })
})

/**
 * The check row for a day ("Oct 19, 2026": its When cell starts "Oct 19,") or a
 * page or topic name. Day group rows are left out.
 */
function rowOf(grid: HTMLElement, text: string): HTMLElement {
  const day = /^[A-Z][a-z]{2} \d+, \d{4}$/.test(text) ? text.replace(/, \d{4}$/, ',') : null
  const row = checkRows(grid).find((line) =>
    day === null
      ? line.textContent?.includes(text)
      : Array.from(line.querySelectorAll('.num')).some((cell) => cell.textContent?.startsWith(day))
  )
  return row as HTMLElement
}

/** The check rows of the tree, without its Day group rows and total row. */
function checkRows(grid: HTMLElement): HTMLElement[] {
  return Array.from(grid.querySelectorAll<HTMLElement>('[role="row"][data-row]'))
}
