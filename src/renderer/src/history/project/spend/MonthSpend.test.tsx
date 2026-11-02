// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiKeyMetadata, ProjectSchedule } from '@shared/domain'
import type { EngineEstimate, EngineSpendView } from '@shared/ipc'
import { axeViolations } from '../../../ui/axe.test-helper'
import { ProjectHistoryScreen } from '..'
import { check, fakeSource, history } from '../ProjectHistory.fixtures'
import type { MonthSpendSource } from './source'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const SPEND: EngineSpendView = {
  projectId: 'proj-1',
  month: '2026-10',
  total: { checks: 3, searches: 60, credits: 140, costMicros: 710_000 },
  byEngine: [
    {
      engine: 'google_aio',
      label: 'Google AI Overview',
      searches: 40,
      credits: 70,
      costMicros: 656_000
    },
    { engine: 'chatgpt', label: 'ChatGPT', searches: 10, credits: 70, costMicros: 54_000 }
  ],
  checks: [],
  account: [
    { provider: 'cloro', searches: 20, credits: 140 },
    { provider: 'serpapi', searches: 40, credits: 0 }
  ]
}

function key(patch: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'k',
    provider: 'serpapi',
    name: 'Key',
    keychainRef: 'ref',
    hint: 'ab12',
    rotationOrder: 0,
    cap: null,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    ...patch
  }
}

const KEYS = [
  key({
    id: 'cl',
    provider: 'cloro',
    cloroCredits: { remaining: 1_230, perCycle: null, resetsAt: null }
  }),
  key({ id: 'sp', serpapiUsage: { used: 40, planLimit: 250, plan: 'Free' } })
]

function spendSource(): MonthSpendSource {
  return {
    'engines:spend': vi.fn(async () => SPEND),
    'keys:list': async () => KEYS,
    'schedule:getProject': async () =>
      ({ nextCheckAt: '2026-10-31T09:00:00.000Z' }) as unknown as ProjectSchedule,
    'engines:estimate': async () =>
      ({ perCheck: { searches: 80, credits: 560, costMicros: 448_000 } }) as EngineEstimate
  }
}

describe('Check history: what each check cost', () => {
  it('shows credits and cost per check, and the month by provider and engine', async () => {
    // Credits and Cost wait in the Columns menu (audit #10); this link shows them.
    window.location.hash = '#/history?cols=credits,cost'
    const checks = [
      check({
        runId: 'run-cloro',
        startedAt: '2026-10-24T10:12:00.000Z',
        credits: 140,
        costMicros: 110_000,
        provider: 'cloro',
        engines: ['google_aio', 'chatgpt']
      }),
      check({ runId: 'run-serp', costMicros: 300_000, provider: 'serpapi', searchesUsed: 20 })
    ]
    const { source } = fakeSource(history(checks))
    const view = render(
      <ProjectHistoryScreen projectId="proj-1" source={source} spendSource={spendSource()} />
    )
    const grid = await view.findByRole('treegrid', { name: 'Check history' })
    const rows = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"][data-row]'))
    expect(rows[0]?.textContent).toContain('140')
    expect(rows[0]?.textContent).toContain('$0.11')
    // A check that used searches, not credits: a faint dash, never the provider's name.
    expect(rows[1]?.textContent).not.toMatch(/SerpApi|cloro/)
    expect(within(rows[1] as HTMLElement).getByTitle('It used searches, not credits.')).toBeTruthy()
    expect(rows[1]?.textContent).toContain('$0.30')
    expect(within(rows[1] as HTMLElement).getByTitle(/for 20 searches/)).toBeTruthy()

    const box = await view.findByRole('region', { name: 'This month' })
    await within(box).findByText('Search credits used')
    expect(box.textContent).toContain('1,230 left')
    expect(box.textContent).toContain('210 left')
    expect(box.textContent).toContain('$0.71')
    expect(box.textContent).toContain('Oct 31')
    expect(box.textContent).toContain('≈ 560 credits')
    const engines = within(box).getByRole('list', { name: /spend by engine/ })
    expect(
      within(engines)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['Google AI Overview70 credits$0.66', 'ChatGPT70 credits$0.05'])
    expect(await axeViolations(box)).toEqual([])
  })

  it('leaves the box out with no bridge, and says so when the spend cannot load', async () => {
    window.location.hash = '#/history'
    const { source } = fakeSource()
    const failing = spendSource()
    failing['engines:spend'] = async () => {
      throw new Error('engines:spend: Project database is locked')
    }
    const view = render(
      <ProjectHistoryScreen projectId="proj-1" source={source} spendSource={failing} />
    )
    const box = await view.findByRole('region', { name: 'This month' })
    expect((await within(box).findByRole('alert')).textContent).toContain('locked')
    cleanup()
    const plain = render(<ProjectHistoryScreen projectId="proj-1" source={source} />)
    await plain.findByRole('treegrid', { name: 'Check history' })
    expect(plain.queryByRole('region', { name: 'This month' })).toBeNull()
  })
})
