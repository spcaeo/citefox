// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScreenView, resetScreenViewMemory, type ScreenViewStore } from './useScreenView'
import { ViewTabs } from './ViewTabs'
import type { ScreenView } from './viewTabsModel'

const VIEWS: readonly ScreenView[] = ['tree', 'grid', 'list', 'pages', 'progress']

function memoryStore(start: Record<string, string> = {}): ScreenViewStore & {
  saved: Record<string, string>
} {
  const saved: Record<string, string> = { ...start }
  return {
    saved,
    get: vi.fn(
      async (projectId: string, screen: string) => saved[`${projectId}/${screen}`] ?? null
    ),
    set: vi.fn(async (projectId: string, screen: string, view: string) => {
      saved[`${projectId}/${screen}`] = view
    })
  }
}

function Screen({
  store,
  projectId = 'p1',
  screen = 'topic'
}: {
  store: ScreenViewStore | null
  projectId?: string | null
  screen?: string
}): JSX.Element {
  const { view, setView, hrefFor } = useScreenView(screen, VIEWS, 'tree', { projectId, store })
  return (
    <>
      <ViewTabs
        views={['tree', 'grid', 'list', 'pages']}
        trailing="progress"
        value={view}
        onChange={setView}
        hrefFor={hrefFor}
      />
      <output data-testid="view">{view}</output>
    </>
  )
}

function setHash(hash: string): void {
  act(() => {
    window.history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

beforeEach(() => {
  resetScreenViewMemory()
  window.history.replaceState(null, '', '#/topics/t1')
})

afterEach(cleanup)

describe('ViewTabs', () => {
  it('draws icon tabs, a divided trailing tab and the remembered note', () => {
    const view = render(
      <ViewTabs
        views={['tree', 'grid', { id: 'list', count: 12 }, 'pages']}
        trailing="progress"
        value="grid"
        onChange={() => undefined}
      />
    )
    const tabs = view.getAllByRole('tab')
    expect(tabs.map((tab) => tab.querySelector('.ui-tab-label')?.textContent)).toEqual([
      'Tree',
      'Grid',
      'List',
      'Pages',
      'Progress'
    ])
    for (const tab of tabs) expect(tab.querySelector('svg.ui-icon')).not.toBeNull()
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[4]?.className).toContain('ui-tab-divided')
    expect(tabs[3]?.className).not.toContain('ui-tab-divided')
    expect(tabs[2]?.textContent).toContain('12')
    expect(view.getByRole('tablist').getAttribute('aria-label')).toBe('Views')
    // The view is remembered without saying so.
    expect(view.queryByText('Your view is remembered')).toBeNull()
  })

  it('takes its own words and an optional note', () => {
    const view = render(
      <ViewTabs
        views={[{ id: 'folders', label: 'Folders', icon: 'folder' }, 'list']}
        value="list"
        onChange={() => undefined}
        note="Synced today"
      />
    )
    expect(view.getByText('Folders')).toBeTruthy()
    expect(view.getByText('Synced today')).toBeTruthy()
  })

  it('moves with the arrow keys like every tab row', () => {
    const onChange = vi.fn()
    const view = render(<ViewTabs views={['tree', 'grid']} value="tree" onChange={onChange} />)
    fireEvent.keyDown(view.getAllByRole('tab')[0] as HTMLElement, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith('grid')
  })
})

describe('useScreenView', () => {
  it('shows the default, then a pick goes into the URL and is remembered', async () => {
    const store = memoryStore()
    const view = render(<Screen store={store} />)
    await waitFor(() => expect(store.get).toHaveBeenCalledWith('p1', 'topic'))
    expect(view.getByTestId('view').textContent).toBe('tree')
    fireEvent.click(view.getByRole('tab', { name: /Grid/ }))
    expect(view.getByTestId('view').textContent).toBe('grid')
    await waitFor(() => expect(window.location.hash).toBe('#/topics/t1?view=grid'))
    expect(store.saved['p1/topic']).toBe('grid')
  })

  it('gives each tab its URL with the other query values kept', () => {
    window.history.replaceState(null, '', '#/topics/t1?tab=x')
    const view = render(<Screen store={null} />)
    expect(view.getByRole('tab', { name: /List/ }).getAttribute('href')).toBe(
      '#/topics/t1?tab=x&view=list'
    )
  })

  it('opens the view the URL names, and remembers it', async () => {
    window.history.replaceState(null, '', '#/topics/t1?view=pages')
    const store = memoryStore({ 'p1/topic': 'grid' })
    const view = render(<Screen store={store} />)
    expect(view.getByTestId('view').textContent).toBe('pages')
    await waitFor(() => expect(store.saved['p1/topic']).toBe('pages'))
  })

  it('opens the remembered view when the URL names none, and writes it in place', async () => {
    const store = memoryStore({ 'p1/topic': 'list' })
    const before = window.history.length
    const view = render(<Screen store={store} />)
    await waitFor(() => expect(view.getByTestId('view').textContent).toBe('list'))
    await waitFor(() => expect(window.location.hash).toBe('#/topics/t1?view=list'))
    expect(window.history.length).toBe(before)
  })

  it('keeps a view per project and per screen', async () => {
    const store = memoryStore({ 'p1/topic': 'list', 'p2/topic': 'grid', 'p1/pages': 'tree' })
    const first = render(<Screen store={store} projectId="p2" />)
    await waitFor(() => expect(first.getByTestId('view').textContent).toBe('grid'))
    cleanup()
    window.history.replaceState(null, '', '#/pages')
    const second = render(<Screen store={store} screen="pages" />)
    await waitFor(() => expect(store.get).toHaveBeenCalledWith('p1', 'pages'))
    expect(second.getByTestId('view').textContent).toBe('tree')
  })

  it('follows Back and Forward through the URL', async () => {
    const view = render(<Screen store={memoryStore()} />)
    setHash('#/topics/t1?view=grid')
    expect(view.getByTestId('view').textContent).toBe('grid')
    setHash('#/topics/t1?view=progress')
    expect(view.getByTestId('view').textContent).toBe('progress')
    setHash('#/topics/t1?view=nonsense')
    // An unknown view falls back to the remembered one (progress, just seen).
    await waitFor(() => expect(view.getByTestId('view').textContent).toBe('progress'))
  })

  it('works with no project or store, from the URL only', () => {
    window.history.replaceState(null, '', '#/topics/t1?view=list')
    const view = render(<Screen store={null} projectId={null} />)
    expect(view.getByTestId('view').textContent).toBe('list')
  })

  it('opens a second visit at once from memory', async () => {
    const store = memoryStore({ 'p1/topic': 'grid' })
    const first = render(<Screen store={store} />)
    await waitFor(() => expect(first.getByTestId('view').textContent).toBe('grid'))
    cleanup()
    window.history.replaceState(null, '', '#/topics/t1')
    const second = render(<Screen store={store} />)
    expect(second.getByTestId('view').textContent).toBe('grid')
    expect(store.get).toHaveBeenCalledTimes(1)
  })
})
