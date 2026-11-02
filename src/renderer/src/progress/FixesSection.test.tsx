// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import axe from 'axe-core'
import type { JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { FixList, FixPlanPreview, LoggedFix, Market, PromptSetView } from '@shared/domain'
import type { CreateFixRequest } from '@shared/ipc'
import type { FixesSource } from './client'
import { closeDrawer } from '../shell/drawers'
import { FixesSection } from './FixesSection'
import { fix, outcome } from './fixtures'
import { useFixes } from './useFixes'

const PAGE_RULES = {
  rules: {
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    'landmark-one-main': { enabled: false },
    region: { enabled: false }
  }
}

const NOW = new Date('2026-10-20T12:00:00.000Z')
const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}
const UK: Market = { ...US, id: 'mkt-uk', country: 'UK' }

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('Fixes and what happened (FR-14.5 to FR-14.7)', () => {
  it('shows each fix with its verdict, the per-prompt table and the comparison line', async () => {
    const planned = fix({
      id: 'fix-2',
      number: 2,
      description: 'Add a **Verizon** FAQ',
      status: 'planned',
      goLiveAt: '2026-10-21T12:00:00.000Z',
      followUpAt: '2026-10-24T12:00:00.000Z',
      promptIds: ['p4', 'p5'],
      verdict: null,
      markets: [outcome({ verdict: 'waiting', afterAt: null, afterRunId: null, compared: 0 })]
    })
    const view = renderSection(fakeSource({ fixes: [fix(), planned] }))
    // The grid lists both fixes; the newest one's detail shows under it.
    const grid = await view.findByRole('grid', { name: 'Logged fixes' })
    expect(within(grid).getByText('Fix 1')).toBeTruthy()
    expect(within(grid).getByText('Fix 2')).toBeTruthy()
    const second = view.getByRole('article', { name: /Fix 2 · Add a \*\*Verizon\*\* FAQ/ })
    expect(within(second).getByText('Verizon').tagName).toBe('STRONG')
    expect(within(second).getByText(/follow-up check planned for Oct 24/)).toBeTruthy()
    expect(within(second).getByRole('button', { name: 'Run follow-up now' })).toBeTruthy()

    fireEvent.click(within(grid).getByText('Fix 1'))
    const first = await view.findByRole('article', { name: /Fix 1 · Added 5 FAQs/ })
    expect(first.id).toBe('fix-1')
    expect(first.textContent).toContain('Partly worked · 1 of 3 questions')
    expect(first.textContent).toContain(
      'Live Oct 8 · targets questions 4, 6 and 9 · checked Oct 19, 11 days later · 🇺🇸 US · EN'
    )
    expect(within(first).getByRole('columnheader', { name: 'Before · Oct 5' })).toBeTruthy()
    const worked = within(first).getByRole('link', { name: /^Worked: question 6/ })
    expect(worked.getAttribute('href')).toContain('/prompt/p6?market=mkt-us&run=')
    expect(first.textContent).toContain('3 of the 7 questions you didn’t target also moved')
    expect(view.queryByRole('article', { name: /Fix 2/ })).toBeNull()

    const filters = view.getByRole('group', { name: 'Show fixes by result' })
    fireEvent.click(within(filters).getByRole('button', { name: /^Got worse/ }))
    expect(view.getByText('Showing 1 of 5 targeted questions · Got worse')).toBeTruthy()
    expect(within(grid).queryByText('Fix 2')).toBeNull()
    const rows = within(view.getByRole('article', { name: /Fix 1/ })).getAllByRole('row')
    expect(rows).toHaveLength(2)
    fireEvent.click(within(filters).getByRole('button', { name: /^Planned/ }))
    expect(view.queryByRole('article', { name: /Fix 1/ })).toBeNull()
    expect(view.getByRole('article', { name: /Fix 2/ })).toBeTruthy()

    const results = await axe.run(view.container, PAGE_RULES)
    expect(results.violations).toEqual([])
  })

  it('Log a fix opens the fix drawer on this page, and picks the fix it saves', async () => {
    window.location.hash = '#/pages/page-1/progress?view=fixes'
    const source = fakeSource({ fixes: [] })
    const view = renderSection(source)
    expect(await view.findByText('No fixes logged yet.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Log a fix' }))
    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/pages/page-1/progress?view=fixes&drawer=fix&fix=new&fix.page=page-1'
      )
    )
    // The drawer is window-wide (shell/DrawerHost); its save closes it with the new id.
    await source['fixes:create']({
      projectId: 'proj-1',
      pageId: 'page-1',
      description: 'Added a pricing FAQ.',
      goLiveAt: '2026-10-21T00:00:00.000Z',
      rule: 'after_7_days',
      promptIds: ['prompt-2'],
      marketIds: ['mkt-us']
    })
    closeDrawer(0, 'fix-new')
    expect(await view.findByText('Saved Fix 3 · follow-up check Oct 28')).toBeTruthy()
    expect(view.getByRole('article', { name: /Fix 3/ })).toBeTruthy()
  })

  it('runs a follow-up now and opens the Checking screen, or says why it could not', async () => {
    const planned = fix({
      status: 'planned',
      verdict: null,
      markets: [outcome({ verdict: 'waiting' })]
    })
    const source = fakeSource({ fixes: [planned] })
    const view = renderSection(source)
    fireEvent.click(await view.findByRole('button', { name: 'Run follow-up now' }))
    await waitFor(() => {
      expect(window.location.hash).toBe('#/pages/page-1/running')
    })
    expect(source.runs).toEqual(['fix-1'])

    source.failRun = true
    window.location.hash = ''
    fireEvent.click(view.getByRole('button', { name: 'Run follow-up now' }))
    expect((await view.findByRole('alert')).textContent).toBe('Add a search key first.')
    expect(window.location.hash).toBe('')
  })

  it('deletes a planned fix after a confirm', async () => {
    const planned = fix({
      status: 'planned',
      verdict: null,
      markets: [outcome({ verdict: 'waiting' })]
    })
    const source = fakeSource({ fixes: [planned] })
    const view = renderSection(source)
    fireEvent.click(await view.findByRole('button', { name: 'Delete' }))
    fireEvent.click(view.getByRole('button', { name: 'Delete fix' }))
    expect(await view.findByText('Fix 1 deleted.')).toBeTruthy()
    expect(view.getByText('No fixes logged yet.')).toBeTruthy()
  })
})

