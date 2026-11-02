// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { JSX } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Drawer } from '../ui'
import { DrawerHost } from './DrawerHost'
import { DrawerTrailContext, type RouteCrumb } from './drawerCrumbs'
import { ScreenDrawerLevel } from './DrawerLevel'
import { closeDrawer, currentDrawers, openDrawer, resetDrawersForTests } from './drawers'

// Stand-ins with the real props: the host's wiring is under test, not the forms.
vi.mock('../addQuestions', () => ({
  isAddTab: (value: unknown) => value === 'import' || value === 'type',
  AddQuestionsDialog: ({
    targetId,
    onClose,
    onTarget,
    onNewTopic,
    onImport
  }: {
    targetId: string | null
    onClose: () => void
    onTarget: (id: string, kind: 'page' | 'topic') => void
    onNewTopic: (receive: (id: string) => void) => void
    onImport: (receive: (rows: readonly unknown[]) => void) => void
  }): JSX.Element => (
    <Drawer id="add-questions" title="Add questions" onClose={onClose}>
      <p data-testid="target">{targetId ?? 'none'}</p>
      <button type="button" onClick={() => onNewTopic((id) => onTarget(id, 'topic'))}>
        New topic
      </button>
      <button
        type="button"
        onClick={() =>
          onImport((rows) => {
            document.body.dataset.imported = String(rows.length)
          })
        }
      >
        Import a file
      </button>
    </Drawer>
  ),
  ImportQuestionsDrawer: ({
    targetId,
    onClose,
    onReturn
  }: {
    targetId: string | null
    onClose: () => void
    onReturn: (rows: readonly unknown[]) => void
  }): JSX.Element => (
    <Drawer id="import" title="Import a file" onClose={onClose}>
      <p data-testid="import-target">{targetId ?? 'none'}</p>
      <button type="button" onClick={() => onReturn([{ row: 2 }, { row: 3 }])}>
        Add 2 rows to the list
      </button>
    </Drawer>
  ),
  AddPageForTarget: (): JSX.Element => <p data-testid="add-page-for-target">Add a page</p>
}))

vi.mock('../addPage', () => ({
  AddPageDrawer: (): JSX.Element => <p data-testid="add-page-tracking">Add a page</p>
}))

vi.mock('../topics/newTopic', () => ({
  NewTopicDialog: ({
    onClose,
    onFinish
  }: {
    onClose: () => void
    onFinish: (id: string) => void
  }): JSX.Element => (
    <Drawer id="new-topic" title="New topic" onClose={onClose}>
      <button type="button" onClick={() => onFinish('topic-9')}>
        Save topic
      </button>
    </Drawer>
  )
}))

const ROUTE: RouteCrumb[] = [
  { label: 'TextBolt', href: '#/overview' },
  { label: 'Questions', href: '#/questions', screen: true }
]

function settle(): Promise<void> {
  return act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)))
}

function crumbs(dialog: HTMLElement): string[] {
  const nav = within(dialog).getByRole('navigation', { name: 'Drawer breadcrumb' })
  return within(nav)
    .getAllByRole('listitem')
    .map((item) => (item.textContent ?? '').replace('›', '').trim())
}

function Shell(): JSX.Element {
  return (
    <DrawerTrailContext.Provider value={ROUTE}>
      <DrawerHost projectId="p1" />
    </DrawerTrailContext.Provider>
  )
}

beforeEach(async () => {
  resetDrawersForTests()
  window.history.replaceState(null, '', '#/start-of-test')
  window.location.hash = '#/questions'
  await settle()
})

afterEach(() => {
  cleanup()
  resetDrawersForTests()
})

