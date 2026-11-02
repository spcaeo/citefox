// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudeStatus } from '@shared/ipc'
import { rollupPageFixes } from '@shared/page-fixes'
import { fix as loggedFix } from '../../progress/fixtures'
import { PermissionsContext, type PermissionsContextValue } from '../../ui/permissionsContext'
import { emptyFixList, fakeLoopSource, NOW } from '../fixtures'
import { FixesScreen } from '../index'
import { projectSearches } from '../searchFixtures'
import type { ProjectFixesSource } from '../source'
import { UndoToastHost } from '../../ui/UndoToast'
import { resetUndoToastForTests } from '../../ui/undoStore'

const AXE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
  window.location.hash = ''
})

function show(
  source: ProjectFixesSource,
  permissions: PermissionsContextValue | null = null
): ReturnType<typeof render> {
  return render(
    <PermissionsContext.Provider value={permissions}>
      <FixesScreen projectId="proj-1" source={source} now={NOW} />
      <UndoToastHost />
    </PermissionsContext.Provider>
  )
}

/** The app's permissions with CiteFox AI not connected. */
function noAi(): PermissionsContextValue {
  const claude: ClaudeStatus = {
    connection: 'claude-code',
    state: 'needs_setup',
    name: 'Claude Code',
    summary: 'not signed in',
    plan: null,
    model: null,
    checkedAt: null,
    fresh: true,
    nextStep: 'Sign in.'
  }
  return {
    snapshot: null,
    claude,
    loading: false,
    error: null,
    checking: false,
    progress: null,
    steps: {},
    busy: null,
    message: null,
    refresh: () => Promise.resolve(null),
    checkClaude: () => Promise.resolve(claude),
    ensureClaude: () => Promise.resolve(claude),
    request: () => Promise.resolve(null)
  }
}

/** Brief calls only (the save that follows a brief left out). */
function briefRuns(calls: { channel: string }[]): { channel: string }[] {
  return calls.filter((call) => call.channel !== 'fixes:saveBrief')
}

/** The story's fixes, by kind, as the rollup makes them (ids are opaque). */
const FIXES = rollupPageFixes(projectSearches().searches).fixes
function fixId(kind: 'improve' | 'owner' | 'new'): string {
  const fix = FIXES.find((item) => item.kind === kind)
  if (!fix) throw new Error(`no ${kind} fix`)
  return fix.id
}

function hashParams(): URLSearchParams {
  const hash = window.location.hash
  const at = hash.indexOf('?')
  return new URLSearchParams(at < 0 ? '' : hash.slice(at + 1))
}

