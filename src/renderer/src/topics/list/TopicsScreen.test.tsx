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
import { UndoToastHost } from '../../ui'
import { axeViolations } from '../../ui/axe.test-helper'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { DOUBLE_CLICK_MS } from './components/TopicNameCell'
import { resetSuggestCache } from './hooks/useSuggestTopics'
import { TopicsScreen } from './TopicsScreen'
import { fakeTopicsSource, topicsList, topicsSummaries } from './topics.fixtures.test-helper'

beforeEach(() => {
  // The List view is the topics grid these tests drive; the Tree and Grid have their own.
  window.history.replaceState(null, '', '#/topics?view=list')
  resetSuggestCache()
})

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
})

async function shown(
  source = fakeTopicsSource()
): Promise<{ view: RenderResult; source: ReturnType<typeof fakeTopicsSource> }> {
  const view = render(
    <>
      <TopicsScreen projectId="proj-1" source={source} viewStore={null} />
      <UndoToastHost />
    </>
  )
  await view.findByRole('grid', { name: 'Topics' })
  return { view, source }
}

function query(): URLSearchParams {
  const hash = window.location.hash
  return new URLSearchParams(hash.slice(hash.indexOf('?') + 1))
}

/** The window-wide Undo toast's text. */
async function toast(view: RenderResult, text: string): Promise<HTMLElement> {
  const shown = await view.findByTestId('topic-undo')
  await waitFor(() => expect(shown.textContent).toContain(text))
  return shown
}

async function rowMenu(view: RenderResult, name: string, item: string): Promise<void> {
  fireEvent.click(view.getByRole('button', { name: `Actions for ${name}` }))
  fireEvent.click(await view.findByRole('menuitem', { name: item }))
}

const A = 'Replacing a carrier email-to-text gateway'

