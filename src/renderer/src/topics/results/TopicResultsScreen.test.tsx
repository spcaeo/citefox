// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  TEXTBOLT_TOPIC_ID,
  TEXTBOLT_TOPIC_PROJECT_ID,
  textboltTopicResults
} from '@shared/fixtures/textbolt-topic'
import { DrillHost } from '../../drill'
import { axeViolations } from '../../ui/axe.test-helper'
import { ATT_TOPIC_ID, attFirstCheck, attTopicResults } from '../views/fixtures.test-helper'
import { searchesOfTopic, totalsOf } from '../views/model'
import { TopicResultsScreen } from '.'
import { createMockTopicResultsSource } from './source/mock'

const fixture = textboltTopicResults()
const totals = totalsOf(searchesOfTopic(fixture))
const topicName = fixture.topic.name

function renderScreen(options: { filter?: string | null } = {}): {
  view: ReturnType<typeof render>
  source: ReturnType<typeof createMockTopicResultsSource>
} {
  const source = createMockTopicResultsSource()
  const view = render(
    <DrillHost>
      <TopicResultsScreen
        projectId={TEXTBOLT_TOPIC_PROJECT_ID}
        projectName="TextBolt"
        topicId={TEXTBOLT_TOPIC_ID}
        filter={options.filter ?? null}
        source={source}
        viewStore={null}
      />
    </DrillHost>
  )
  return { view, source }
}

/** The AT&T topic (12 searches) through the mock source, or its quiet first check. */
function renderAtt(first = false, view = 'tree'): ReturnType<typeof render> {
  const base = createMockTopicResultsSource()
  const source = {
    ...base,
    results: async () => (first ? attFirstCheck() : attTopicResults())
  }
  window.location.hash = `#/topics/${ATT_TOPIC_ID}?view=${view}`
  return render(
    <DrillHost>
      <TopicResultsScreen
        projectId={TEXTBOLT_TOPIC_PROJECT_ID}
        projectName="TextBolt"
        topicId={ATT_TOPIC_ID}
        source={source}
        viewStore={null}
      />
    </DrillHost>
  )
}

function at(query = ''): void {
  window.location.hash = `#/topics/${TEXTBOLT_TOPIC_ID}${query ? `?${query}` : ''}`
}

beforeEach(() => {
  at()
  try {
    localStorage.clear()
  } catch {
    // happy-dom always has storage; keep the guard the screen uses.
  }
})

afterEach(cleanup)