interface FakeSource extends FixesSource {
  created: CreateFixRequest[]
  runs: string[]
  failRun: boolean
}

function fakeSource(initial: { fixes: readonly LoggedFix[] }): FakeSource {
  let list: FixList = { pageId: 'page-1', fixes: initial.fixes, nextFixNumber: 3 }
  const source: FakeSource = {
    created: [],
    runs: [],
    failRun: false,
    'fixes:list': () => Promise.resolve(list),
    'fixes:preview': (request) =>
      Promise.resolve(
        preview(request.goLiveAt, request.promptIds.length * request.marketIds.length)
      ),
    'fixes:create': (request) => {
      source.created.push(request)
      const created = fix({
        id: 'fix-new',
        number: 3,
        description: request.description,
        status: 'planned',
        followUpAt: '2026-10-28T12:00:00.000Z',
        markets: [outcome({ verdict: 'waiting' })]
      })
      list = { ...list, fixes: [...list.fixes, created], nextFixNumber: 4 }
      return Promise.resolve(created)
    },
    'fixes:runFollowUp': (request) => {
      if (source.failRun) {
        return Promise.reject(
          new Error(
            "Error invoking remote method 'fixes:runFollowUp': Error: fixes:runFollowUp: Add a search key first."
          )
        )
      }
      source.runs.push(request.fixId)
      const current = list.fixes.find((item) => item.id === request.fixId) ?? fix()
      return Promise.resolve({ fix: { ...current, status: 'started' }, jobId: 'job-9' })
    },
    'fixes:delete': (request) => {
      list = { ...list, fixes: list.fixes.filter((item) => item.id !== request.fixId) }
      return Promise.resolve(list)
    },
    'prompts:list': () => Promise.resolve(promptView())
  }
  return source
}

function preview(goLiveAt: string, units: number): FixPlanPreview {
  const day = 86_400_000
  return {
    nextFixNumber: 3,
    samples: 1,
    searchesMin: units,
    searchesMax: units * 2,
    followUpAt: {
      after_3_days: new Date(Date.parse(goLiveAt) + 3 * day + 12 * 3_600_000).toISOString(),
      after_7_days: new Date(Date.parse(goLiveAt) + 7 * day + 12 * 3_600_000).toISOString(),
      next_scheduled: '2026-11-02T12:00:00.000Z'
    }
  }
}

function promptView(): PromptSetView {
  const prompt = (
    id: string,
    position: number,
    label: string,
    enabled = true
  ): PromptSetView['prompts'][number] => ({
    id,
    position,
    label,
    source: 'title_meta_h1' as const,
    intentStage: 'problem' as const,
    mappedElement: 'intro',
    enabled,
    variants: [{ marketId: 'mkt-us', language: 'en', text: `${label}?`, originalText: null }]
  })
  return {
    pageId: 'page-1',
    promptSetId: 'pset-1',
    version: 1,
    savedAt: '2026-10-05T12:00:00.000Z',
    icpId: 'icp-1',
    templateId: null,
    templateName: null,
    templateHash: null,
    templateUpdatedAt: null,
    dirty: false,
    nextVersion: null,
    prompts: [
      prompt('prompt-1', 1, 'Crew alerts'),
      prompt('prompt-2', 2, 'Scheduled plan'),
      prompt('prompt-3', 3, 'Disabled one', false)
    ],
    brandsClear: true,
    brandMessage: 'No question names TextBolt.',
    nextCheck: { prompts: 2, markets: 2, samples: 1, minSearches: 4, maxSearches: 8 }
  }
}

function renderSection(source: FixesSource): ReturnType<typeof render> {
  function Harness(): JSX.Element {
    const state = useFixes(source, 'proj-1', 'page-1')
    return (
      <FixesSection
        source={source}
        state={state}
        projectId="proj-1"
        pageId="page-1"
        marketId="mkt-us"
        markets={[US, UK]}
        now={NOW}
      />
    )
  }
  return render(<Harness />)
}
