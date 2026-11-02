// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, describe, expect, it } from 'vitest'
import type { FixList, LoggedFix, Market } from '@shared/domain'
import type { FixIdRequest, GapSuggestion, ProjectFixList } from '@shared/ipc'
import { fix, outcome } from '../progress/fixtures'
import { resetDrawersForTests } from '../shell/drawers'
import { fakeLoopSource } from './fixtures'
import { UndoToastHost } from '../ui/UndoToast'
import { resetUndoToastForTests } from '../ui/undoStore'
import { FixesScreen } from './index'
import type { ProjectFixesSource } from './source'

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

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
  resetDrawersForTests()
  window.location.hash = ''
})

const done = fix()
const planned = fix({
  id: 'fix-2',
  number: 2,
  description: 'Add a **per-message** price table',
  status: 'planned',
  goLiveAt: '2026-10-21T12:00:00.000Z',
  followUpAt: '2026-10-24T12:00:00.000Z',
  followUpJobId: null,
  followUpRunId: null,
  promptIds: ['p4', 'p5'],
  marketIds: ['mkt-us'],
  verdict: null,
  markets: [outcome({ verdict: 'waiting', afterAt: null, afterRunId: null, compared: 0 })]
})
const onTopic = fix({
  id: 'fix-3',
  pageId: 'topic-1',
  number: 1,
  description: 'Answer what replaced the AT&T gateway',
  status: 'started',
  followUpAt: null,
  followUpRunId: null,
  verdict: null,
  markets: [outcome({ verdict: 'waiting', afterAt: null, afterRunId: null, compared: 0 })]
})

const gap: GapSuggestion = {
  id: 'row-1',
  pageId: 'page-1',
  promptId: 'p7',
  promptLabel: 'Q7',
  promptText: 'Does it work with Outlook rules?',
  coverage: 'weak',
  priority: 'high',
  actions: ['new_faq'],
  whatToUpdate: 'Add an Outlook rules FAQ.',
  mainGap: 'No Outlook answer.'
}

function list(fixes: readonly LoggedFix[] = [done, planned, onTopic]): ProjectFixList {
  return {
    projectId: 'proj-1',
    markets: [US],
    subjects: [
      { id: 'page-1', kind: 'page', label: 'Pricing', url: 'https://textbolt.com/pricing/' },
      { id: 'topic-1', kind: 'topic', label: 'Carrier gateways', url: null }
    ],
    fixes: fixes.map((item) => ({
      fix: item,
      searchesMin: item.promptIds.length,
      searchesMax: item.promptIds.length * 2
    })),
    suggestions: [gap]
  }
}

function fakeSource(start: ProjectFixList = list()): {
  source: ProjectFixesSource
  calls: { runs: FixIdRequest[]; deletes: FixIdRequest[]; restores: FixIdRequest[]; lists: number }
} {
  let current = start
  const calls = {
    runs: [] as FixIdRequest[],
    deletes: [] as FixIdRequest[],
    restores: [] as FixIdRequest[],
    lists: 0
  }
  const removed = new Map<string, ProjectFixList['fixes'][number]>()
  const source: ProjectFixesSource = {
    ...fakeLoopSource().source,
    'fixes:listProject': () => {
      calls.lists += 1
      return Promise.resolve(current)
    },
    'fixes:runFollowUp': (request) => {
      calls.runs.push(request)
      const found = current.fixes.find((item) => item.fix.id === request.fixId)
      if (!found) return Promise.reject(new Error('That fix was not found'))
      const started = { ...found.fix, status: 'started' as const, followUpAt: null }
      current = {
        ...current,
        fixes: current.fixes.map((item) =>
          item.fix.id === request.fixId ? { ...item, fix: started } : item
        )
      }
      return Promise.resolve({ fix: started, jobId: 'job-9' })
    },
    'fixes:delete': (request) => {
      calls.deletes.push(request)
      const gone = current.fixes.find((item) => item.fix.id === request.fixId)
      if (gone) removed.set(request.fixId, gone)
      current = {
        ...current,
        fixes: current.fixes.filter((item) => item.fix.id !== request.fixId)
      }
      const result: FixList = { pageId: 'page-1', fixes: [], nextFixNumber: 3 }
      return Promise.resolve(result)
    },
    'fixes:restore': (request) => {
      calls.restores.push(request)
      const back = removed.get(request.fixId)
      if (!back) return Promise.reject(new Error('That fix can no longer be put back'))
      current = { ...current, fixes: [...current.fixes, back] }
      return Promise.resolve(back.fix)
    }
  }
  return { source, calls }
}

