// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { AllPagesData } from '@shared/ipc'
import { textboltResults } from '../m3/fixtures'
import { alertsHash, pageHash, promptHash, structureHash } from '../shell/routes'
import { AllPagesScreen } from '.'
import { DATA, fakeSource, PROJECT, REVIEW, row } from './fixtures.test-helper'
import { linkedPresets } from './utils/views'

const RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const results = textboltResults()
const run = results.run
if (!run) throw new Error('fixture has no run')

/** Rows whose numbers come from the fixture check, as `allpages:list` sends them. */
const CHECKED: AllPagesData = {
  ...DATA,
  rows: [
    row('alerts', {
      title: 'Text alerts for business',
      pageCited: run.pageCited,
      aioPrompts: run.promptsWithAio,
      citations: run.citationsThisPage,
      score: run.visibilityScore,
      runId: run.runId,
      clusters: [{ id: 'cl-1', name: 'Alerts' }],
      groups: null
    }),
    row('setup', { title: 'Setup page', status: 'setting_up', setupStep: 'read', score: null }),
    row('optin', {
      title: 'SMS opt-in rules',
      status: 'not_tracked',
      folder: 'guides',
      score: null,
      change: null,
      pageCited: null,
      aioPrompts: null,
      citations: null,
      marketIds: []
    })
  ]
}

function screen(params?: Readonly<Record<string, string>>): {
  view: ReturnType<typeof render>
  source: ReturnType<typeof fakeSource>
} {
  const source = fakeSource()
  source.list = async () => CHECKED
  const view = render(
    <AllPagesScreen
      source={source}
      project={PROJECT}
      params={params}
      onPin={async () => undefined}
      onOpenPage={() => undefined}
    />
  )
  return { view, source }
}

beforeEach(() => {
  window.location.hash = ''
})
afterEach(() => cleanup())

function drawerRows(dialog: HTMLElement): number {
  return dialog.querySelectorAll('[data-drill-row]').length
}

