// @vitest-environment happy-dom
import { cleanup, fireEvent, waitFor, within, type RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { axeViolations } from '../ui/axe.test-helper'
import { resetUndoToastForTests } from '../ui/undoStore'
import { DRAG_TYPE } from './utils/drag'
import { questionRow, questionsList } from './questions.fixtures.test-helper'
import { fakeSource, pickFilter, pickGroup, query, shown } from './questions.screen.test-helper'

function tick(view: RenderResult, text: string): void {
  fireEvent.click(view.getByRole('checkbox', { name: `Select ${text}` }))
}

function bar(view: RenderResult): HTMLElement {
  return view.getByRole('region', { name: 'Bulk actions' })
}

async function choose(view: RenderResult, menu: string, item: string | RegExp): Promise<void> {
  fireEvent.click(within(bar(view)).getByRole('button', { name: menu }))
  fireEvent.click(await view.findByRole('menuitem', { name: item }))
}

/** A drag payload the way the browser keeps it between dragstart and drop. */
function fakeTransfer(): DataTransfer {
  const data = new Map<string, string>()
  return {
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    effectAllowed: 'all',
    dropEffect: 'none'
  } as unknown as DataTransfer
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/questions')
})

afterEach(() => {
  cleanup()
  resetUndoToastForTests()
})