describe('TopicResultsScreen', () => {
  test('shows the header and the summary card with Needs work, and no second breadcrumb', async () => {
    const { view } = renderScreen()
    expect(await view.findByRole('heading', { level: 1, name: topicName })).toBeTruthy()
    // The top bar's breadcrumb is the only trail (Vibe: one per page).
    expect(view.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    const summary = view.getByRole('region', { name: 'Topic summary' })
    expect(summary.textContent).toContain(`${totals.searches} searches`)
    expect(summary.textContent).toContain(`Needs work: ${totals.needsWork}`)
    expect(
      within(summary)
        .getByRole('link', { name: /shown in Fixes as \d+ page fix/ })
        .getAttribute('href')
    ).toBe(`#/fixes?topic=${TEXTBOLT_TOPIC_ID}`)
    // The old To-do tab and its words are gone.
    expect(view.queryByRole('tab', { name: /To-do/ })).toBeNull()
    expect(view.container.textContent).not.toMatch(/To-do/)
    // Check now starts the check on this screen.
    const hashBefore = window.location.hash
    fireEvent.click(view.getByRole('button', { name: /Check now/ }))
    expect(window.location.hash).toBe(hashBefore)
    fireEvent.click(view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Export report' }))
    expect(window.location.hash).toBe(`#/export?page=${TEXTBOLT_TOPIC_ID}`)
  })

  test('the Tree groups add up to All, and a count opens its searches in a drawer over the Tree', async () => {
    at('view=tree')
    const { view } = renderScreen()
    const grid = await view.findByRole('treegrid', {
      name: `${topicName}: searches by stage and result`
    })
    const all = within(grid).getByRole('link', {
      name: `All: open these ${totals.searches} searches`
    })
    expect(all.textContent).toBe(String(totals.searches))
    const stageLinks = within(grid)
      .getAllByRole('link', { name: /^[A-Z][a-z]+: open these \d+ searches$/ })
      .filter((link) => !link.getAttribute('aria-label')?.startsWith('All'))
    const stageSum = stageLinks.reduce((sum, link) => sum + Number(link.textContent), 0)
    expect(stageSum).toBe(totals.searches)
    const count = Number(stageLinks[0]?.textContent)
    fireEvent.click(stageLinks[0] as HTMLElement)
    await waitFor(() => expect(window.location.hash).toMatch(/drawer=search-drill&stage=/))
    const drawer = await view.findByRole('dialog')
    expect(within(drawer).getByText('What to do:')).toBeTruthy()
    expect(
      within(drawer).getByText(new RegExp(`^${count} of ${totals.searches} searches in `))
    ).toBeTruthy()
    // The Tree stays behind it, with the topic's own header; no Back to all inside.
    expect(view.getByRole('treegrid', { name: `${topicName}: searches by stage and result` }))
    expect(view.getByRole('heading', { level: 1, name: topicName })).toBeTruthy()
    expect(within(drawer).queryByRole('link', { name: /Back to all/ })).toBeNull()
    expect(within(drawer).getByRole('button', { name: /Get fix brief for/ })).toBeTruthy()
    // Back closes it and leaves the Tree as it was.
    window.history.back()
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe(`#/topics/${TEXTBOLT_TOPIC_ID}?view=tree`)
    // Close does the same.
    fireEvent.click(stageLinks[0] as HTMLElement)
    const again = await view.findByRole('dialog')
    fireEvent.click(within(again).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() =>
      expect(window.location.hash).toBe(`#/topics/${TEXTBOLT_TOPIC_ID}?view=tree`)
    )
    expect(view.getByRole('treegrid', { name: `${topicName}: searches by stage and result` }))
  })

  test('an old drill link opens the drawer, which lists exactly the drilled searches', async () => {
    at('view=grid&result=not_cited')
    const { view } = renderScreen()
    const drawer = await view.findByRole('dialog', { name: 'Searches where you are not cited' })
    // The link is rewritten to the drawer's own; the Grid stays behind it.
    expect(window.location.hash).toBe(
      `#/topics/${TEXTBOLT_TOPIC_ID}?view=grid&drawer=search-drill&result=not_cited`
    )
    expect(view.getByRole('heading', { level: 2, name: 'Where you stand, by buyer stage' }))
    expect(
      within(drawer).getByText(
        new RegExp(`^${totals.counts.not_cited} of ${totals.searches} searches`)
      )
    ).toBeTruthy()
    expect(
      within(drawer).getByText(new RegExp(`Showing all ${totals.counts.not_cited}`))
    ).toBeTruthy()
    // The last filter's ✕ closes the drawer: no filter left is the Grid itself.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Remove filter Not cited' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).toBe(`#/topics/${TEXTBOLT_TOPIC_ID}?view=grid`)
    cleanup()

    // With two filters, each ✕ narrows the drawer to the other.
    at('view=grid&drawer=search-drill&stage=problem&result=not_cited')
    const two = renderScreen().view
    const both = await two.findByRole('dialog')
    expect(
      within(both)
        .getByRole('link', { name: /^Remove filter Stage:/ })
        .getAttribute('href')
    ).toBe(`#/topics/${TEXTBOLT_TOPIC_ID}?view=grid&drawer=search-drill&result=not_cited`)
    fireEvent.click(await within(both).findByRole('button', { name: /Get fix brief for/ }))
    // The brief is the page fix's own, in its drawer over the topic (never a move to Fixes).
    await waitFor(() =>
      expect(window.location.hash).toMatch(
        new RegExp(`^#/topics/${TEXTBOLT_TOPIC_ID}\\?view=grid&.*drawer=page-fix&pfx\\.id=pf\\w+`)
      )
    )
  })

  test('Needs work and Target cited totals drill, in the Tree and the Grid', async () => {
    at('view=tree')
    const { view } = renderScreen()
    const tree = await view.findByRole('treegrid', {
      name: `${topicName}: searches by stage and result`
    })
    const work = within(tree).getByRole('link', {
      name: `All · Needs work: open these ${totals.needsWork} searches`
    })
    expect(work.getAttribute('href')).toMatch(/[?&]work=1(&|$)/)
    const target = within(tree).getByRole('link', {
      name: new RegExp(`^All · Target cited ${totals.targetPct}%: open these`)
    })
    expect(target.getAttribute('href')).toMatch(/[?&]result=target(&|$)/)
    fireEvent.click(work)
    await waitFor(() => expect(window.location.hash).toContain('work=1'))
    const drawer = await view.findByRole('dialog', { name: 'Searches that need work' })
    expect(within(drawer).getByText(new RegExp(`Showing all ${totals.needsWork}`))).toBeTruthy()
    cleanup()

    at('view=grid')
    const grid = renderScreen().view
    const table = await grid.findByRole('table')
    expect(
      within(table).getByRole('link', {
        name: `All · Needs work: open these ${totals.needsWork} searches`
      })
    ).toBeTruthy()
  })

  test.each([
    ['tab=stage', 'view=grid'],
    ['tab=progress', 'view=progress'],
    ['tab=keywords', 'type=keyword'],
    ['tab=todo&filter=state:not_cited', 'result=not_cited'],
    ['filter=stage:problem', 'stage=problem']
  ])('an old link (%s) lands on the new view (%s)', async (old, expected) => {
    at(old)
    const { view } = renderScreen()
    await view.findAllByRole('heading', { level: 1 })
    await waitFor(() => expect(window.location.hash).toContain(expected))
    expect(window.location.hash).not.toContain('tab=')
    expect(window.location.hash).not.toContain('filter=')
  })

  test('Grid, List and Pages each show every search, and the totals add up', async () => {
    at('view=grid')
    const { view } = renderScreen()
    const table = await view.findByRole('table')
    const allRow = within(table)
      .getAllByRole('row')
      .find((row) => row.classList.contains('tv-grid-all'))
    expect(allRow?.textContent).toContain(String(totals.searches))
    expect(view.getByRole('region', { name: 'Best next move' })).toBeTruthy()
    fireEvent.click(view.getByRole('tab', { name: /List/ }))
    const list = await view.findByRole('grid', { name: `${topicName}: every search` })
    expect(list).toBeTruthy()
    expect(view.getAllByText(new RegExp(`${totals.searches} searches`)).length).toBeGreaterThan(0)
    fireEvent.click(view.getByRole('tab', { name: /Pages/ }))
    const pages = await view.findByRole('region', { name: 'Pages' })
    expect(pages.textContent).toContain('Your pages')
    expect(pages.textContent).toContain('Cited instead of you')
  })

  test('List ticks live in the URL and Get fix brief opens for the ticked searches', async () => {
    at('view=list')
    const { view } = renderScreen()
    const list = await view.findByRole('grid', { name: `${topicName}: every search` })
    const boxes = within(list).getAllByRole('checkbox', { name: /^Select [QK]\d+/ })
    fireEvent.click(boxes[0] as HTMLElement)
    fireEvent.click(boxes[1] as HTMLElement)
    await waitFor(() => expect(window.location.hash).toMatch(/sel=[^&]+%2C|sel=[^&]+,/))
    fireEvent.click(view.getByRole('button', { name: /Get fix brief/ }))
    await waitFor(() => expect(window.location.hash).toMatch(/drawer=page-fix&pfx\.id=pf\w+/))
    expect(window.location.hash).toMatch(new RegExp(`^#/topics/${TEXTBOLT_TOPIC_ID}\\?view=list`))
  })

  test('List: Change target on ticked searches opens the target drawer for them', async () => {
    at('view=list')
    const { view } = renderScreen()
    const list = await view.findByRole('grid', { name: `${topicName}: every search` })
    const box = within(list).getAllByRole('checkbox', { name: /^Select Q\d+/ })[0] as HTMLElement
    fireEvent.click(box)
    const bar = await view.findByRole('region', { name: 'Bulk actions' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Change target' }))
    await waitFor(() => expect(window.location.hash).toMatch(/drawer=topic-target&tt\.ids=/))
    expect(await view.findByRole('dialog', { name: /^Target pages for/ })).toBeTruthy()
  })

  test('the Questions/Keywords segment narrows the views and stays in the URL', async () => {
    at('view=list')
    const { view } = renderScreen()
    await view.findByRole('grid', { name: `${topicName}: every search` })
    fireEvent.click(view.getByRole('button', { name: /^Keywords/ }))
    await waitFor(() => expect(window.location.hash).toContain('type=keyword'))
    const rows = view.getAllByRole('row').filter((row) => /^\s*[QK]\d+/.test(row.textContent ?? ''))
    expect(rows.every((row) => /^\s*K\d+/.test(row.textContent ?? ''))).toBe(true)
  })

  test('Target bands opens from the URL as a drawer; Escape closes it and the URL loses it', async () => {
    at('drawer=topic-bands')
    const { view } = renderScreen()
    const drawer = await view.findByRole('dialog', { name: 'Target bands' })
    expect(drawer.getAttribute('data-drawer')).toBe('topic-bands')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(window.location.hash).not.toContain('drawer=')
  })

  test('Change target page from a link to questions that are gone says so', async () => {
    at('drawer=topic-target&tt.ids=gone-1')
    const { view } = renderScreen()
    const drawer = await view.findByRole('dialog', { name: 'Change target pages' })
    expect(drawer.textContent).toContain('These questions are not in this topic any more.')
  })

  test('Change target page opens from a target: link and saves', async () => {
    const target = fixture.rows.find((row) => row.kind === 'question' && row.state === 'no_page')
    if (!target) throw new Error('fixture needs a no-page question')
    const { view } = renderScreen({ filter: `target:${target.promptId}` })
    const dialog = await view.findByRole('dialog', { name: /Target pages for/ })
    const option = await within(dialog).findAllByRole('radio', { name: /^Primary: \// })
    fireEvent.click(option[0] as HTMLElement)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save target' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
  })

  test("the topic has one AI menu; Why isn't … cited? shows Claude's answer", async () => {
    const { view } = renderScreen()
    await view.findByRole('heading', { level: 1 })
    const menus = view.getAllByRole('button', { name: /^AI actions/ })
    expect(menus.map((button) => button.getAttribute('aria-label'))).toEqual([
      'AI actions for this topic'
    ])
    fireEvent.click(menus[0] as HTMLElement)
    fireEvent.click(await view.findByRole('menuitem', { name: /Why isn't [QK]\d+ cited\?/ }))
    expect(await view.findByText(/Most likely a wording and structure gap/)).toBeTruthy()
  })

  test('Ask about this topic opens Ask CiteFox scoped to the topic', async () => {
    const { view } = renderScreen()
    await view.findByRole('heading', { level: 1 })
    fireEvent.click(view.getByRole('button', { name: 'AI actions for this topic' }))
    fireEvent.click(await view.findByRole('menuitem', { name: /Ask about this topic/ }))
    expect(decodeURIComponent(window.location.hash)).toContain(
      `ask.about=topic:${TEXTBOLT_TOPIC_ID}`
    )
  })

  test('Progress keeps its own panel and one AI menu', async () => {
    at('view=progress')
    const { view } = renderScreen()
    expect(
      await view.findByRole('region', { name: 'Right page cited and goals per full check' })
    ).toBeTruthy()
    expect(
      view.getAllByRole('button', { name: /^AI actions/ }).map((b) => b.getAttribute('aria-label'))
    ).toEqual(['AI actions for progress'])
  })

  test('the Tree starts closed and Expand all shows every search: AT&T is 6 / 5 / 0 / 1 and Q3 shows', async () => {
    const view = renderAtt()
    const grid = await view.findByRole('treegrid')
    expect(
      within(grid)
        .getAllByRole('row')
        .filter((row) => /^\s*[QK]\d+/.test(row.textContent ?? ''))
    ).toHaveLength(0)
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    const leaves = within(grid)
      .getAllByRole('row')
      .filter((row) => /^\s*[QK]\d+/.test(row.textContent ?? ''))
    expect(leaves).toHaveLength(12)
    expect(leaves.some((row) => /^\s*Q3\D/.test(row.textContent ?? ''))).toBe(true)
    const summary = view.getByRole('region', { name: 'Topic summary' })
    expect(summary.textContent).toContain('12 searches')
    expect(summary.textContent).toContain('Needs work: 11')
    expect(
      within(summary).getByRole('link', { name: 'shown in Fixes as 6 page fixes' })
    ).toBeTruthy()
    expect(view.queryByRole('heading', { name: /Not cited anywhere yet/ })).toBeNull()
  })

  test('the Pages view starts with every page closed, and one Expand all / Collapse all', async () => {
    const view = renderAtt(false, 'pages')
    const pages = await view.findByRole('region', { name: 'Pages' })
    const toggles = (): HTMLElement[] =>
      within(pages)
        .getAllByRole('button', { name: /^(Open|Close) / })
        .filter((button) => button.hasAttribute('aria-expanded'))
    expect(toggles().length).toBeGreaterThan(0)
    expect(toggles().every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true)
    fireEvent.click(within(pages).getByRole('button', { name: 'Expand all' }))
    expect(toggles().every((button) => button.getAttribute('aria-expanded') === 'true')).toBe(true)
    fireEvent.click(within(pages).getByRole('button', { name: 'Collapse all' }))
    expect(toggles().every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true)
  })

  test('a quiet first check shows the calm card, three steps and Start with the best search', async () => {
    const view = renderAtt(true)
    const card = await view.findByRole('region', {
      name: "Not cited anywhere yet. That's normal for a first check."
    })
    expect(within(card).getAllByRole('listitem')).toHaveLength(3)
    expect(within(card).getByRole('button', { name: /^Start with Q\d+/ })).toBeTruthy()
    // Every search still shows.
    const grid = view.getByRole('treegrid')
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(
      within(grid)
        .getAllByRole('row')
        .filter((row) => /^\s*[QK]\d+/.test(row.textContent ?? ''))
    ).toHaveLength(12)
  })

  test.each(['tree', 'grid', 'list', 'pages', 'progress'])(
    'the %s view renders and has no axe violations',
    async (name) => {
      at(`view=${name}`)
      const { view } = renderScreen()
      await view.findByRole('heading', { level: 1 })
      await waitFor(() => expect(view.getByRole('tab', { selected: true })).toBeTruthy())
      expect(await axeViolations(view.container)).toEqual([])
    }
  )
})
