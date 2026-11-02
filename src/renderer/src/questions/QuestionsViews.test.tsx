// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
  type RenderResult
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TopicFolder } from '@shared/ipc'
import { axeViolations } from '../ui/axe.test-helper'
import { resetUndoToastForTests } from '../ui/undoStore'
import { resetScreenViewMemory } from '../ui/useScreenView'
import { QuestionsScreen } from './QuestionsScreen'
import { fakeSource, query, type FakeSource } from './questions.screen.test-helper'

const FOLDER: TopicFolder = {
  id: 'fold-1',
  name: 'Carrier shutdowns',
  createdAt: '2026-10-01T09:00:00.000Z',
  topicIds: ['topic-1']
}

/** The screen's URL; the view is named, since a picked view is remembered. */
function at(query: string): void {
  window.history.replaceState(null, '', `#/questions?${query}`)
}

beforeEach(() => {
  // Each test starts with no remembered view, so none is written onto a new route.
  resetScreenViewMemory()
  at('view=list')
})

afterEach(() => {
  cleanup()
  resetUndoToastForTests()
})

async function shown(
  folders: readonly TopicFolder[] = [FOLDER]
): Promise<{ view: RenderResult; source: FakeSource }> {
  const source = fakeSource()
  source['topics:folders'] = vi.fn(async () => ({ projectId: 'proj-1', folders: [...folders] }))
  const view = render(<QuestionsScreen projectId="proj-1" source={source} viewStore={null} />)
  await view.findByRole('heading', { level: 1 })
  await waitFor(() => expect(view.queryByText('Loading questions…')).toBeNull())
  return { view, source }
}

describe('Questions views', () => {
  it('opens on the List, with List · Tree · Grid · Pages tabs that have their own URLs', async () => {
    const { view } = await shown()
    const tabs = view.getByRole('tablist', { name: 'Questions views' })
    const names = within(tabs)
      .getAllByRole('tab')
      .map((tab) => tab.textContent)
    expect(names).toEqual(['List', 'Tree', 'Grid', 'Pages'])
    expect(within(tabs).getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(view.getByRole('grid', { name: 'Questions' })).toBeTruthy()
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Tree' }))
    await view.findByRole('treegrid', { name: 'Every search by topic and result' })
    expect(query().get('view')).toBe('tree')
  })

  it('the Tree groups every search by topic or page, then result', async () => {
    at('view=tree')
    const { view } = await shown()
    const tree = await view.findByRole('treegrid', { name: 'Every search by topic and result' })
    // The tree starts closed; Expand all opens it.
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(within(tree).getByText('Business texting')).toBeTruthy()
    expect(
      within(tree).getByRole('columnheader', { name: /^Topic or page › Result › Search/ })
    ).toBeTruthy()
    // A tracked page shows as its path, with its site icon, Copy and Open.
    expect(within(tree).getByRole('button', { name: 'Copy /pricing/' })).toBeTruthy()
    expect(within(tree).queryByText('Pricing')).toBeNull()
    expect(within(tree).getByText('best business texting app for small teams')).toBeTruthy()
    expect(within(tree).getByText('how much does TextBolt cost')).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('the Grid has a row per topic or page; each count opens its drill on Questions', async () => {
    at('view=grid')
    const { view } = await shown()
    const table = await view.findByRole('table')
    const links = within(table)
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
    const drill = links.find((href) => href.includes('d.result=not_cited'))
    expect(drill).toBeDefined()
    expect(drill).toContain('drawer=search-drill')
    expect(drill).toContain('d.source=topic-1')
    // The List's own filters keep their plain names; the drill's carry the prefix.
    expect(links.some((href) => /[?&]result=/.test(href))).toBe(false)
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('a drill URL opens a drawer over the views, with What to do and Get fix brief', async () => {
    at('view=grid&drawer=search-drill&d.result=not_cited')
    const { view } = await shown()
    const drawer = await view.findByRole('dialog', { name: 'Searches where you are not cited' })
    expect(within(drawer).getByText(/1 of 4 searches · US · EN/)).toBeTruthy()
    expect(within(drawer).getByText('What to do:')).toBeTruthy()
    const grid = within(drawer).getByRole('grid', {
      name: 'Questions: Searches where you are not cited'
    })
    expect(within(grid).getByText('best business texting app for small teams')).toBeTruthy()
    expect(grid.textContent).not.toContain('how much does TextBolt cost')
    // The KPI strip and the view tabs stay behind it; closing is Back to all.
    expect(view.getByRole('region', { name: 'Questions summary' })).toBeTruthy()
    expect(view.getByRole('tablist', { name: 'Questions views' })).toBeTruthy()
    expect(within(drawer).queryByRole('link', { name: /Back to all/ })).toBeNull()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Get fix brief for this one' }))
    expect(await axeViolations(view.container)).toEqual([])
    // One search falls in one page fix: its drawer opens over Questions, stacked on this one.
    await waitFor(() =>
      expect(window.location.hash).toMatch(
        /^#\/questions\?view=grid&drawer=search-drill&d\.result=not_cited&drawer=page-fix&pfx\.id=pf\w+$/
      )
    )
  })

  it('the List result filter stays a List filter, not a drill', async () => {
    at('view=list&result=cited')
    const { view } = await shown()
    const grid = await view.findByRole('grid', { name: 'Questions' })
    expect(grid.textContent).toContain('how much does TextBolt cost')
    expect(within(grid).queryByText('best business texting app for small teams')).toBeNull()
    expect(view.getByRole('tablist', { name: 'Questions views' })).toBeTruthy()
  })

  it('a folder link narrows every view to its topics, and ✕ shows them all again', async () => {
    at('view=list&folder=fold-1')
    const { view } = await shown()
    await view.findByText('Folder: Carrier shutdowns')
    const grid = view.getByRole('grid', { name: 'Questions' })
    await waitFor(() => expect(grid.textContent).not.toContain('how much does TextBolt cost'))
    expect(within(grid).getByText('best business texting app for small teams')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Remove filter Folder: Carrier shutdowns' }))
    await waitFor(() => expect(grid.textContent).toContain('how much does TextBolt cost'))
    expect(query().get('folder')).toBeNull()
  })

  it('an old folder drill link opens the drawer, which names the folder; Close keeps it', async () => {
    at('view=grid&folder=fold-1&d.result=not_cited')
    const { view } = await shown()
    const drawer = await view.findByRole('dialog')
    expect(query().getAll('drawer')).toEqual(['search-drill'])
    expect(within(drawer).getByText(/1 of 1 searches in Carrier shutdowns/)).toBeTruthy()
    expect(
      within(drawer).getByRole('grid', {
        name: 'Carrier shutdowns: Searches where you are not cited'
      })
    ).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(query().get('d.result')).toBeNull())
    expect(query().get('folder')).toBe('fold-1')
    expect(query().get('view')).toBe('grid')
    expect(view.getByText('Folder: Carrier shutdowns')).toBeTruthy()
  })
})