describe('DrawerHost', () => {
  it('stacks New topic over Add questions; its result comes back as the target', async () => {
    render(<Shell />)
    act(() => openDrawer('add-questions'))
    const first = await screen.findByRole('dialog', { name: 'Add questions' })
    expect(crumbs(first)).toEqual(['TextBolt', 'Questions'])
    expect(first.getAttribute('data-drawer-depth')).toBe('0')

    fireEvent.click(within(first).getByRole('button', { name: 'New topic' }))
    const second = await screen.findByRole('dialog', { name: 'New topic' })
    expect(second.getAttribute('data-drawer-depth')).toBe('1')
    expect(second.className).toContain('ui-drawer-depth-1')
    expect(crumbs(second)).toEqual(['TextBolt', 'Questions', 'Add questions'])
    expect(window.location.hash).toBe('#/questions?drawer=add-questions&drawer=new-topic')

    fireEvent.click(within(second).getByRole('button', { name: 'Save topic' }))
    await settle()
    expect(screen.queryByRole('dialog', { name: 'New topic' })).toBeNull()
    expect(screen.getByTestId('target').textContent).toBe('topic-9')
    expect(window.location.hash).toBe('#/questions?drawer=add-questions&topic=topic-9')
  })

  it('stacks Import a file over Add questions for its topic; the rows come back', async () => {
    render(<Shell />)
    act(() => openDrawer('add-questions', { topic: 'topic-1' }))
    const first = await screen.findByRole('dialog', { name: 'Add questions' })
    fireEvent.click(within(first).getByRole('button', { name: 'Import a file' }))
    const second = await screen.findByRole('dialog', { name: 'Import a file' })
    expect(crumbs(second)).toEqual(['TextBolt', 'Questions', 'Add questions'])
    expect(within(second).getByTestId('import-target').textContent).toBe('topic-1')
    expect(window.location.hash).toBe(
      '#/questions?drawer=add-questions&topic=topic-1&drawer=import&import.entity=questions'
    )
    fireEvent.click(within(second).getByRole('button', { name: 'Add 2 rows to the list' }))
    await settle()
    expect(screen.queryByRole('dialog', { name: 'Import a file' })).toBeNull()
    expect(document.body.dataset.imported).toBe('2')
    delete document.body.dataset.imported
  })

  it('opens Add a page over Add questions for its URL, and the full Add a page anywhere else', async () => {
    render(<Shell />)
    act(() => openDrawer('add-page', { 'addpage.url': 'https://textbolt.com/a' }))
    expect(await screen.findByTestId('add-page-tracking')).toBeTruthy()
    expect(screen.queryByTestId('add-page-for-target')).toBeNull()
    act(() => closeDrawer(0))
    await settle()

    act(() => openDrawer('add-questions', { topic: 'topic-1' }))
    await settle()
    act(() => openDrawer('add-page'))
    expect(await screen.findByTestId('add-page-for-target')).toBeTruthy()
    expect(screen.queryByTestId('add-page-tracking')).toBeNull()
    expect(currentDrawers().map((entry) => entry.id)).toEqual(['add-questions', 'add-page'])
  })

  it("a lower drawer's crumb closes the ones over it; the screen's crumb closes all", async () => {
    render(<Shell />)
    act(() => openDrawer('add-questions'))
    await settle()
    act(() => openDrawer('new-topic'))
    const second = await screen.findByRole('dialog', { name: 'New topic' })
    fireEvent.click(within(second).getByRole('link', { name: 'Add questions' }))
    await settle()
    expect(currentDrawers().map((entry) => entry.id)).toEqual(['add-questions'])

    const first = screen.getByRole('dialog', { name: 'Add questions' })
    fireEvent.click(within(first).getByRole('link', { name: 'Questions' }))
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(window.location.hash).toBe('#/questions')
  })

  it('a project crumb leaves through history, then opens the link', async () => {
    render(<Shell />)
    act(() => openDrawer('add-questions'))
    const first = await screen.findByRole('dialog', { name: 'Add questions' })
    fireEvent.click(within(first).getByRole('link', { name: 'TextBolt' }))
    await settle()
    expect(window.location.hash).toBe('#/overview')
    expect(screen.queryByRole('dialog')).toBeNull()
    window.history.back()
    await settle()
    // Back returns to the screen, not to the closed drawer.
    expect(window.location.hash).toBe('#/questions')
  })
})

describe('ScreenDrawerLevel', () => {
  it("gives a screen's own drawer the route's crumbs; the screen's crumb closes it", () => {
    const onClose = vi.fn()
    render(
      <DrawerTrailContext.Provider value={ROUTE}>
        <ScreenDrawerLevel onClose={onClose}>
          <Drawer id="compare" title="Compare content" onClose={onClose} />
        </ScreenDrawerLevel>
      </DrawerTrailContext.Provider>
    )
    const dialog = screen.getByRole('dialog', { name: 'Compare content' })
    expect(crumbs(dialog)).toEqual(['TextBolt', 'Questions'])
    fireEvent.click(within(dialog).getByRole('link', { name: 'Questions' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
