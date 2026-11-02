// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentDiff, HistoryEvent, PageHistory, PageNote } from '@shared/domain'
import type { HistorySource } from './client'
import { HistoryScreen } from './HistoryScreen'

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
})

const PAGE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

function base(
  patch: Partial<HistoryEvent> & Pick<HistoryEvent, 'id' | 'primary' | 'at' | 'title'>
): HistoryEvent {
  return {
    kinds: [patch.primary],
    detail: null,
    check: null,
    content: null,
    note: null,
    fix: null,
    promptSet: null,
    ...patch
  }
}

function checkEvent(
  id: string,
  at: string,
  title: string,
  score: number,
  change: number | null,
  contentChanged: boolean | null
): HistoryEvent {
  return base({
    id,
    primary: 'check',
    at,
    title,
    kinds: contentChanged ? ['check', 'content'] : ['check'],
    check: {
      runId: id,
      marketId: 'us',
      kind: change === null ? 'baseline' : 'scheduled',
      partial: false,
      promptsChecked: 10,
      promptsTotal: 10,
      score,
      scoreChange: change,
      promptSetVersion: 2,
      contentChanged
    },
    content: contentChanged
      ? {
          summary: '5 FAQs added, 410 words added.',
          fromSnapshotId: 'snap-1',
          toSnapshotId: 'snap-2',
          modifiedAt: null
        }
      : null
  })
}

function fixture(notes: readonly PageNote[]): HistoryEvent[] {
  return [
    checkEvent('run-1', '2026-09-21T10:00:00.000Z', 'Baseline check', 24, null, null),
    checkEvent('run-2', '2026-10-05T10:00:00.000Z', 'Scheduled check', 38, 14, false),
    checkEvent('run-3', '2026-10-19T10:00:00.000Z', 'Scheduled check', 50, 12, true),
    base({
      id: 'fix-1',
      primary: 'fix',
      at: '2026-10-07T20:00:00.000Z',
      title: 'Fix 1 · Added 5 FAQs',
      detail: 'Targets questions 4, 6 and 9',
      fix: {
        id: 'fix-1',
        number: 1,
        verdict: 'Partly worked · 1 of 3 questions',
        planned: false,
        promptPositions: [4, 6, 9]
      }
    }),
    base({
      id: 'set-2',
      primary: 'prompt_set',
      at: '2026-09-20T10:00:00.000Z',
      title: 'Question set v2 saved',
      detail: '10 questions. Started a new baseline.',
      promptSet: { id: 'set-2', version: 2, promptCount: 10, active: true }
    }),
    ...notes.map((note) =>
      base({
        id: `note-${note.id}`,
        primary: 'note',
        at: new Date(`${note.date}T12:00:00`).toISOString(),
        title: 'Note',
        note: { id: note.id, date: note.date, text: note.text }
      })
    )
  ]
}

const DIFF: ContentDiff = {
  pageId: 'alerts',
  from: { id: 'snap-1', fetchedAt: '2026-10-05T10:00:00.000Z', wordCount: 1200, faqCount: 3 },
  to: { id: 'snap-2', fetchedAt: '2026-10-19T10:00:00.000Z', wordCount: 1610, faqCount: 8 },
  summary: '5 FAQs added, 410 words added.',
  fields: [
    {
      field: 'title',
      label: 'Title',
      before: 'Text alerts',
      after: 'Text alerts for business',
      changed: true
    },
    {
      field: 'meta_description',
      label: 'Meta description',
      before: null,
      after: null,
      changed: false
    },
    { field: 'h1', label: 'H1', before: 'Alerts', after: 'Alerts', changed: false }
  ],
  outline: [
    { op: 'same', text: 'Why text alerts' },
    { op: 'added', text: 'FAQs' }
  ],
  faqs: [{ op: 'added', text: 'Q: What replaced txt.att.net?' }],
  body: [
    { op: 'removed', text: 'Old sentence.' },
    { op: 'added', text: 'New sentence.' }
  ],
  bodyTruncated: false
}