describe('All pages drill-downs (NFR-14: the drawer total equals the number clicked)', () => {
  test('Page cited opens exactly the cited questions of the check behind the cell', async () => {
    const { view, source } = screen()
    const button = await view.findByRole('button', {
      name: new RegExp(
        `^Page cited in ${run.pageCited} of ${run.promptsWithAio} questions for Text alerts`
      )
    })
    expect(button.tagName).toBe('BUTTON')
    const figure = button.querySelector('[data-nfr-figure]')
    expect(figure?.textContent).toBe(String(run.pageCited))
    expect(button.getAttribute('data-nfr-drill')).toBe('allpages:cited:alerts')
    button.focus()
    fireEvent.click(button)
    const dialog = await view.findByRole('dialog')
    expect(source.results).toHaveBeenCalledWith({
      projectId: 'proj-1',
      pageId: 'alerts',
      marketId: 'mkt-us',
      runId: run.runId
    })
    expect(drawerRows(dialog)).toBe(run.pageCited)
    expect((await axe.run(view.container, RULES)).violations).toEqual([])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  test('Links to this page opens one row per link to the page', async () => {
    const { view } = screen()
    const button = await view.findByRole('button', {
      name: new RegExp(`^${run.citationsThisPage} links? to Text alerts`)
    })
    fireEvent.click(button)
    const dialog = await view.findByRole('dialog')
    expect(drawerRows(dialog)).toBe(run.citationsThisPage)
    expect(within(dialog).getByRole('heading', { name: /^Links to Text alerts/ })).toBeTruthy()
    expect(button.querySelector('[data-nfr-figure]')?.textContent).toBe(
      String(run.citationsThisPage)
    )
  })

  test('the per-page link count is headed "Links to this page", never "Citations"', async () => {
    const { view } = screen()
    expect(await view.findByRole('columnheader', { name: /^Links to this page/ })).toBeTruthy()
    expect(view.queryByRole('columnheader', { name: /^Citations/ })).toBeNull()
  })

  test('Score opens the scored questions; change and last check link to their tabs', async () => {
    const { view } = screen()
    fireEvent.click(await view.findByRole('button', { name: /^Score \d+ for Text alerts/ }))
    const dialog = await view.findByRole('dialog')
    expect(drawerRows(dialog)).toBe(run.promptsWithAio)
    fireEvent.keyDown(document, { key: 'Escape' })
    // Last check, Markets and Cluster are optional columns: turn them on.
    fireEvent.click(view.getByRole('button', { name: 'Views' }))
    fireEvent.click(view.getByRole('menuitem', { name: /Group and columns/ }))
    const picker = view.getByRole('region', { name: 'Group and columns' })
    for (const name of [/^Last check/, /^Markets/, /^Cluster/]) {
      fireEvent.click(within(picker).getByRole('checkbox', { name }))
    }
    const grid = view.getByRole('grid', { name: 'Pages' })
    expect(
      within(grid)
        .getByRole('link', { name: /^Change \+2 for Text alerts/ })
        .getAttribute('href')
    ).toBe(pageHash('alerts', 'progress'))
    expect(
      within(grid)
        .getByRole('link', { name: /^Last check .* for Text alerts/ })
        .getAttribute('href')
    ).toBe(pageHash('alerts', 'history'))
    expect(
      within(grid)
        .getAllByRole('link', { name: /^Next check/ })[0]
        ?.getAttribute('href')
    ).toBe(alertsHash('schedule'))
    expect(
      within(grid)
        .getByRole('link', { name: /Text alerts for business results in/ })
        .getAttribute('href')
    ).toBe(pageHash('alerts', 'results', { marketId: 'mkt-us' }))
    expect(
      within(grid)
        .getByRole('link', { name: 'Cluster Alerts in Site structure' })
        .getAttribute('href')
    ).toBe(structureHash('cl-1'))
  })

  test('status: setting up links to its step, not tracked offers Track and opens in the browser', async () => {
    const { view, source } = screen()
    const grid = await view.findByRole('grid', { name: 'Pages' })
    expect(
      within(grid)
        .getByRole('link', { name: /finish setting up Setup page/ })
        .getAttribute('href')
    ).toBe(pageHash('setup', 'prompts'))
    const title = within(grid).getByRole('link', { name: /^SMS opt-in rules \(not tracked/ })
    expect(title.getAttribute('target')).toBe('_blank')
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for SMS opt-in rules' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Track this page' }))
    await waitFor(() =>
      expect(source.trackUrl).toHaveBeenCalledWith({
        projectId: 'proj-1',
        url: 'https://textbolt.com/blog/optin/'
      })
    )
    expect(await view.findByText(/SMS opt-in rules: Tracked\./)).toBeTruthy()
  })

  test('Wrong page cited: the badge lists every case; question, cited page and market link on', async () => {
    const { view } = screen()
    const section = await view.findByRole('region', { name: 'Needs attention' })
    const prompt = within(section).getByRole('link', { name: /Open question “Crew alerts”/ })
    expect(prompt.getAttribute('href')).toBe(
      promptHash('alerts', 'p1', { marketId: 'mkt-us', runId: 'run-1' })
    )
    expect(within(section).getByRole('link', { name: 'Open /pricing/' }).getAttribute('href')).toBe(
      pageHash('pricing')
    )
    const badge = within(section).getByRole('button', { name: /case: show every wrong-page case/ })
    expect(badge.querySelector('[data-nfr-figure]')?.textContent).toBe(
      String(REVIEW.wrongPage.length)
    )
    fireEvent.click(badge)
    const dialog = view.getByRole('dialog')
    expect(drawerRows(dialog)).toBe(REVIEW.wrongPage.length)
  })

  test('Cited but not tracked: the count opens its citations and the URL opens in the browser', async () => {
    const { view } = screen()
    const section = await view.findByRole('region', { name: 'Needs attention' })
    const url = within(section).getByRole('link', { name: 'Open /login/ in a new tab' })
    expect(url.getAttribute('href')).toBe('https://textbolt.com/login/')
    const count = within(section).getByRole('button', {
      name: 'Cited 2 times for 1 tracked page: show the questions'
    })
    count.focus()
    fireEvent.click(count)
    const dialog = view.getByRole('dialog')
    expect(drawerRows(dialog)).toBe(2)
    expect(count.querySelector('[data-nfr-figure]')?.textContent).toBe('2')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(count)
  })

  test('Due today lists each due page once, and the tile shows that count', async () => {
    const { view } = screen()
    const tile = await view.findByRole('button', { name: '2 pages due today: show them' })
    fireEvent.click(tile)
    const dialog = view.getByRole('dialog')
    expect(drawerRows(dialog)).toBe(2)
    expect(dialog.textContent).toContain('Fix follow-up')
  })

  test('page counts link to filtered views and a deep link opens the grid on it', async () => {
    const first = screen()
    const summary = await first.view.findByRole('region', { name: 'Summary' })
    expect(
      within(summary)
        .getByRole('link', { name: /tracked: show the tracked pages/ })
        .getAttribute('href')
    ).toBe('#/pages?preset=tracked')
    first.view.unmount()
    const linked = screen({ view: 'untracked' })
    await linked.view.findByRole('grid', { name: 'Pages' })
    expect(linked.view.getByText(/^Showing 1 page · \d+ in all, filtered$/)).toBeTruthy()
    linked.view.unmount()
    const folder = screen({ folder: '/guides/' })
    await folder.view.findByRole('grid', { name: 'Pages' })
    expect(folder.view.getByText(/^Showing 1 page · \d+ in all, filtered$/)).toBeTruthy()
  })

  test('linked presets put the deep-linked view first and keep All pages to clear it', () => {
    const presets = [
      { id: 'all', label: 'All pages', state: {} },
      { id: 'lost', label: 'Lost citations', state: { filters: { change: ['lost'] } } }
    ]
    expect(linkedPresets(presets, { preset: 'lost' }, CHECKED.rows, new Map())[0]?.id).toBe('lost')
    const tracked = linkedPresets(
      [...presets, { id: 'tracked', label: 'Tracked pages', state: {} }],
      { view: 'tracked' },
      CHECKED.rows,
      new Map()
    )
    expect(tracked[0]?.state.filters?.status).toEqual(['setting_up', 'tracked', 'paused'])
    const cluster = linkedPresets(presets, { cluster: 'cl-1' }, CHECKED.rows, new Map())
    expect(cluster[0]).toMatchObject({
      label: 'Cluster: Alerts',
      state: { filters: { cluster: ['Alerts'] } }
    })
    expect(cluster.map((preset) => preset.id)).toContain('all')
    expect(linkedPresets(presets, undefined, CHECKED.rows, new Map())).toBe(presets)
  })
})