describe('Fixes · What to fix', () => {
  it('opens on What to fix: the fixes grouped by kind, and passes axe', async () => {
    window.location.hash = '#/fixes'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    // Groups start closed.
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    expect(
      view.getByText(
        '11 searches need work. We grouped them by page, so you fix 4 pages, not 11 searches.'
      )
    ).toBeTruthy()
    const tabs = view.getByRole('tablist', { name: 'Fixes views' })
    expect(
      within(tabs)
        .getByRole('tab', { name: /^What to fix/ })
        .getAttribute('aria-selected')
    ).toBe('true')
    // No tiles over the grid: its kind groups carry the same counts.
    expect(view.queryByRole('region', { name: 'Page fixes by kind' })).toBeNull()
    for (const label of ['Improve a page', 'Pick which page owns it', 'Write a new page']) {
      expect(within(grid).getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(within(grid).getByRole('button', { name: 'Choose owner' })).toBeTruthy()
    expect(within(grid).getByRole('button', { name: 'Get page brief' })).toBeTruthy()
    expect(within(grid).getAllByRole('button', { name: 'Get fix brief' })).toHaveLength(2)
    // The footer is just the count.
    expect(view.getByText('4 fixes')).toBeTruthy()
    expect(view.queryByText('To do')).toBeNull()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('groups by kind with a short line; Group by page or topic is in the URL', async () => {
    window.location.hash = '#/fixes'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    expect(grid.querySelector('.fxt-group-todo')?.textContent).toBe(
      'the page exists, Google picks others'
    )

    const groups = (): string[] =>
      [...grid.querySelectorAll('.fxt-group-label')].map((item) => item.textContent ?? '')
    expect(groups()).toEqual(['Improve a page', 'Pick which page owns it', 'Write a new page'])
    window.location.hash = '#/fixes?by=topic'
    await waitFor(() =>
      expect(groups()).toEqual([
        'Nagios and monitoring alerts',
        'School emergency texts',
        '/pricing'
      ])
    )
    window.location.hash = '#/fixes?by=page'
    const flat = await view.findByRole('grid', { name: 'What to fix' })
    expect(flat.querySelectorAll('.fxt-group-label')).toHaveLength(0)
    expect(within(flat).getAllByRole('row').length).toBeGreaterThan(4)
  })

  it('#/fixes?topic=<id> keeps that topic: its fixes, its lead line', async () => {
    window.location.hash = '#/fixes?topic=topic-school'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    expect(
      await view.findByText(
        '3 searches need work. We grouped them by page, so you fix 1 page, not 3 searches.'
      )
    ).toBeTruthy()
    expect(within(grid).getByRole('button', { name: 'Get page brief' })).toBeTruthy()
    expect(within(grid).queryByRole('button', { name: 'Choose owner' })).toBeNull()
    expect(view.getByRole('combobox', { name: 'Topic' })).toBeTruthy()
  })

  it('Nothing to do now is folded at the end, in the URL, and each count opens its searches', async () => {
    window.location.hash = '#/fixes'
    const { source } = fakeLoopSource()
    const view = show(source)
    const head = await view.findByRole('button', { name: /^Nothing to do now/ })
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(head.textContent).toContain(
      '3 already cite your target page · 2 have no AI Overview · 1 not checked yet'
    )
    fireEvent.click(head)
    await waitFor(() => expect(hashParams().get('nothing')).toBe('open'))
    const count = await view.findByRole('button', {
      name: '2 searches: Searches with no AI Overview'
    })
    fireEvent.click(count)
    const drill = await view.findByRole('dialog', { name: /Searches with no AI Overview/ })
    expect(drill.querySelectorAll('[data-drill-row]')).toHaveLength(2)
  })

  it('a fix count opens exactly its searches', async () => {
    window.location.hash = '#/fixes'
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    // Groups start closed.
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(within(grid).getByRole('button', { name: '4 searches: open the list' }))
    const drill = await view.findByRole('dialog')
    expect(drill.querySelectorAll('[data-drill-row]')).toHaveLength(4)
  })

  it('Get fix brief opens the fix in the URL and writes the brief from saved checks', async () => {
    window.location.hash = '#/fixes'
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    // Groups start closed.
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    const first = within(grid).getAllByRole('button', { name: 'Get fix brief' })[0]
    fireEvent.click(first as HTMLElement)
    await waitFor(() => expect(hashParams().get('pf')).toBe(fixId('improve')))
    await waitFor(() => expect(briefRuns(calls.briefs)).toHaveLength(1))
    expect(calls.briefs[0]).toMatchObject({
      channel: 'topics:draftFix',
      request: { projectId: 'proj-1', topicId: 'topic-nagios', promptId: 'nagios-p1' }
    })
    const drawer = await view.findByRole('dialog', { name: /Improve a page/ })
    const log = await within(drawer).findByRole('button', { name: /^Log as a fix/ })
    fireEvent.click(log)
    await waitFor(() => expect(window.location.hash).toContain('drawer=fix'))
    expect(window.location.hash).toContain('fix.text=')
  })

  it('Get page brief asks for the new page brief', async () => {
    window.location.hash = '#/fixes'
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    // Groups start closed.
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(within(grid).getByRole('button', { name: 'Get page brief' }))
    await waitFor(() => expect(briefRuns(calls.briefs)).toHaveLength(1))
    expect(calls.briefs[0]).toMatchObject({
      channel: 'topics:draftPageBrief',
      request: { topicId: 'topic-school', promptId: 'school-p1' }
    })
    expect(await view.findByRole('dialog', { name: /Write a new page/ })).toBeTruthy()
  })

  it('Choose owner makes the cited page the target, with Undo', async () => {
    window.location.hash = `#/fixes?pf=${fixId('owner')}`
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    const drawer = await view.findByRole('dialog', { name: /Pick which page owns it/ })
    fireEvent.click(
      within(drawer).getByRole('button', { name: /^Make \/blog\/nagios-setup\/ the owner/ })
    )
    await waitFor(() =>
      expect(calls.briefs.filter((call) => call.channel === 'topics:setTarget')).toHaveLength(1)
    )
    expect(calls.briefs[0]).toMatchObject({
      request: {
        projectId: 'proj-1',
        topicId: 'topic-nagios',
        target: { pageId: null, url: 'https://textbolt.com/blog/nagios-setup/' }
      }
    })
    expect(await view.findByRole('button', { name: 'Undo' })).toBeTruthy()
  })

  it('a written brief is saved: the Status turns Brief ready, the filter is in the URL', async () => {
    window.location.hash = '#/fixes'
    const { source, calls } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    // Groups start closed.
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    // "New" on every fix says nothing: the Status column waits until one moves on.
    expect(within(grid).queryByRole('columnheader', { name: /Status/ })).toBeNull()
    fireEvent.click(within(grid).getByRole('button', { name: 'Get page brief' }))
    await waitFor(() =>
      expect(calls.briefs.filter((call) => call.channel === 'fixes:saveBrief')).toHaveLength(1)
    )
    expect(calls.briefs.at(-1)).toMatchObject({
      request: { projectId: 'proj-1', fixId: fixId('new'), brief: { title: 'Page brief' } }
    })
    await waitFor(() => expect(within(grid).getAllByText('Brief ready')).toHaveLength(1))
    const filter = view.getByRole('group', { name: 'Status' })
    fireEvent.click(within(filter).getByRole('button', { name: /^Brief ready/ }))
    await waitFor(() => expect(hashParams().get('state')).toBe('brief'))
    await waitFor(() => expect(within(grid).queryByText('New')).toBeNull())
  })

  it('a change logged on the page since its last check reads Logged and opens Changes made', async () => {
    window.location.hash = '#/fixes?state=logged'
    const logged = loggedFix({
      id: 'fix-9',
      pageId: 'page-pricing',
      goLiveAt: '2026-10-29T11:00:00.000Z',
      createdAt: '2026-10-29T11:00:00.000Z'
    })
    const { source } = fakeLoopSource(undefined, {
      'fixes:listProject': () =>
        Promise.resolve({
          ...emptyFixList(),
          fixes: [{ fix: logged, searchesMin: 1, searchesMax: 2 }]
        })
    })
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    const open = await within(grid).findByRole('button', {
      name: 'Logged: open it in Changes made'
    })
    expect(within(grid).queryByText('New')).toBeNull()
    fireEvent.click(open)
    await waitFor(() => expect(hashParams().get('view')).toBe('log'))
    expect(hashParams().get('page')).toBe('page-pricing')
  })

  it('with no AI connected the drawer shows one notice and one button, and runs nothing', async () => {
    window.location.hash = '#/fixes'
    const { source, calls } = fakeLoopSource()
    const view = show(source, noAi())
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    // Groups start closed.
    fireEvent.click(view.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(
      within(grid).getAllByRole('button', { name: 'Get fix brief' })[0] as HTMLElement
    )
    const drawer = await view.findByRole('dialog', { name: /Improve a page/ })
    const notice = await within(drawer).findByTestId('fxt-no-ai')
    expect(
      within(notice).getByRole('link', { name: 'Connect CiteFox AI to write this brief' })
    ).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'Get fix brief' })).toBeNull()
    expect(within(drawer).getAllByText('Get fix brief')).toHaveLength(1)
    expect(briefRuns(calls.briefs)).toEqual([])
  })

  it('an owner fix names both paths on two lines, and each search in the drawer has its own copy icon', async () => {
    window.location.hash = `#/fixes?pf=${fixId('owner')}`
    const { source } = fakeLoopSource()
    const view = show(source)
    const grid = await view.findByRole('treegrid', { name: 'What to fix' })
    // A link to one fix opens its group only; the others stay closed.
    expect(within(grid).queryByRole('button', { name: 'Get fix brief' })).toBeNull()
    const owner = within(grid).getByText('Owner now:')
    const target = within(grid).getByText('Target:')
    // "Owner now: /path" over "Target: /path": one line each, in one cell.
    expect(owner.parentElement?.parentElement).toBe(target.parentElement?.parentElement)
    expect(owner.parentElement).not.toBe(target.parentElement)
    const drawer = await view.findByRole('dialog', { name: /Pick which page owns it/ })
    const list = drawer.querySelector('.fxt-searches') as HTMLElement
    expect(within(list).getAllByRole('button', { name: /^Copy / }).length).toBeGreaterThan(0)
  })

  it('a fix that is gone says so', async () => {
    window.location.hash = '#/fixes?pf=pfgone'
    const { source } = fakeLoopSource()
    const view = show(source)
    expect(await view.findByText('That fix is done or no longer needed.')).toBeTruthy()
  })
})
