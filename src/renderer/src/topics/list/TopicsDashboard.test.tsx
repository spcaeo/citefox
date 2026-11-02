// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
  type RenderResult
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TopicFolder } from '@shared/ipc'
import { UndoToastHost } from '../../ui'
import { axeViolations } from '../../ui/axe.test-helper'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { resetSuggestCache } from './hooks/useSuggestTopics'
import { TopicsScreen } from './TopicsScreen'
import { fakeTopicsSource, topicsList, topicsSummaries } from './topics.fixtures.test-helper'

const A = 'Replacing a carrier email-to-text gateway'
const B = '10DLC for small senders'
const CARRIERS: TopicFolder = {
  id: 'fold-carriers',
  name: 'Carrier shutdowns',
  createdAt: '2026-10-01T09:00:00.000Z',
  topicIds: ['topic-a']
}

/** The screen's URL; the view is always named, since a picked view is remembered. */
function at(query = 'view=tree'): void {
  window.history.replaceState(null, '', `#/topics?${query}`)
}

beforeEach(() => {
  at()
  resetSuggestCache()
})

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
})

async function shown(
  folders: readonly TopicFolder[] = [CARRIERS]
): Promise<{ view: RenderResult; source: ReturnType<typeof fakeTopicsSource> }> {
  const source = fakeTopicsSource(topicsList(), topicsSummaries(), folders)
  const view = render(
    <>
      <TopicsScreen projectId="proj-1" source={source} viewStore={null} />
      <UndoToastHost />
    </>
  )
  await view.findByRole('heading', { level: 1, name: 'Topics' })
  return { view, source }
}

function query(): URLSearchParams {
  const hash = window.location.hash
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
}