describe('Questions grouping', () => {
  it('writes the grouping to the URL and regroups', async () => {
    const { view } = await shown()
    expect(view.container.textContent).toContain('cited 0 of 1')
    expect(view.getByRole('button', { name: 'Sort into topics with AI' })).toBeTruthy()
    expect(
      view.getByRole('link', { name: 'Add questions to Business texting' }).getAttribute('href')
    ).toBe('#/questions?drawer=add-questions&target=topic-1')

    pickGroup(view, 'Stage')
    expect(query().get('group')).toBe('stage')
    expect(view.getByRole('button', { name: 'No stage' })).toBeTruthy()
    expect(view.getByText('4 questions · 1 group')).toBeTruthy()

    pickGroup(view, 'Right page')
    expect(query().get('group')).toBe('target')
    expect(view.getByRole('button', { name: 'No page yet' })).toBeTruthy()

    pickGroup(view, 'Topic')
    expect(query().get('group')).toBeNull()
    expect(view.getByRole('button', { name: 'Not in a topic' })).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('moves the ticked questions to a topic from the Move menu', async () => {
    const { view, source } = await shown()
    tick(view, 'how much does TextBolt cost')
    await choose(view, 'Move to topic', /^Text alerts/)
    await view.findByText('Moved 1 question to Text alerts.')
    expect(source.calls.move).toEqual([
      {
        projectId: 'proj-1',
        items: [{ sourceId: 'page-1', promptId: 'p-1' }],
        to: { kind: 'topic', topicId: 'topic-2' }
      }
    ])
    // The topics event reloads the list and the topics.
    await waitFor(() => expect(source.calls.list).toHaveLength(2))
    expect(view.queryByRole('region', { name: 'Bulk actions' })).toBeNull()
  })

  it('moves a topic question back to "Not in a topic"', async () => {
    const { view, source } = await shown()
    tick(view, 'best business texting app for small teams')
    await choose(view, 'Move to topic', 'Not in a topic')
    await view.findByText('Moved 1 question to its page.')
    expect(source.calls.move).toEqual([
      {
        projectId: 'proj-1',
        items: [{ sourceId: 'topic-1', promptId: 'p-t1' }],
        to: { kind: 'page' }
      }
    ])
  })

  it('starts a new topic from the ticked questions, keeping the view', async () => {
    window.history.replaceState(null, '', '#/questions?result=cited&group=none')
    const { view } = await shown()
    pickFilter(view, 'Result: All')
    tick(view, 'how much does TextBolt cost')
    tick(view, 'cheapest SMS API for startups')
    await choose(view, 'Move to topic', 'New topic from these 2…')
    expect(query().get('drawer')).toBe('new-topic')
    expect(query().get('questions')).toBe('p-1,p-2')
    expect(query().get('group')).toBe('none')
  })

  it('sets the stage of the ticked questions', async () => {
    const { view, source } = await shown()
    tick(view, 'best business texting app for small teams')
    await choose(view, 'Set stage', 'Compare')
    await view.findByText('Set the stage of 1 question.')
    expect(source.calls.stage).toEqual([
      { projectId: 'proj-1', items: [{ sourceId: 'topic-1', promptId: 'p-t1' }], stage: 'compare' }
    ])
  })

  it('sets the target page of topic questions and skips page questions', async () => {
    const { view, source } = await shown()
    tick(view, 'best business texting app for small teams')
    tick(view, 'how much does TextBolt cost')
    fireEvent.click(within(bar(view)).getByRole('button', { name: 'Set target page' }))
    expect(query().get('panel')).toBe('target')
    expect(query().get('pick')).toBe('p-t1,p-1')
    const panel = await view.findByRole('dialog', { name: 'Set target page' })
    expect(panel.textContent).toContain('1 page question skipped')
    fireEvent.click(await within(panel).findByRole('radio', { name: 'SMS API' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Set for 1 question' }))
    await view.findByText(/Set the target page of 1 question to \/sms-api\/\./)
    expect(source.calls.target).toEqual([
      {
        projectId: 'proj-1',
        topicId: 'topic-1',
        promptIds: ['p-t1'],
        target: { pageId: null, url: 'https://textbolt.com/sms-api/' }
      }
    ])
    await waitFor(() => expect(query().get('panel')).toBeNull())
    expect(query().get('pick')).toBeNull()
  })

  it('sorts "Not in a topic" with CiteFox AI and moves the ticked proposals', async () => {
    const { view, source } = await shown()
    fireEvent.click(view.getByRole('button', { name: 'Sort into topics with AI' }))
    expect(query().get('panel')).toBe('sort')
    const panel = await view.findByRole('dialog', { name: 'Sort into topics' })
    await within(panel).findByRole('list', { name: 'Proposals' })
    expect(source.calls.sort).toEqual([
      {
        projectId: 'proj-1',
        items: [
          { sourceId: 'page-1', promptId: 'p-1' },
          { sourceId: 'page-1', promptId: 'p-2' },
          { sourceId: 'page-1', promptId: 'p-3' }
        ]
      }
    ])
    expect(
      (
        within(panel).getByRole('combobox', {
          name: 'Topic for “question p-2”'
        }) as HTMLSelectElement
      ).value
    ).toBe('new:SMS pricing')
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Move “question p-3”' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Move 2 questions' }))
    await waitFor(() => expect(source.calls.move).toHaveLength(2))
    expect(source.calls.move).toEqual([
      {
        projectId: 'proj-1',
        items: [{ sourceId: 'page-1', promptId: 'p-1' }],
        to: { kind: 'topic', topicId: 'topic-1' }
      },
      {
        projectId: 'proj-1',
        items: [{ sourceId: 'page-1', promptId: 'p-2' }],
        to: { kind: 'new', name: 'SMS pricing' }
      }
    ])
    await waitFor(() => expect(query().get('panel')).toBeNull())
    await view.findByText('Moved 1 question to Business texting. Moved 1 question to SMS pricing.')
  })

  it('opens Set target page from a link as a drawer; ✕ closes it and the address loses it', async () => {
    window.history.replaceState(null, '', '#/questions?panel=target&pick=p-t1')
    const { view } = await shown()
    const drawer = await view.findByRole('dialog', { name: 'Set target page' })
    expect(drawer.getAttribute('data-drawer')).toBe('question-target')
    expect(within(drawer).getByRole('complementary', { name: 'These questions' })).toBeTruthy()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close Set target page' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(query().get('panel')).toBeNull()
    expect(query().get('pick')).toBeNull()
  })

  it('asks before throwing away a picked target page', async () => {
    window.history.replaceState(null, '', '#/questions?panel=target&pick=p-t1')
    const { view } = await shown()
    const drawer = await view.findByRole('dialog', { name: 'Set target page' })
    fireEvent.click(await within(drawer).findByRole('radio', { name: 'SMS API' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    const ask = await view.findByRole('alertdialog', { name: 'Discard changes?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
    expect(view.getByRole('dialog', { name: 'Set target page' })).toBeTruthy()
    expect(query().get('panel')).toBe('target')
  })

  it('opens Sort into topics from a link; Escape closes it, and Back closes it after a click', async () => {
    window.history.replaceState(null, '', '#/questions?panel=sort')
    const { view } = await shown()
    const drawer = await view.findByRole('dialog', { name: 'Sort into topics' })
    expect(drawer.getAttribute('data-drawer')).toBe('sort-questions')
    await within(drawer).findByRole('list', { name: 'Proposals' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(query().get('panel')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: 'Sort into topics with AI' }))
    await view.findByRole('dialog', { name: 'Sort into topics' })
    window.history.back()
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(query().get('panel')).toBeNull()
  })

  it('moves a question dropped on a topic heading', async () => {
    const { view, source } = await shown()
    const transfer = fakeTransfer()
    const text = view.getByText('cheapest SMS API for startups')
    const handle = text.closest('[draggable="true"]') as HTMLElement
    fireEvent.dragStart(handle, { dataTransfer: transfer })
    expect(JSON.parse(transfer.getData(DRAG_TYPE))).toEqual([
      { sourceId: 'page-1', promptId: 'p-2' }
    ])
    const heading = view.getByRole('button', { name: 'Business texting' })
    fireEvent.dragOver(heading, { dataTransfer: transfer })
    expect(heading.closest('.ui-lg-group')?.getAttribute('data-drop-over')).toBe('true')
    fireEvent.drop(heading, { dataTransfer: transfer })
    await view.findByText('Moved 1 question to Business texting.')
    expect(source.calls.move).toEqual([
      {
        projectId: 'proj-1',
        items: [{ sourceId: 'page-1', promptId: 'p-2' }],
        to: { kind: 'topic', topicId: 'topic-1' }
      }
    ])
    expect(view.container.querySelector('[data-drop-over]')).toBeNull()
  })

  it('drags the whole selection when a ticked row is dragged', async () => {
    const { view } = await shown()
    tick(view, 'how much does TextBolt cost')
    tick(view, 'cheapest SMS API for startups')
    const transfer = fakeTransfer()
    const handle = view
      .getByText('cheapest SMS API for startups')
      .closest('[draggable="true"]') as HTMLElement
    fireEvent.dragStart(handle, { dataTransfer: transfer })
    expect(JSON.parse(transfer.getData(DRAG_TYPE))).toEqual([
      { sourceId: 'page-1', promptId: 'p-1' },
      { sourceId: 'page-1', promptId: 'p-2' }
    ])
  })

  it('has no drag handles or drop targets outside Topic grouping', async () => {
    window.history.replaceState(null, '', '#/questions?group=stage')
    const { view } = await shown()
    expect(view.container.querySelector('[draggable="true"]')).toBeNull()
    expect(view.container.querySelector('[data-move-target]')).toBeNull()
    expect(view.queryByText(/Drag works too/)).toBeNull()
  })

  it('opens a moved question where its result lives', async () => {
    const source = fakeSource(
      questionsList({
        rows: [
          questionRow({
            promptId: 'p-new',
            sourceId: 'topic-1',
            text: 'texting app with shared inbox',
            resultPromptId: 'p-old',
            resultPageId: 'page-1'
          })
        ]
      })
    )
    const { view } = await shown(source)
    fireEvent.click(view.getByText('texting app with shared inbox'))
    expect(window.location.hash).toBe('#/pages/page-1/prompt/p-old?market=m-us&run=run-b')
  })
})