function fakeSource(
  initial: PageNote[] = [],
  events?: () => HistoryEvent[]
): {
  source: HistorySource
  notes: PageNote[]
  calls: { list: number }
} {
  const notes = [...initial]
  const calls = { list: 0 }
  let next = 1
  const source: HistorySource = {
    'history:list': vi.fn(async (): Promise<PageHistory> => {
      calls.list += 1
      return {
        pageId: 'alerts',
        marketId: 'us',
        builtAt: '2026-10-20T10:00:00.000Z',
        events: events ? events() : fixture(notes)
      }
    }),
    'history:compare': vi.fn(async () => DIFF),
    'history:addNote': vi.fn(async (request) => {
      const note: PageNote = {
        id: `added-${next++}`,
        pageId: request.pageId,
        date: request.date,
        text: request.text,
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z'
      }
      notes.push(note)
      return note
    }),
    'history:updateNote': vi.fn(async (request) => {
      const index = notes.findIndex((note) => note.id === request.noteId)
      const current = notes[index]
      if (!current) throw new Error('Unknown note')
      const updated = { ...current, date: request.date, text: request.text }
      notes[index] = updated
      return updated
    }),
    'history:deleteNote': vi.fn(async (request) => {
      const index = notes.findIndex((note) => note.id === request.noteId)
      notes.splice(index, 1)
      return { noteId: request.noteId }
    })
  }
  return { source, notes, calls }
}

const NOTE: PageNote = {
  id: 'n-1',
  pageId: 'alerts',
  date: '2026-10-08',
  text: 'Added 5 FAQs',
  createdAt: '2026-10-08T10:00:00.000Z',
  updatedAt: '2026-10-08T10:00:00.000Z'
}

function renderScreen(source: HistorySource): ReturnType<typeof render> {
  return render(
    <HistoryScreen
      source={source}
      projectId="textbolt"
      pageId="alerts"
      marketId="us"
      markets={[
        {
          id: 'us',
          country: 'US',
          language: 'en',
          location: null,
          device: 'desktop',
          localWording: false,
          serpapiLocation: null
        }
      ]}
    />
  )
}

async function showTimeline(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.click(await view.findByRole('tab', { name: /^Timeline/ }))
}

function gridRows(view: ReturnType<typeof render>): HTMLElement[] {
  return Array.from(
    view.getByRole('grid', { name: 'Page history' }).querySelectorAll<HTMLElement>('[data-row]')
  )
}

function timelineTitles(view: ReturnType<typeof render>): string[] {
  return within(view.container.querySelector('.hist-timeline') as HTMLElement)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent ?? '')
}