describe('TopicsScreen', () => {
  it('shows the header, the KPI strip and one row per tracked topic, with no explainer', async () => {
    const { view } = await shown()
    expect(view.getByRole('heading', { level: 1, name: 'Topics' })).toBeTruthy()
    // No folder made: the line leaves the folders out (no "in 0 folders").
    expect(view.getByText(/^2 topics · \d+ searches$/)).toBeTruthy()
    expect(view.queryByRole('region', { name: 'How it fits' })).toBeNull()
    const kpis = view.getByRole('region', { name: 'Topics summary' })
    expect(within(kpis).getByRole('region', { name: 'Right page cited' })).toBeTruthy()
    const work = within(kpis).getByRole('region', { name: 'Needs work' })
    expect(
      within(work)
        .getByRole('link', { name: /^As \d+ page fix/ })
        .getAttribute('href')
    ).toBe('#/fixes')
    expect(within(kpis).getByRole('region', { name: 'Furthest behind' })).toBeTruthy()
    expect(within(kpis).getByRole('region', { name: 'Most improved' })).toBeTruthy()

    const grid = view.getByRole('grid', { name: 'Topics' })
    expect(within(grid).getByText(A)).toBeTruthy()
    expect(within(grid).getByText('10DLC for small senders')).toBeTruthy()
    expect(within(grid).queryByText('Old topic')).toBeNull()
    expect(within(grid).getByText('67%')).toBeTruthy()
    expect(within(grid).getByText('In band')).toBeTruthy()
    expect(within(grid).getByText('Below band')).toBeTruthy()
    expect(within(grid).getByText('3 of 4')).toBeTruthy()
    expect(within(grid).getByText('/email-to-text/')).toBeTruthy()
    expect(
      within(grid).getByRole('button', { name: /^\+1: show the other 1 target page / }).textContent
    ).toBe('+1')
    expect(within(grid).getByText(/· checked Oct 23, /)).toBeTruthy()
    expect(view.getByRole('link', { name: 'New topic' }).getAttribute('href')).toBe(
      '#/topics?view=list&drawer=new-topic'
    )
    expect(await axeViolations(view.container)).toEqual([])
  })

  it('with one topic: no comparison tiles, and the page fixes link opens Fixes cut to it', async () => {
    const one = topicsSummaries().filter((topic) => topic.id === 'topic-a')
    const { view } = await shown(fakeTopicsSource(topicsList(), one))
    const kpis = view.getByRole('region', { name: 'Topics summary' })
    expect(within(kpis).queryByRole('region', { name: 'Furthest behind' })).toBeNull()
    expect(within(kpis).queryByRole('region', { name: 'Most improved' })).toBeNull()
    const work = within(kpis).getByRole('region', { name: 'Needs work' })
    expect(
      within(work)
        .getByRole('link', { name: /^As \d+ page fix/ })
        .getAttribute('href')
    ).toBe('#/fixes?topic=topic-a')
  })

  it('the List leads with Target cited and names the questions goal in full', async () => {
    const { view } = await shown()
    const grid = view.getByRole('grid', { name: 'Topics' })
    expect(within(grid).getByRole('columnheader', { name: /^Target cited/ })).toBeTruthy()
    expect(
      within(grid).getByRole('columnheader', { name: /^Questions goal \(target 50–70%\)/ })
    ).toBeTruthy()
    expect(
      within(grid).getAllByRole('button', { name: /^Questions goal: \d+% \(target 50–70%\)/ })
        .length
    ).toBeGreaterThan(0)
  })

  it('every count opens the questions it counts', async () => {
    const { view } = await shown()
    fireEvent.click(view.getByRole('button', { name: `Show the 4 questions in ${A}` }))
    const drawer = await view.findByRole('dialog', { name: `Questions in ${A} · 4 questions` })
    expect(within(drawer).getByText('why did my carrier email to text stop working')).toBeTruthy()
    expect(within(drawer).queryByText('email to text gateway')).toBeNull()
  })

  it('renames a topic in place from the row menu: Enter saves, Undo puts it back', async () => {
    const { view, source } = await shown()
    await rowMenu(view, A, 'Rename')
    const input = await view.findByRole('textbox', { name: `Rename ${A}` })
    fireEvent.change(input, { target: { value: 'Email-to-text gateway shut down' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await toast(view, 'Renamed to Email-to-text gateway shut down.')
    expect(view.queryByRole('textbox', { name: `Rename ${A}` })).toBeNull()
    expect(source.calls['topics:update']).toEqual([
      { projectId: 'proj-1', topicId: 'topic-a', name: 'Email-to-text gateway shut down' }
    ])
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(source.calls['topics:update']).toHaveLength(2))
    expect(source.calls['topics:update']?.[1]).toEqual({
      projectId: 'proj-1',
      topicId: 'topic-a',
      name: A
    })
  })

  it('double-click renames, Escape cancels, and a single click still opens', async () => {
    const { view, source } = await shown()
    const grid = view.getByRole('grid', { name: 'Topics' })
    fireEvent.doubleClick(within(grid).getByText('10DLC for small senders'))
    const input = await view.findByRole('textbox', { name: 'Rename 10DLC for small senders' })
    fireEvent.change(input, { target: { value: 'Something else' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(view.queryByRole('textbox', { name: /^Rename/ })).toBeNull()
    expect(source.calls['topics:update']).toBeUndefined()
    fireEvent.click(within(grid).getByText('10DLC for small senders'))
    await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_MS + 40))
    // The topic opens (the still-mounted list may add its remembered view to the URL).
    expect(window.location.hash).toMatch(/^#\/topics\/topic-b(\?|$)/)
  })

  it('deletes a topic at once, and Undo brings it back', async () => {
    const { view, source } = await shown()
    await rowMenu(view, '10DLC for small senders', 'Delete topic')
    await toast(view, 'Deleted 10DLC for small senders.')
    const grid = view.getByRole('grid', { name: 'Topics' })
    await waitFor(() => expect(within(grid).queryByText('10DLC for small senders')).toBeNull())
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await toast(view, '10DLC for small senders is back.')
    await within(grid).findByText('10DLC for small senders')
    expect(source.calls['topics:update']).toEqual([
      { projectId: 'proj-1', topicId: 'topic-b', status: 'removed' },
      { projectId: 'proj-1', topicId: 'topic-b', status: 'tracked' }
    ])
  })

  it('pauses and resumes checks, with a Paused chip and Undo', async () => {
    const { view, source } = await shown()
    await rowMenu(view, A, 'Pause checks')
    await toast(view, `Paused checks for ${A}.`)
    const grid = view.getByRole('grid', { name: 'Topics' })
    expect(await within(grid).findByText('Paused')).toBeTruthy()
    await rowMenu(view, A, 'Resume checks')
    await toast(view, `Resumed checks for ${A}.`)
    await waitFor(() => expect(within(grid).queryByText('Paused')).toBeNull())
    expect(source.calls['topics:update']).toEqual([
      { projectId: 'proj-1', topicId: 'topic-a', status: 'paused' },
      { projectId: 'proj-1', topicId: 'topic-a', status: 'tracked' }
    ])
  })

  it('duplicates a topic; Undo removes the copy', async () => {
    const { view, source } = await shown()
    await rowMenu(view, A, 'Duplicate')
    await toast(view, `Made ${A} (copy).`)
    expect(source.calls['topics:duplicate']).toEqual([{ projectId: 'proj-1', topicId: 'topic-a' }])
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await toast(view, 'The copy is gone.')
    expect(source.calls['topics:update']).toEqual([
      { projectId: 'proj-1', topicId: 'topic-a-copy', status: 'removed' }
    ])
  })

  it('Edit topic… opens the Topic settings drawer on the URL', async () => {
    const { view } = await shown()
    await rowMenu(view, A, 'Edit topic…')
    await waitFor(() => expect(query().get('drawer')).toBe('topic-settings'))
    expect(query().get('ts.topic')).toBe('topic-a')
  })

  it('acts on every ticked topic from the bulk bar', async () => {
    const { view, source } = await shown()
    const grid = view.getByRole('grid', { name: 'Topics' })
    fireEvent.click(within(grid).getByRole('checkbox', { name: 'Select every row on this page' }))
    fireEvent.click(view.getByRole('button', { name: 'Pause checks' }))
    await toast(view, 'Paused checks for 2 topics.')
    expect(source.calls['topics:update']).toEqual([
      { projectId: 'proj-1', topicId: 'topic-a', status: 'paused' },
      { projectId: 'proj-1', topicId: 'topic-b', status: 'paused' }
    ])
    await waitFor(() => expect(within(grid).getAllByText('Paused')).toHaveLength(2))
    fireEvent.click(within(grid).getByRole('checkbox', { name: 'Select every row on this page' }))
    fireEvent.click(view.getByRole('button', { name: 'More topic actions' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Delete' }))
    await toast(view, 'Deleted 2 topics.')
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await toast(view, 'They are back.')
    // Paused topics come back paused.
    expect(source.calls['topics:update']?.slice(-2)).toEqual([
      { projectId: 'proj-1', topicId: 'topic-a', status: 'paused' },
      { projectId: 'proj-1', topicId: 'topic-b', status: 'paused' }
    ])
  })

  it('creates an empty topic from the header, kept in the URL', async () => {
    const { view, source } = await shown()
    fireEvent.click(view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'New empty topic' }))
    await waitFor(() => expect(query().get('new')).toBe('empty'))
    const form = view.getByRole('form', { name: 'New empty topic' })
    fireEvent.click(within(form).getByRole('button', { name: 'Create topic' }))
    expect(within(form).getByRole('alert').textContent).toBe('Give the topic a name.')
    fireEvent.change(within(form).getByRole('textbox'), {
      target: { value: ' Pricing  questions ' }
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Create topic' }))
    await toast(view, 'Created Pricing questions.')
    expect(source.calls['topics:createEmpty']).toEqual([
      { projectId: 'proj-1', name: 'Pricing questions' }
    ])
    await waitFor(() => expect(query().get('new')).toBeNull())
    expect(query().get('row')).toBe('topic-new')
  })

  it('opens the other target pages of a topic from "+n", as many as it says', async () => {
    const { view } = await shown()
    const grid = view.getByRole('grid', { name: 'Topics' })
    // The cell shows the first page; "+1" opens the 1 other.
    expect(within(grid).getByText('/email-to-text/')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: `+1: show the other 1 target page of ${A}` }))
    const drawer = await view.findByRole('dialog', {
      name: `More target pages of ${A} · 1 target page`
    })
    expect(drawer.querySelectorAll('[data-drill-row]')).toHaveLength(1)
    expect(within(drawer).queryByText('/email-to-text/')).toBeNull()
  })

  it('says merging needs two topics when there is only one', async () => {
    const one = topicsSummaries().filter((topic) => topic.id !== 'topic-b')
    const { view } = await shown(fakeTopicsSource(topicsList(), one))
    await rowMenu(view, A, 'Merge into another topic…')
    const dialog = await view.findByRole('dialog', { name: 'Merge into another topic' })
    expect(dialog.textContent).toContain('Merging needs two topics')
    expect(dialog.textContent).toContain('is the only topic, so there is nothing to merge it into')
    expect(within(dialog).queryByRole('radio')).toBeNull()
    // No merge button to wonder about: Close, and New topic instead.
    expect(within(dialog).queryByRole('button', { name: 'Merge topics' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'New topic' }))
    await waitFor(() => expect(query().get('new')).toBe('empty'))
    expect(view.queryByRole('dialog', { name: 'Merge into another topic' })).toBeNull()
    expect(view.getByRole('form', { name: 'New empty topic' })).toBeTruthy()
  })

  it('merges into the picked topic and previews a split', async () => {
    const { view, source } = await shown()
    await rowMenu(view, A, 'Split by stage…')
    let dialog = await view.findByRole('dialog', { name: 'Split by stage' })
    expect(dialog.textContent).toContain(`${A} · Options`)
    expect(dialog.textContent).toContain(`${A} · Compare`)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Split into 3 topics' }))
    await view.findByText('Split Replacing into 3 topics.')

    await rowMenu(view, A, 'Merge into another topic…')
    dialog = await view.findByRole('dialog', { name: 'Merge into another topic' })
    expect(within(dialog).getByRole('radio', { name: /10DLC for small senders/ })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge topics' }))
    await toast(view, `Merged ${A} into 10DLC for small senders (4 questions moved).`)
    expect(source.calls['topics:merge']).toEqual([
      { projectId: 'proj-1', topicId: 'topic-a', intoTopicId: 'topic-b' }
    ])
    // Undo brings the topic back, then moves its questions back out.
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await toast(view, `${A} is back.`)
    expect(source.calls['topics:update']?.at(-1)).toEqual({
      projectId: 'proj-1',
      topicId: 'topic-a',
      status: 'tracked'
    })
    expect(source.calls['topics:moveQuestions']).toEqual([
      {
        projectId: 'proj-1',
        items: [{ sourceId: 'topic-b', promptId: 'q-41' }],
        to: { kind: 'topic', topicId: 'topic-a' }
      }
    ])
  })

  it('Check now on ticked topics opens the Check now drawer scoped to them', async () => {
    const { view } = await shown()
    const grid = view.getByRole('grid', { name: 'Topics' })
    fireEvent.click(within(grid).getByRole('checkbox', { name: 'Select every row on this page' }))
    fireEvent.click(view.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(query().get('drawer')).toBe('check-now'))
    expect(query().get('check.scope')).toBe('topic')
    expect(query().get('check.ids')?.split(',').sort()).toEqual(['topic-a', 'topic-b'])
    window.history.replaceState(null, '', '#/topics')
    await rowMenu(view, A, 'Check now…')
    await waitFor(() => expect(query().get('check.ids')).toBe('topic-a'))
  })

  it('opens Merge from a link as a drawer; Escape closes it and the address loses it', async () => {
    window.history.replaceState(null, '', '#/topics?action=merge&topic=topic-a')
    const { view } = await shown()
    const drawer = await view.findByRole('dialog', { name: 'Merge into another topic' })
    expect(drawer.getAttribute('data-drawer')).toBe('topic-merge')
    expect(within(drawer).getByRole('complementary', { name: 'Before and after' })).toBeTruthy()
    expect(within(drawer).getByRole('list', { name: 'Questions that move' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(query().get('action')).toBeNull()
    expect(query().get('topic')).toBeNull()
  })

  it('Back closes Split by stage after opening it from the row menu', async () => {
    const { view } = await shown()
    await rowMenu(view, A, 'Split by stage…')
    await view.findByRole('dialog', { name: 'Split by stage' })
    expect(query().get('action')).toBe('split')
    window.history.back()
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    expect(query().get('action')).toBeNull()
  })

  it('asks before deleting from a link, and Cancel keeps the topic', async () => {
    window.history.replaceState(null, '', '#/topics?action=delete&topic=topic-a')
    const { view, source } = await shown()
    const ask = await view.findByRole('alertdialog', { name: 'Delete this topic?' })
    expect(ask.textContent).toContain('you can undo this')
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(view.queryByRole('alertdialog')).toBeNull())
    expect(query().get('action')).toBeNull()
    expect(source.calls['topics:update'] ?? []).toEqual([])
  })

  it('deletes from the confirm, with Undo in the status line', async () => {
    window.history.replaceState(null, '', '#/topics?action=delete&topic=topic-a')
    const { view, source } = await shown()
    const ask = await view.findByRole('alertdialog', { name: 'Delete this topic?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete topic' }))
    await view.findByText(`Deleted ${A}. Its questions and history are kept.`)
    expect(source.calls['topics:update']).toEqual([
      { projectId: 'proj-1', topicId: 'topic-a', status: 'removed' }
    ])
    expect(query().get('action')).toBeNull()
  })

  it('turns an old rename link into Topic settings', async () => {
    window.history.replaceState(null, '', '#/topics?action=rename&topic=topic-a')
    await shown()
    await waitFor(() => expect(query().get('drawer')).toBe('topic-settings'))
    expect(query().get('ts.topic')).toBe('topic-a')
    expect(query().get('action')).toBeNull()
  })

  it('suggests topics and creates the ticked ones without a check', async () => {
    const { view, source } = await shown()
    fireEvent.click(view.getByRole('button', { name: 'More actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Suggest topics' }))
    await waitFor(() => expect(query().get('suggest')).toBe('1'))
    const section = await view.findByRole('region', { name: 'Suggested topics for textbolt.com' })
    await within(section).findByText('Text alerts from monitoring tools')
    expect(within(section).getByText('e.g. “send an SMS when a Grafana alert fires”')).toBeTruthy()
    expect(within(section).getByText(/fits \/pricing\//)).toBeTruthy()
    const boxes = within(section).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map((box) => box.checked)).toEqual([true, true, false])
    fireEvent.click(within(section).getByRole('button', { name: 'Create 2 topics' }))
    await within(section).findByText(/Nothing is checked until you press Check now/)
    const request = source.calls['topics:createTopics']?.[0] as {
      topics: { name: string; targetUrl: string | null }[]
    }
    expect(request.topics.map((topic) => [topic.name, topic.targetUrl])).toEqual([
      ['Text alerts from monitoring tools', null],
      ['Appointment reminders for small clinics', 'https://textbolt.com/pricing/']
    ])
    fireEvent.click(within(section).getByRole('button', { name: 'Suggest others' }))
    await waitFor(() => expect(source.calls['topics:suggestTopics']).toHaveLength(2))
    expect(source.calls['topics:suggestTopics']?.[1]).toMatchObject({
      avoid: [
        'Text alerts from monitoring tools',
        'Appointment reminders for small clinics',
        'A cheaper alternative for alerts'
      ]
    })
  })

  it('shows the empty state when there is no topic', async () => {
    const source = fakeTopicsSource(topicsList([]), [])
    const view = render(<TopicsScreen projectId="proj-1" source={source} viewStore={null} />)
    expect(await view.findByText('No topics yet')).toBeTruthy()
    expect(view.getAllByRole('link', { name: 'New topic' })).toHaveLength(2)
    // ✦ Help me find them: New topic open on "A buyer problem".
    expect(view.getByRole('link', { name: 'Help me find them' }).getAttribute('href')).toMatch(
      /drawer=new-topic&way=problem$/u
    )
    expect(view.getByRole('button', { name: 'Suggest topics' })).toBeTruthy()
  })
})