describe('Topics dashboard', () => {
  it('opens on the List, with List · Tree · Grid tabs', async () => {
    at('')
    const { view } = await shown()
    const tabs = view.getByRole('tablist', { name: 'Topics views' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['List', 'Tree', 'Grid'])
    expect(within(tabs).getByRole('tab', { name: 'List' }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })

  it('the Tree: folders with their topics, and every folder adds up to All', async () => {
    const { view } = await shown()
    const tree = await view.findByRole('treegrid', { name: 'Topics by folder' })
    expect(view.getByText(/^2 topics in 1 folder · \d+ searches$/)).toBeTruthy()
    expect(within(tree).getByText('Carrier shutdowns')).toBeTruthy()
    expect(within(tree).getByText('No folder')).toBeTruthy()
    // Folders start closed; Expand all shows the topics.
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(within(tree).getByText(A)).toBeTruthy()
    expect(within(tree).getByText(B)).toBeTruthy()
    // Each folder link's name holds the number it shows (WCAG 2.5.3).
    const folderLinks = within(tree).getAllByRole('link', {
      name: /: [\d,]+ searches, list its \d+ topics$/
    })
    for (const link of folderLinks) {
      expect(link.getAttribute('aria-label')).toContain(link.textContent ?? '-')
    }
    const all = within(tree)
      .getAllByRole('row')
      .find((row) => row.textContent?.startsWith('All'))
    const sum = folderLinks.reduce((total, link) => total + Number(link.textContent), 0)
    expect(all?.textContent).toContain(String(sum))
    expect(folderLinks[0]?.getAttribute('href')).toBe('#/topics?view=list&folder=fold-carriers')
    expect(
      within(tree)
        .getByRole('link', { name: new RegExp(`^${A}: open its \\d+ searches$`) })
        .getAttribute('href')
    ).toBe('#/topics/topic-a')
    // Needs work opens the topic's searches that need work (`work=1`), as the cells do.
    expect(
      within(tree)
        .getByRole('link', { name: new RegExp(`^${A} · Needs work: open these \\d+ searches$`) })
        .getAttribute('href')
    ).toBe('#/topics/topic-a?work=1')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('moves a topic to a folder from its row menu, with Undo', async () => {
    const { view, source } = await shown()
    await view.findByRole('treegrid', { name: 'Topics by folder' })
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(view.getByRole('button', { name: `Actions for ${B}` }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Move to folder…' }))
    const drawer = await view.findByRole('dialog', { name: `Move ${B} to a folder` })
    expect(query().get('drawer')).toBe('topic-folder')
    expect(query().get('tf.topics')).toBe('topic-b')
    fireEvent.click(within(drawer).getByRole('radio', { name: /Carrier shutdowns/ }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(source.calls['topics:moveToFolder']).toEqual([
      { projectId: 'proj-1', topicIds: ['topic-b'], folderId: 'fold-carriers' }
    ])
    const toast = await view.findByTestId('topic-undo')
    expect(toast.textContent).toContain('Moved 1 topic to Carrier shutdowns.')
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(source.calls['topics:moveToFolder']).toHaveLength(2))
    expect(source.calls['topics:moveToFolder']?.[1]).toEqual({
      projectId: 'proj-1',
      topicIds: ['topic-b'],
      folderId: null
    })
  })

  it('moves ticked topics into a new folder from the List bulk bar', async () => {
    at('view=list')
    const { view, source } = await shown([])
    const grid = await view.findByRole('grid', { name: 'Topics' })
    fireEvent.click(within(grid).getByRole('checkbox', { name: 'Select every row on this page' }))
    fireEvent.click(view.getByRole('button', { name: 'Move to folder' }))
    const drawer = await view.findByRole('dialog', { name: 'Move 2 topics to a folder' })
    // No folder yet: New folder… is picked and asks for a name.
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Folder name' }), {
      target: { value: 'Carriers' }
    })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(source.calls['topics:createFolder']).toEqual([
      { projectId: 'proj-1', name: 'Carriers', topicIds: ['topic-a', 'topic-b'] }
    ])
  })

  it('makes, renames and deletes a folder; deleting puts its topics back in No folder', async () => {
    const { view, source } = await shown()
    fireEvent.click(view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'New folder' }))
    const make = await view.findByRole('dialog', { name: 'New folder' })
    const name = within(make).getByRole('textbox', { name: 'Folder name' })
    fireEvent.change(name, { target: { value: 'x'.repeat(81) } })
    expect(within(make).getByText('A folder name is 1 to 80 characters.')).toBeTruthy()
    fireEvent.change(name, { target: { value: 'Monitoring tools' } })
    fireEvent.click(within(make).getByRole('button', { name: 'Make folder' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(source.calls['topics:createFolder']).toEqual([
      { projectId: 'proj-1', name: 'Monitoring tools' }
    ])

    fireEvent.click(
      await view.findByRole('button', { name: 'Folder actions for Carrier shutdowns' })
    )
    fireEvent.click(await view.findByRole('menuitem', { name: 'Rename folder…' }))
    const rename = await view.findByRole('dialog', { name: 'Rename folder' })
    fireEvent.change(within(rename).getByRole('textbox', { name: 'Folder name' }), {
      target: { value: 'Carriers' }
    })
    fireEvent.click(within(rename).getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(source.calls['topics:renameFolder']).toEqual([
      { projectId: 'proj-1', folderId: 'fold-carriers', name: 'Carriers' }
    ])

    fireEvent.click(await view.findByRole('button', { name: 'Folder actions for Carriers' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Delete folder…' }))
    const confirm = await view.findByRole('alertdialog', { name: 'Delete the folder Carriers?' })
    expect(confirm.textContent).toContain('Its 1 topic goes back to No folder.')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete folder' }))
    await waitFor(() => expect(source.calls['topics:deleteFolder']).toHaveLength(1))
  })

  it('the Grid has a row per folder and All; each count opens those searches on Questions', async () => {
    at('view=grid')
    const { view } = await shown()
    const table = await view.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual([
      'Folder',
      'Carrier shutdowns',
      'No folder',
      'All'
    ])
    const link = within(table).getByRole('link', {
      name: /^Carrier shutdowns: open these \d+ searches$/
    })
    expect(link.getAttribute('href')).toBe('#/questions?view=list&folder=fold-carriers')
    // A result count opens the drill page on Questions, in that folder.
    const drill = within(table).getAllByRole('link', {
      name: /^Carrier shutdowns · .+: open these \d+ searches$/
    })[0]
    expect(drill?.getAttribute('href')).toMatch(
      /^#\/questions\?folder=fold-carriers&d\.result=\w+$/
    )
    expect(
      within(table)
        .getByRole('link', { name: /^Carrier shutdowns · Needs work: open these \d+ searches$/ })
        .getAttribute('href')
    ).toBe('#/questions?folder=fold-carriers&d.work=1')
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('a folder link narrows the List to that folder, and ✕ shows them all again', async () => {
    at('view=list&folder=fold-carriers')
    const { view } = await shown()
    const grid = await view.findByRole('grid', { name: 'Topics' })
    expect(within(grid).getByText(A)).toBeTruthy()
    expect(within(grid).queryByText(B)).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Remove filter Folder: Carrier shutdowns' }))
    await waitFor(() => expect(within(grid).getByText(B)).toBeTruthy())
    expect(query().get('folder')).toBeNull()
  })
})