describe('History screen', () => {
  it('lists events newest first with scores, changes and content state', async () => {
    const { source } = fakeSource([NOTE])
    const view = renderScreen(source)
    await view.findByRole('grid', { name: 'Page history' })
    expect(gridRows(view)).toHaveLength(6)
    expect(view.getByRole('button', { name: /^October 2026/ }).getAttribute('aria-expanded')).toBe(
      'true'
    )
    expect(view.getByRole('button', { name: /^September 2026/ })).toBeTruthy()
    expect(view.getByRole('tab', { name: /^Events/ }).getAttribute('aria-selected')).toBe('true')
    expect((await axe.run(view.container, PAGE_RULES)).violations).toEqual([])
    await showTimeline(view)
    // The view is on the route, so Back returns to Events.
    expect(window.location.hash).toContain('view=timeline')
    expect(timelineTitles(view)).toEqual([
      'Scheduled check',
      'Note',
      'Fix 1 · Added 5 FAQs',
      'Scheduled check',
      'Baseline check',
      'Question set v2 saved'
    ])
    expect(view.getByText('Score 50')).toBeTruthy()
    expect(view.getByLabelText('Change since the previous check +12')).toBeTruthy()
    expect(view.getByText('Page content changed')).toBeTruthy()
    expect(view.getAllByText('Page content unchanged')).toHaveLength(1)
    expect(view.getByText('All 6 events · newest first')).toBeTruthy()
    expect(view.getByText(/Checks are from 🇺🇸 US · EN/)).toBeTruthy()
    expect(
      view
        .getByRole('link', { name: /See the progress chart and fix results/ })
        .getAttribute('href')
    ).toBe('#/pages/alerts/progress')
    const results = await axe.run(view.container, PAGE_RULES)
    expect(results.violations).toEqual([])
  })

  it('filters by kind with counts', async () => {
    const { source } = fakeSource([NOTE])
    const view = renderScreen(source)
    const group = await view.findByRole('group', { name: 'Show events' })
    for (const name of [
      'All 6',
      'Checks 3',
      'Content changes 1',
      'Notes 1',
      'Fixes 1',
      'Question sets 1'
    ]) {
      expect(within(group).getByRole('button', { name })).toBeTruthy()
    }
    const content = within(group).getByRole('button', { name: 'Content changes 1' })
    fireEvent.click(content)
    expect(content.getAttribute('aria-pressed')).toBe('true')
    expect(gridRows(view)).toHaveLength(1)
    await showTimeline(view)
    expect(
      within(view.getByRole('group', { name: 'Show events' }))
        .getByRole('button', { name: 'Content changes 1' })
        .getAttribute('aria-pressed')
    ).toBe('true')
    expect(timelineTitles(view)).toEqual(['Scheduled check'])
    expect(view.getByText('1 event of 6 · Content changes · newest first')).toBeTruthy()
  })

  it('sorts the grid by score within each month, with Shift adding a second sort', async () => {
    const { source } = fakeSource([NOTE])
    const view = renderScreen(source)
    const grid = await view.findByRole('grid', { name: 'Page history' })
    const scores = (): string[] =>
      gridRows(view).map((row) => within(row).getAllByRole('gridcell')[3]?.textContent ?? '')
    expect(scores()).toEqual(['50', '—', '—', '38', '24', '—'])
    fireEvent.click(within(grid).getByRole('button', { name: 'Score' }))
    const header = within(grid).getAllByRole('columnheader')[3]
    expect(header?.getAttribute('aria-sort')).toBe('ascending')
    // Sorted inside each month (October, then September); blank scores last.
    expect(scores()).toEqual(['38', '50', '—', '—', '24', '—'])
    fireEvent.click(within(grid).getByRole('button', { name: 'Type' }), { shiftKey: true })
    expect(within(grid).getAllByRole('columnheader')[1]?.getAttribute('aria-sort')).not.toBe('none')
    expect(header?.getAttribute('aria-sort')).toBe('ascending')
  })

  it('a row opens its details, and the row menu edits a note', async () => {
    const { source } = fakeSource([NOTE])
    const view = renderScreen(source)
    await view.findByRole('grid', { name: 'Page history' })
    const noteRow = gridRows(view).find((row) => (row.textContent ?? '').includes('Added 5 FAQs'))
    if (!noteRow) throw new Error('no note row')
    fireEvent.click(within(noteRow).getByRole('button', { name: /^Actions for Note/ }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Edit note' }))
    const panel = await view.findByRole('dialog', { name: 'Note · Oct 8, 2026' })
    expect(window.location.hash).toContain('drawer=hist-event&he.id=note-n-1&he.note=edit')
    const textarea = within(panel).getByLabelText('Note') as HTMLTextAreaElement
    expect(textarea.value).toBe('Added 5 FAQs')
    fireEvent.click(within(panel).getByRole('button', { name: 'Close Note · Oct 8, 2026' }))
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).not.toContain('drawer='))

    const checkRow = gridRows(view)[0]
    if (!checkRow) throw new Error('no row')
    fireEvent.click(checkRow)
    const details = await view.findByRole('dialog', { name: 'Scheduled check' })
    expect(within(details).getByText('Score 50')).toBeTruthy()
    expect(within(details).getByRole('link', { name: /^View results of the/ })).toBeTruthy()
    // The rail: the check before this one, with its score.
    const nearby = within(details).getByTestId('hist-nearby')
    expect(nearby.textContent).toContain('Oct 5, 2026')
    expect(nearby.textContent).toContain('No check since')
  })

  it('opens an event from the URL and closes it on Escape', async () => {
    window.location.hash = '#/pages/alerts/history?drawer=hist-event&he.id=run-3'
    const { source } = fakeSource()
    const view = renderScreen(source)
    const details = await view.findByRole('dialog', { name: 'Scheduled check' })
    expect(within(details).getByText('Score 50')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(window.location.hash).not.toContain('hist-event'))
    expect(window.location.hash).not.toContain('he.id')
  })

  it('a stale event link says the event is gone', async () => {
    window.location.hash = '#/pages/alerts/history?drawer=hist-event&he.id=gone'
    const { source } = fakeSource()
    const view = renderScreen(source)
    const drawer = await view.findByRole('dialog', { name: 'Event' })
    expect(drawer.textContent).toContain("This event is not in this page's history any more.")
  })

  it('keeps the kind filter on the URL', async () => {
    const { source } = fakeSource([NOTE])
    const view = renderScreen(source)
    await showTimeline(view)
    fireEvent.click(
      within(await view.findByRole('group', { name: 'Show events' })).getByRole('button', {
        name: /^Notes/
      })
    )
    await waitFor(() => expect(window.location.hash).toContain('show=note'))
    expect(view.getByText(/1 event of /)).toBeTruthy()
  })

  it('adds a note with its date and reloads the timeline', async () => {
    const { source, calls } = fakeSource()
    const view = renderScreen(source)
    fireEvent.click(await view.findByRole('button', { name: 'Add note' }))
    const form = await view.findByRole('dialog', { name: 'Add a note' })
    expect(window.location.hash).toContain('drawer=hist-note')
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-10-16' } })
    fireEvent.change(within(form).getByLabelText('Note'), {
      target: { value: '  Rewrote the intro  ' }
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Save note' }))
    await waitFor(() => {
      expect(source['history:addNote']).toHaveBeenCalledWith({
        projectId: 'textbolt',
        pageId: 'alerts',
        date: '2026-10-16',
        text: 'Rewrote the intro'
      })
    })
    await waitFor(() => {
      expect(calls.list).toBe(2)
    })
    expect(await view.findByText('Rewrote the intro')).toBeTruthy()
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Add a note' })).toBeNull())
    await waitFor(() => expect(window.location.hash).not.toContain('hist-note'))
    expect(view.getByText('Note added to the timeline.')).toBeTruthy()
  })

  it('asks before closing Add a note with unsaved text', async () => {
    const { source } = fakeSource()
    const view = renderScreen(source)
    fireEvent.click(await view.findByRole('button', { name: 'Add note' }))
    const form = await view.findByRole('dialog', { name: 'Add a note' })
    fireEvent.change(within(form).getByLabelText('Note'), { target: { value: 'Half a thought' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Close Add a note' }))
    const ask = await view.findByRole('alertdialog', { name: 'Discard changes?' })
    fireEvent.click(within(ask).getByRole('button', { name: /^Keep/ }))
    await waitFor(() => expect(view.queryByRole('alertdialog')).toBeNull())
    expect(view.getByRole('dialog', { name: 'Add a note' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    const again = await view.findByRole('alertdialog', { name: 'Discard changes?' })
    fireEvent.click(within(again).getByRole('button', { name: /^Discard/ }))
    await waitFor(() => expect(view.queryByRole('dialog', { name: 'Add a note' })).toBeNull())
    expect(source['history:addNote']).not.toHaveBeenCalled()
  })

  it('refuses an empty note', async () => {
    const { source } = fakeSource()
    const view = renderScreen(source)
    fireEvent.click(await view.findByRole('button', { name: 'Add note' }))
    const form = await view.findByRole('dialog', { name: 'Add a note' })
    fireEvent.click(within(form).getByRole('button', { name: 'Save note' }))
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Write what changed on the page.'
    )
    expect(source['history:addNote']).not.toHaveBeenCalled()
  })

  it('edits and deletes a note', async () => {
    const { source, notes } = fakeSource([NOTE])
    const view = renderScreen(source)
    await showTimeline(view)
    fireEvent.click(await view.findByRole('button', { name: /Edit note from Oct 8, 2026/ }))
    const textarea = view
      .getAllByLabelText('Note')
      .find((item) => (item as HTMLTextAreaElement).value === 'Added 5 FAQs')
    if (!textarea) throw new Error('edit form missing')
    fireEvent.change(textarea, { target: { value: 'Added 6 FAQs' } })
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(source['history:updateNote']).toHaveBeenCalledWith({
        projectId: 'textbolt',
        noteId: 'n-1',
        date: '2026-10-08',
        text: 'Added 6 FAQs'
      })
    })
    expect(await view.findByText('Added 6 FAQs')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: /Delete note from Oct 8, 2026/ }))
    const confirm = view.getByRole('alertdialog', { name: 'Delete this note?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete note' }))
    await waitFor(() => {
      expect(source['history:deleteNote']).toHaveBeenCalledWith({
        projectId: 'textbolt',
        noteId: 'n-1'
      })
    })
    await waitFor(() => {
      expect(view.queryByText('Added 6 FAQs')).toBeNull()
    })
    expect(notes).toHaveLength(0)
  })

  it('edits and deletes a note in its drawer, the delete through a confirm', async () => {
    window.location.hash = '#/pages/alerts/history?drawer=hist-event&he.id=note-n-1'
    const { source, notes } = fakeSource([NOTE])
    const view = renderScreen(source)
    const drawer = await view.findByRole('dialog', { name: 'Note · Oct 8, 2026' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Edit note from Oct 8, 2026' }))
    await waitFor(() => expect(window.location.hash).toContain('he.note=edit'))
    const textarea = within(drawer).getByLabelText('Note') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Added 7 FAQs' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => {
      expect(source['history:updateNote']).toHaveBeenCalledWith({
        projectId: 'textbolt',
        noteId: 'n-1',
        date: '2026-10-08',
        text: 'Added 7 FAQs'
      })
    })
    await waitFor(() => expect(window.location.hash).not.toContain('he.note'))
    expect(await within(drawer).findByText('Added 7 FAQs')).toBeTruthy()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete note from Oct 8, 2026' }))
    const confirm = await view.findByRole('alertdialog', { name: 'Delete this note?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete note' }))
    await waitFor(() => expect(source['history:deleteNote']).toHaveBeenCalled())
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(notes).toHaveLength(0)
  })

  it('opens Compare content as a dialog and returns focus on Escape', async () => {
    const { source } = fakeSource()
    const view = renderScreen(source)
    await showTimeline(view)
    const opener = await view.findByRole('button', { name: 'Compare content' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = await view.findByRole('dialog', { name: 'Compare content' })
    expect(await within(dialog).findByText('Text alerts for business')).toBeTruthy()
    expect(source['history:compare']).toHaveBeenCalledWith({
      projectId: 'textbolt',
      pageId: 'alerts',
      fromSnapshotId: 'snap-1',
      toSnapshotId: 'snap-2'
    })
    expect(within(dialog).getByText('Q: What replaced txt.att.net?')).toBeTruthy()
    expect(within(dialog).getAllByText('Added:', { exact: false }).length).toBeGreaterThan(0)
    expect(within(dialog).getByText('Removed:', { exact: false })).toBeTruthy()
    const results = await axe.run(dialog, PAGE_RULES)
    expect(results.violations).toEqual([])
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(view.queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(opener)
  })

  it('shows the empty state and a way back to all events', async () => {
    const { source } = fakeSource([], () =>
      fixture([]).filter((event) => event.primary === 'check')
    )
    const view = renderScreen(source)
    fireEvent.click(await view.findByRole('button', { name: 'Notes 0' }))
    expect(view.getByText('No events match this filter')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Show all' }))
    expect(gridRows(view)).toHaveLength(3)
    await showTimeline(view)
    fireEvent.click(view.getByRole('button', { name: 'Notes 0' }))
    expect(view.getByText('Nothing of this kind yet for this page.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Show all events' }))
    expect(timelineTitles(view)).toHaveLength(3)

    cleanup()
    const empty = fakeSource([], () => [])
    const second = renderScreen(empty.source)
    expect(await second.findByText('Nothing of this kind yet for this page.')).toBeTruthy()
    expect(second.queryByRole('button', { name: 'Show all events' })).toBeNull()
  })

  it('shows a load error', async () => {
    const { source } = fakeSource()
    source['history:list'] = vi.fn(async () => {
      throw new Error('That project was not found')
    })
    const view = renderScreen(source)
    expect((await view.findByRole('alert')).textContent).toBe('That project was not found')
  })

  it('renders the assist hook point with the events', async () => {
    const { source } = fakeSource([NOTE])
    const view = render(
      <HistoryScreen
        source={source}
        projectId="textbolt"
        pageId="alerts"
        marketId={null}
        renderAssist={(context) => (
          <button type="button" onClick={() => void context.addNote('From the assist')}>
            Assist with {context.events.length} events
          </button>
        )}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Assist with 6 events' }))
    await waitFor(() => {
      expect(source['history:addNote']).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'From the assist' })
      )
    })
  })
})
