// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market, PageSummary } from '@shared/domain'
import { fakeSource, report, US } from './fixtures.test-helper'
import { ProjectCommunitiesScreen } from './ProjectCommunitiesScreen'
import type { CommunitiesSource } from './source'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const UK: Market = { ...US, id: 'mkt-uk', country: 'GB' }

function page(id: string, label: string, extra: Partial<PageSummary> = {}): PageSummary {
  return {
    id,
    projectId: 'proj-1',
    url: `https://textbolt.com/${id}`,
    kind: 'page',
    title: null,
    label,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 7,
    samples: 1,
    promptCount: 5,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: 40,
    promptSetVersion: 1,
    ...extra
  } as PageSummary
}

const PAGES: readonly PageSummary[] = [
  page('page-1', 'Alerts'),
  page('page-2', 'Pricing'),
  page('topic-1', 'Carrier gateways', { kind: 'topic', url: null }),
  page('gone-1', 'Removed page', { status: 'removed' })
]

const AXE = { rules: { region: { enabled: false }, 'landmark-one-main': { enabled: false } } }

function renderScreen(
  source: CommunitiesSource = fakeSource(),
  pages: readonly PageSummary[] = PAGES
): ReturnType<typeof render> {
  return render(
    <ProjectCommunitiesScreen source={source} projectId="proj-1" markets={[US, UK]} pages={pages} />
  )
}

/** A source whose reports hold no check, as before the first check finishes. */
function uncheckedSource(): CommunitiesSource & { requests: unknown[] } {
  const base = fakeSource()
  return {
    ...base,
    'communities:get': (request) => {
      base.requests.push(request)
      return Promise.resolve({ ...report(request, false), checkedAt: null, checks: [] })
    }
  }
}

