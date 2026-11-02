// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CoverageFinding } from '@shared/domain'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockAssistClient } from '../assist/client'
import type { ShellClient } from '../projects/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { GapsScreen } from './GapsScreen'

afterEach(cleanup)
beforeEach(() => {
  window.location.hash = ''
})

const AXE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const FINDING: CoverageFinding = {
  id: 'finding-1',
  runId: 'run-1',
  pageId: 'alerts',
  kind: 'title_length',
  summary: 'The title is too long for search results.',
  detail: 'It runs past 60 characters.'
}

function setup(focus: string | null = null): ReturnType<typeof render> & { marketId: string } {
  const base = createMockShellClient({
    catalog: textboltCatalog(),
    activeStore: memoryActiveProjectStore()
  })
  const client: ShellClient = {
    ...base,
    getGaps: async (request) => {
      const matrix = await base.getGaps(request)
      return matrix ? { ...matrix, findings: [FINDING] } : matrix
    }
  }
  const page = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')
  const marketId = page.markets[0]?.id ?? ''
  const view = render(
    <GapsScreen
      client={client}
      templatesClient={createMockTemplatesClient()}
      projectId="textbolt"
      page={page}
      marketId={marketId}
      focus={focus}
      assistClient={createMockAssistClient()}
    />
  )
  return Object.assign(view, { marketId })
}

function drawerTotal(): number {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (!dialog) throw new Error('no drawer open')
  // The grid's row count includes its header row; an empty drawer draws no grid.
  const grid = within(dialog).queryByRole('grid')
  return grid ? Number(grid.getAttribute('aria-rowcount')) - 1 : 0
}

function closeDrawer(): void {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  if (dialog) fireEvent.keyDown(dialog, { key: 'Escape' })
}