describe('Fixes screen: Fix log (?view=log)', () => {
  it('lists every fix grouped by status, open first, with its page, questions and follow-up', async () => {
    window.location.hash = '#/fixes?view=log'
    const { source } = fakeSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Fixes' })
    expect(view.getByText(/3 fixes across your pages and topics, 1 open/)).toBeTruthy()
    const text = grid.textContent ?? ''
    expect(text.indexOf('Open')).toBeLessThan(text.indexOf('Checking'))
    expect(text.indexOf('Checking')).toBeLessThan(text.indexOf('Done'))
    expect(within(grid).getByText('per-message').tagName).toBe('STRONG')
    expect(within(grid).getByText('Follow-up check planned for Oct 24')).toBeTruthy()
    expect(within(grid).getByText('Follow-up check running')).toBeTruthy()
    expect(grid.textContent).toContain('Partly worked · 1 of 3 questions')
    expect(within(grid).getAllByText('/pricing/').length).toBe(2)
    expect(within(grid).getByText('Carrier gateways')).toBeTruthy()
    expect(
      within(grid).getByRole('button', { name: '2 questions Fix 2 should help' }).textContent
    ).toMatch(/^2\s+questions$/)
    // The content gaps that are not fixes yet.
    const gaps = view.getByRole('grid', { name: 'Content gaps not fixed yet' })
    expect(within(gaps).getByText('Does it work with Outlook rules?')).toBeTruthy()
    const results = await axe.run(view.container, AXE_RULES)
    expect(results.violations.map((item) => item.id)).toEqual([])
  })

  it('filters by status and page, keeps them in the URL, and restores them', async () => {
    window.location.hash = '#/p/proj-1/fixes?view=log&status=done'
    const { source } = fakeSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Fixes' })
    expect(within(grid).queryByText('Fix 2')).toBeNull()
    expect(within(grid).getByText('Added 5 FAQs')).toBeTruthy()
    const filters = view.getByRole('group', { name: 'Show fixes by status' })
    fireEvent.click(within(filters).getByRole('button', { name: /^All/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/p/proj-1/fixes?view=log'))
    fireEvent.change(view.getByRole('combobox', { name: 'Page or topic' }), {
      target: { value: 'topic-1' }
    })
    await waitFor(() => expect(window.location.hash).toBe('#/p/proj-1/fixes?view=log&page=topic-1'))
    expect(within(grid).queryByText('Added 5 FAQs')).toBeNull()
    expect(within(grid).getByText('Answer what replaced the AT&T gateway')).toBeTruthy()
    // Gaps follow the page filter too.
    expect(view.queryByRole('grid', { name: 'Content gaps not fixed yet' })).toBeNull()
  })

  it('selecting a fix opens the fix drawer, with the fix in the URL', async () => {
    window.location.hash = '#/fixes?view=log'
    const { source } = fakeSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Fixes' })
    fireEvent.click(within(grid).getByText('Added 5 FAQs'))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=log&drawer=fix&fix=fix-1'))
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Fix 2' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Edit…' }))
    await waitFor(() =>
      expect(window.location.hash).toBe('#/fixes?view=log&drawer=fix&fix=fix-2&fix.mode=edit')
    )
  })

  it('opens an old fix link in the drawer, and Log a fix opens it empty', async () => {
    window.location.hash = '#/fixes?view=log&fix=fix-2'
    const { source } = fakeSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} />)
    await view.findByRole('grid', { name: 'Fixes' })
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=log&drawer=fix&fix=fix-2'))
    window.location.hash = '#/fixes?view=log'
    fireEvent.click(view.getByRole('button', { name: 'Log a fix' }))
    await waitFor(() => expect(window.location.hash).toBe('#/fixes?view=log&drawer=fix&fix=new'))
  })

  it('opens the questions a fix should help', async () => {
    window.location.hash = '#/fixes?view=log'
    const { source } = fakeSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Fixes' })
    fireEvent.click(within(grid).getByRole('button', { name: '2 questions Fix 2 should help' }))
    const drawer = await view.findByRole('dialog', { name: /Questions Fix 2 should help/ })
    expect(drawer.textContent).toContain('2 questions')
  })

  it('opens the page’s fix detail from the row menu', async () => {
    window.location.hash = '#/fixes?view=log'
    const { source } = fakeSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Fixes' })
    const rows = within(grid).getAllByRole('button', { name: 'Actions for Fix 2' })
    fireEvent.click(rows[0] as HTMLElement)
    fireEvent.click(await view.findByRole('menuitem', { name: 'Open the fix on its page' }))
    await waitFor(() => expect(window.location.hash).toBe('#/pages/page-1/progress?filter=fix%3A2'))
  })

  it('runs the follow-up only after the cost is confirmed', async () => {
    window.location.hash = '#/fixes?view=log'
    const { source, calls } = fakeSource()
    const view = render(<FixesScreen projectId="proj-1" source={source} />)
    const grid = await view.findByRole('grid', { name: 'Fixes' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Fix 2' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Run follow-up now…' }))
    const confirm = view.getByRole('group', { name: 'Run the follow-up for Fix 2?' })
    expect(confirm.textContent).toContain('Checks 2 targeted questions in 1 market now')
    expect(confirm.textContent).toContain('Uses about 2–4 searches.')
    expect(calls.runs).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: 'Run follow-up' }))
    await waitFor(() => expect(calls.runs).toEqual([{ projectId: 'proj-1', fixId: 'fix-2' }]))
    expect(await view.findByText('The follow-up check for Fix 2 started.')).toBeTruthy()
    expect(view.getByRole('link', { name: 'See it run' }).getAttribute('href')).toBe(
      '#/pages/page-1/running'
    )
    await waitFor(() => expect(view.queryByRole('group', { name: /Run the follow-up/ })).toBeNull())
    // Reloaded: nothing is open any more.
    await waitFor(() =>
      expect(view.getByText(/3 fixes across your pages and topics, 0 open/)).toBeTruthy()
    )
  })

  it('deletes a fix at once, and Undo puts it back', async () => {
    window.location.hash = '#/fixes?view=log'
    const { source, calls } = fakeSource()
    const view = render(
      <>
        <FixesScreen projectId="proj-1" source={source} />
        <UndoToastHost />
      </>
    )
    const grid = await view.findByRole('grid', { name: 'Fixes' })
    fireEvent.click(within(grid).getByRole('button', { name: 'Actions for Fix 2' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(calls.deletes).toEqual([{ projectId: 'proj-1', fixId: 'fix-2' }]))
    await waitFor(() => expect(within(grid).queryByText('Fix 2')).toBeNull())
    const toast = await view.findByText('Deleted Fix 2.')
    fireEvent.click(
      within(toast.closest('[role="status"]') as HTMLElement).getByRole('button', { name: 'Undo' })
    )
    await waitFor(() => expect(calls.restores).toEqual([{ projectId: 'proj-1', fixId: 'fix-2' }]))
    expect(await within(grid).findByText('Fix 2')).toBeTruthy()
  })

  it('a content gap opens its row on Content gaps or plans a fix from it', async () => {
    window.location.hash = '#/fixes?view=log'
    const { source } = fakeSource(list([]))
    const view = render(<FixesScreen projectId="proj-1" source={source} />)
    expect(await view.findByText('No fixes logged yet.')).toBeTruthy()
    const gaps = view.getByRole('grid', { name: 'Content gaps not fixed yet' })
    fireEvent.click(within(gaps).getByRole('button', { name: 'Actions for Q7' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Log as a fix' }))
    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/fixes?view=log&drawer=fix&fix=new&fix.page=page-1&fix.prompts=p7&fix.from=row-1'
      )
    )
    window.location.hash = '#/fixes?view=log'
    fireEvent.click(within(gaps).getByRole('button', { name: 'Actions for Q7' }))
    fireEvent.click(await view.findByRole('menuitem', { name: 'Open in Content gaps' }))
    await waitFor(() => expect(window.location.hash).toBe('#/pages/page-1/gaps?filter=row%3Ap7'))
  })
})