function setHash(hash: string): void {
  act(() => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

describe('Project Communities screen', () => {
  it('shows every tracked page in every market, with one header and no page scope switch', async () => {
    window.location.hash = '#/communities'
    const source = fakeSource()
    const view = renderScreen(source)
    expect(await view.findByTestId('mix-caption')).toBeTruthy()
    expect(view.getByTestId('mix-caption').textContent).toContain('1 tracked page · All markets')
    expect(view.getAllByRole('heading', { level: 1 }).map((node) => node.textContent)).toEqual([
      'Communities'
    ])
    expect(source.requests[0]).toEqual({
      projectId: 'proj-1',
      scope: 'project',
      pageId: null,
      marketId: null
    })
    expect(view.queryByRole('button', { name: 'This page' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Whole project' })).toBeNull()
    // The page filter lists tracked pages and topics, not removed ones.
    const pageSelect = view.getByRole('combobox', { name: 'Page' })
    expect(
      within(pageSelect)
        .getAllByRole('option')
        .map((node) => node.textContent)
    ).toEqual(['All tracked pages', 'Alerts', 'Pricing', 'Topic · Carrier gateways'])
    // Email it weekly is the header's schedule icon and opens Reports.
    fireEvent.click(view.getByRole('button', { name: 'Email it weekly' }))
    expect(window.location.hash).toBe('#/reports')
  })

  it('every number opens the drill drawer with exactly what it counts (NFR-14)', async () => {
    const view = renderScreen()
    await view.findByTestId('mix-caption')
    fireEvent.click(view.getByRole('button', { name: '1 answer cite YouTube' }))
    const dialog = await view.findByRole('dialog')
    expect(within(dialog).getAllByRole('row')).toHaveLength(2)
    // Project scope names each answer's page, not "your page".
    expect(dialog.textContent).toContain('Alerts')
    expect(within(dialog).queryByText('Your page')).toBeNull()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0] as HTMLElement)
    for (const button of view.container.querySelectorAll<HTMLElement>('button[data-nfr-drill]')) {
      const id = button.getAttribute('data-nfr-drill') ?? ''
      const figure =
        button.querySelector('[data-nfr-figure]') ??
        view.container.querySelector(`[data-nfr-figure="${CSS.escape(id)}"]`)
      fireEvent.click(button)
      const drawer = view.getByRole('dialog')
      expect(drawer.querySelectorAll('[data-drill-row]').length, id).toBe(
        Number(figure?.textContent)
      )
      fireEvent.click(within(drawer).getAllByRole('button', { name: 'Close' })[0] as HTMLElement)
    }
  })

  it('keeps the section, market and page in the URL, opens from it, and follows Back', async () => {
    window.location.hash = '#/communities?view=youtube&market=mkt-us&page=page-1'
    const source = fakeSource()
    const view = renderScreen(source)
    expect(await view.findByTestId('cm-youtube-table')).toBeTruthy()
    expect(view.getByRole('tab', { name: /^YouTube/ }).getAttribute('aria-selected')).toBe('true')
    expect(source.requests.at(-1)).toEqual({
      projectId: 'proj-1',
      scope: 'page',
      pageId: 'page-1',
      marketId: 'mkt-us'
    })
    expect((view.getByRole('combobox', { name: 'Market' }) as HTMLSelectElement).value).toBe(
      'mkt-us'
    )

    fireEvent.change(view.getByRole('combobox', { name: 'Page' }), { target: { value: '' } })
    expect(window.location.hash).toBe('#/communities?view=youtube&market=mkt-us')
    await waitFor(() => expect(source.requests.at(-1)?.scope).toBe('project'))
    fireEvent.change(view.getByRole('combobox', { name: 'Market' }), { target: { value: '' } })
    expect(window.location.hash).toBe('#/communities?view=youtube')
    await waitFor(() => expect(source.requests.at(-1)?.marketId).toBeNull())
    fireEvent.click(view.getByRole('tab', { name: /^Source mix/ }))
    expect(window.location.hash).toBe('#/communities')

    // Back: the route changes and the screen follows it.
    setHash('#/communities?view=reddit&market=mkt-uk')
    expect(await view.findByTestId('cm-reddit-table')).toBeTruthy()
    await waitFor(() => expect(source.requests.at(-1)?.marketId).toBe('mkt-uk'))
  })

  it('falls back to every page and market for ids the project no longer has', async () => {
    window.location.hash = '#/communities?market=gone&page=gone-1'
    const source = fakeSource()
    const view = renderScreen(source)
    await view.findByTestId('mix-caption')
    expect(source.requests.at(-1)).toMatchObject({ scope: 'project', pageId: null, marketId: null })
  })

  it('sends a project with no checked page to the first-run flow', async () => {
    const view = renderScreen(uncheckedSource(), [])
    expect(await view.findByRole('heading', { name: 'No page checked yet' })).toBeTruthy()
    expect(view.getByRole('link', { name: /Set up your site/ }).getAttribute('href')).toBe(
      '#/start'
    )
    expect(view.queryByRole('tablist')).toBeNull()
    const results = await axe.run(view.container, AXE)
    expect(results.violations).toEqual([])
  })

  it('says a filtered scope has no check yet, with the filters still there', async () => {
    window.location.hash = '#/communities?page=page-2&market=mkt-uk'
    const view = renderScreen(uncheckedSource())
    const empty = await view.findByRole('heading', { name: 'No check in this scope yet' })
    expect(empty.parentElement?.textContent).toContain('No check yet for Pricing in')
    expect(view.getByRole('combobox', { name: 'Page' })).toBeTruthy()
    expect(view.queryByRole('link', { name: /Set up your site/ })).toBeNull()
  })

  it('has no axe violations on any section tab', async () => {
    const view = renderScreen()
    await view.findByTestId('mix-caption')
    for (const name of [/^Source mix/, /^Reddit/, /^YouTube/, /^Opportunities/]) {
      fireEvent.click(view.getByRole('tab', { name }))
      const results = await axe.run(view.container, AXE)
      expect(results.violations.map((item) => `${String(name)} ${item.id}`)).toEqual([])
    }
  })
})
