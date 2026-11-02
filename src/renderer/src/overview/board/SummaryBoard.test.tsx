// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeMetrics, type MetricRow } from '@shared/metrics'
import { input, pageRows } from '@shared/metrics/fixtures.test-helper'
import type { SummaryBoard } from '@shared/summary-board'
import { UndoToastHost } from '../../ui'
import { hideUndo } from '../../ui/undoStore'
import { axeViolations } from '../../ui/axe.test-helper'
import type { OverviewClient } from '../client'
import { OverviewScreen } from '../index'
import { drawerRows, fakeClient, overview } from '../overviewScreen.test-helper'
import { resetCachedReads } from '../widgets/useCachedRead'
import { resetBoardMemory, type BoardStore } from './store'

function memoryStore(): BoardStore & { saved: SummaryBoard | null; sets: number } {
  const store = {
    saved: null as SummaryBoard | null,
    sets: 0,
    get: async () => store.saved,
    set: async (_projectId: string, board: SummaryBoard) => {
      store.saved = board
      store.sets += 1
    }
  }
  return store
}

/** The fixture page's rows on Google, and the same answers on ChatGPT. */
function rows(): MetricRow[] {
  const google = pageRows()
  return [
    ...google,
    ...google.map((item) => ({ ...item, id: `${item.id}:chatgpt`, engine: 'chatgpt' as const }))
  ]
}

/** The overview, with the shared metrics on ChatGPT and Google for the widgets. */
function client(): OverviewClient {
  const base = fakeClient(() => overview()).client
  return {
    ...base,
    'engines:summary': async () => ({
      projectId: 'proj-1',
      engines: ['google_aio', 'chatgpt'],
      counts: [],
      questions: []
    }),
    'reports:metrics': async (request) => computeMetrics(input(rows(), { engine: request.engine }))
  }
}

function kinds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('[data-widget-id]')].map((node) =>
    node.getAttribute('data-kind')
  )
}

beforeEach(() => {
  window.location.hash = '#/overview'
})

afterEach(() => {
  cleanup()
  hideUndo()
  window.location.hash = ''
  resetBoardMemory()
  resetCachedReads()
})

async function open(store: BoardStore): Promise<ReturnType<typeof render>> {
  const view = render(
    <>
      <OverviewScreen projectId="proj-1" client={client()} boardStore={store} />
      <UndoToastHost />
    </>
  )
  await view.findByRole('region', { name: 'Headline numbers' })
  return view
}

describe('Summary as widgets', () => {
  it('opens Edit mode on the URL, moves and sizes a widget by keyboard, and keeps it', async () => {
    const store = memoryStore()
    const view = await open(store)
    fireEvent.click(view.getByRole('button', { name: 'Edit widgets' }))
    expect(window.location.hash).toBe('#/overview?edit=1')
    const handle = await view.findByRole('button', { name: 'Move Headline numbers' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    await waitFor(() => expect(kinds(view.container).slice(0, 2)).toEqual(['results', 'headline']))
    expect(view.getByText(/Headline numbers moved: place 2 of 6/)).toBeTruthy()
    fireEvent.keyDown(handle, { key: 'l' })
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-kind="headline"]')?.getAttribute('data-size')
      ).toBe('l')
    )
    // The size buttons do the same.
    const size = view.getByRole('group', { name: 'Size of Who gets cited' })
    fireEvent.click(within(size).getByRole('button', { name: 'Wide' }))
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-kind="cited-sites"]')?.getAttribute('data-size')
      ).toBe('w')
    )
    expect(store.saved?.widgets.map((widget) => widget.kind).slice(0, 2)).toEqual([
      'results',
      'headline'
    ])
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Done' }))
    expect(window.location.hash).toBe('#/overview')

    // A new session reads the saved board back.
    cleanup()
    resetBoardMemory()
    const again = await open(store)
    expect(kinds(again.container).slice(0, 2)).toEqual(['results', 'headline'])
  })

  it('removes a widget with Undo', async () => {
    window.location.hash = '#/overview?edit=1'
    const view = await open(memoryStore())
    fireEvent.click(await view.findByRole('button', { name: 'Remove Next fixes' }))
    await waitFor(() => expect(kinds(view.container)).not.toContain('next-fixes'))
    expect(view.getByText('Removed Next fixes from Summary.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(kinds(view.container)[4]).toBe('next-fixes'))
  })

  it('adds a widget from the gallery, with its own engine filter and drills', async () => {
    window.location.hash = '#/overview?edit=1'
    const view = await open(memoryStore())
    fireEvent.click(view.getByRole('button', { name: 'Add widget' }))
    expect(window.location.hash).toBe('#/overview?edit=1&add=1')
    const gallery = await view.findByRole('dialog', { name: 'Add a widget' })
    fireEvent.click(within(gallery).getByRole('button', { name: 'Add Cited rate' }))
    await waitFor(() => expect(kinds(view.container).at(-1)).toBe('cited-rate'))
    expect(view.queryByRole('dialog', { name: 'Add a widget' })).toBeNull()
    expect(window.location.hash).toBe('#/overview?edit=1')
    fireEvent.click(view.getByRole('button', { name: 'Done' }))

    const card = view.container.querySelector('[data-kind="cited-rate"]') as HTMLElement
    // Small widgets pick their engine from a menu.
    fireEvent.click(within(card).getByRole('button', { name: /^Engine for Cited rate/ }))
    fireEvent.click(await view.findByRole('menuitemradio', { name: 'ChatGPT' }))
    const metrics = computeMetrics(input(rows(), { engine: 'chatgpt' }))
    const cited = await within(card).findByRole('button', {
      name: `${metrics.now.cited.n} answers on ChatGPT cite you`
    })
    fireEvent.click(cited)
    const dialog = await view.findByRole('dialog', { name: /cite you/ })
    expect(await drawerRows(dialog)).toBe(metrics.now.cited.n)
  })

  it('fills the board from a role preset, with Undo', async () => {
    window.location.hash = '#/overview?edit=1&add=1'
    const view = await open(memoryStore())
    const gallery = await view.findByRole('dialog', { name: 'Add a widget' })
    fireEvent.click(
      within(gallery).getByRole('button', { name: 'Use the Content publisher layout' })
    )
    await waitFor(() => expect(kinds(view.container)[0]).toBe('next-fixes'))
    expect(kinds(view.container)).toContain('page-changes')
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(kinds(view.container)[0]).toBe('headline'))
  })
})