describe('Content gaps drill-downs', () => {
  it('every drill opens a drawer whose total equals the number clicked (NFR-14)', async () => {
    const view = setup()
    await view.findByRole('grid', { name: 'Coverage matrix' })
    const openers = [...view.container.querySelectorAll<HTMLElement>('[data-nfr-drill]')]
    // The two counts of zero are plain text (nothing to open), not buttons.
    expect(openers.length).toBeGreaterThanOrEqual(4 + 2 + 5 + 4 - 2)
    expect((await axe.run(view.container, AXE_RULES)).violations).toEqual([])
    for (const opener of openers) {
      expect(opener.tagName).toBe('BUTTON')
      const id = opener.getAttribute('data-nfr-drill') ?? ''
      const figure = view.container.querySelector(`[data-nfr-figure="${id}"]`)
      expect(figure, id).not.toBeNull()
      fireEvent.click(opener)
      expect(drawerTotal(), id).toBe(Number(figure?.textContent))
      closeDrawer()
      await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    }
  }, 30_000)

  it('tile, chart segment and counts table agree with the coverage chart', async () => {
    const view = setup()
    const chart = await view.findByRole('group', { name: /^Coverage chart\. Strong 5/ })
    const segment = within(chart).getByRole('button', { name: '5 questions with Strong coverage' })
    fireEvent.click(segment)
    const dialog = view.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Strong coverage · 5 questions' })
    ).toBeTruthy()
    expect(drawerTotal()).toBe(5)
    closeDrawer()
    const table = view.getByRole('list', { name: 'Coverage counts' })
    fireEvent.click(within(table).getByRole('button', { name: '10 questions in total' }))
    expect(drawerTotal()).toBe(10)
  })

  it('a tile name toggles the matrix filter; its question numbers open Question detail', async () => {
    const view = setup()
    await view.findByRole('grid', { name: 'Coverage matrix' })
    const toggle = view.getByRole('button', { name: /^Strong: show only/ })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(view.getByText('Showing 5 of 10 questions')).toBeTruthy()
    const summary = view.getByRole('region', { name: 'Coverage summary' })
    const ids = within(summary).getAllByRole('link', {
      name: /^Question \d+: open Question detail/
    })
    expect(ids).toHaveLength(10)
    expect(ids[0]?.getAttribute('href')).toMatch(
      new RegExp(`^#/pages/alerts/prompt/[^?]+\\?market=${view.marketId}$`)
    )
  })

  it('matrix question labels open Question detail in the page market', async () => {
    const view = setup()
    const grid = await view.findByRole('grid', { name: 'Coverage matrix' })
    const links = within(grid).getAllByRole('link', { name: /open Question detail$/ })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.getAttribute('href')).toContain(`?market=${view.marketId}`)
    }
  })

  it('a row click opens, scrolls to and focuses its one-by-one item', async () => {
    const view = setup()
    const grid = await view.findByRole('grid', { name: 'Coverage matrix' })
    const row = grid.querySelector<HTMLElement>('.ui-lg-row')
    if (!row) throw new Error('no row')
    const position = row.querySelector('.gp-q')?.textContent ?? ''
    expect(position).not.toBe('')
    fireEvent.click(row.querySelector<HTMLElement>('.gp-gap') ?? row)
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null
      expect(active?.classList.contains('ps-acc-btn')).toBe(true)
      expect(active?.getAttribute('aria-expanded')).toBe('true')
    })
    expect(document.activeElement?.textContent?.startsWith(position)).toBe(true)
    expect(view.getByRole('tab', { name: /^One by one/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(window.location.hash).toMatch(/^#\/pages\/alerts\/gaps\?.*filter=row%3A/)
  })

  it('Enter on a row opens and focuses its one-by-one item; Enter on a link does not', async () => {
    const view = setup()
    const grid = await view.findByRole('grid', { name: 'Coverage matrix' })
    const rows = grid.querySelectorAll<HTMLElement>('.ui-lg-row')
    const row = rows[1]
    if (!row) throw new Error('no second row')
    const link = within(row).getAllByRole('link')[0] as HTMLElement
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    const position = row.querySelector('.gp-q')?.textContent ?? ''
    row.focus()
    fireEvent.keyDown(row, { key: 'Enter' })
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-expanded')).toBe('true'))
    expect(document.activeElement?.textContent?.startsWith(position)).toBe(true)
  })

  it('source and action cells and the row menu filter the matrix with removable chips', async () => {
    const view = setup()
    const grid = await view.findByRole('grid', { name: 'Coverage matrix' })
    const source = within(grid).getAllByRole('button', { name: /^Filter by source: / })[0]
    if (!source) throw new Error('no source button')
    const name = (source.getAttribute('aria-label') ?? '').replace('Filter by source: ', '')
    fireEvent.click(source)
    const chips = view.getByRole('list', { name: 'Filters from the matrix' })
    const chip = within(chips).getByRole('button', { name: `Remove filter Source: ${name}` })
    expect(view.getByText(/^Showing \d+ of 10 questions$/)).toBeTruthy()
    fireEvent.click(chip)
    expect(view.queryByRole('list', { name: 'Filters from the matrix' })).toBeNull()
    expect(view.getByText('Showing 10 questions')).toBeTruthy()

    const action = within(grid).getAllByRole('button', { name: /^Filter by action / })[0]
    if (!action) throw new Error('no action button')
    fireEvent.click(action)
    expect(view.getByRole('list', { name: 'Filters from the matrix' })).toBeTruthy()
    fireEvent.click(
      within(view.getByRole('list', { name: 'Filters from the matrix' })).getByRole('button')
    )

    const menuButton = within(view.getByRole('grid', { name: 'Coverage matrix' })).getAllByRole(
      'button',
      { name: /^Actions for question \d+$/ }
    )[0]
    if (!menuButton) throw new Error('no row menu')
    fireEvent.click(menuButton)
    const stage = within(document.body).getByRole('menuitem', { name: /^Only .+ questions$/ })
    const stageName = (stage.textContent ?? '').replace(/^Only /, '').replace(/ questions$/, '')
    fireEvent.click(stage)
    expect(
      within(view.getByRole('list', { name: 'Filters from the matrix' })).getByRole('button', {
        name: `Remove filter Stage: ${stageName}`
      })
    ).toBeTruthy()
  })

  it('the coverage segment filters the matrix and the tiles follow', async () => {
    const view = setup()
    await view.findByRole('grid', { name: 'Coverage matrix' })
    const segment = view.getByRole('group', { name: 'Filter by coverage' })
    fireEvent.click(within(segment).getByRole('button', { name: /^Strong/ }))
    expect(view.getByText('Showing 5 of 10 questions')).toBeTruthy()
    expect(
      view.getByRole('button', { name: /^Strong: show only/ }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('a route focus opens and focuses that question one by one', async () => {
    const base = createMockShellClient({
      catalog: textboltCatalog(),
      activeStore: memoryActiveProjectStore()
    })
    const matrix = await base.getGaps({ projectId: 'textbolt', pageId: 'alerts' })
    const target = matrix?.rows[4]
    if (!target) throw new Error('mock matrix has fewer than 5 rows')
    setup(`row:${target.promptId}`)
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null
      expect(active?.closest('article')?.id).toBe(`gap-${target.id}`)
      expect(active?.getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('one by one links to the AI Overview and page-wide fixes link to their source', async () => {
    const view = setup()
    await view.findByRole('grid', { name: 'Coverage matrix' })
    fireEvent.click(view.getByRole('tab', { name: /^One by one/ }))
    const overview = await view.findByRole('link', { name: "See this question's AI Overview" })
    expect(overview.getAttribute('href')).toContain(`?market=${view.marketId}`)
    expect(window.location.hash).toContain('filter=view%3Aone')
    fireEvent.click(view.getByRole('tab', { name: /^Page-wide fixes/ }))
    const fixes = view.getByRole('region', { name: 'Page-wide fixes' })
    expect(
      within(fixes).getByRole('link', { name: 'See shorter title options' }).getAttribute('href')
    ).toBe('#/pages/alerts/read')
    const plan = within(fixes).getByRole('link', { name: /^Plan as a fix/ })
    expect(plan.getAttribute('href')).toMatch(
      /^#\/pages\/alerts\/progress\?view=fixes&drawer=fix&fix=new&fix\.page=alerts&fix\.text=/
    )
    expect((await axe.run(view.container, AXE_RULES)).violations).toEqual([])
  })

  it('a route view opens that tab', async () => {
    const view = setup('view:fixes')
    expect(
      (await view.findByRole('tab', { name: /^Page-wide fixes/ })).getAttribute('aria-selected')
    ).toBe('true')
    expect(view.getByRole('region', { name: 'Page-wide fixes' })).toBeTruthy()
  })
})
