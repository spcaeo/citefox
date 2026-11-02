// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MetricsRequest, MetricsResult } from '@shared/ipc'
import { computeMetrics, type MetricRow } from '@shared/metrics'
import { C2, input, pageRows } from '@shared/metrics/fixtures.test-helper'
import { pluralize } from '@shared/pluralize'
import { buildReport, type ReviewReport } from '@shared/report/review'
import type { OverviewClient } from '../client'
import { OverviewScreen } from '../index'
import { drawerRows, fakeClient, overview } from '../overviewScreen.test-helper'
import { resetBoardMemory } from '../board/store'
import { resetCachedReads } from './useCachedRead'

/**
 * "All engines" means the same on Summary as in Reports (owner option A): a question
 * counts once, cited when any engine cites you. ChatGPT cites two questions Google does
 * not, so All differs from Google AI Overview here.
 */
function rows(): MetricRow[] {
  const google = pageRows()
  const chatgpt = google.map((item): MetricRow => {
    const result =
      item.checkedAt === C2 && item.questionId === 'q4'
        ? 'target'
        : item.checkedAt === C2 && item.questionId === 'q5'
          ? 'other'
          : item.result
    return {
      ...item,
      id: `${item.id}:chatgpt`,
      engine: 'chatgpt',
      result,
      citedUrl: result === 'target' || result === 'other' ? 'https://textbolt.com/x' : null
    }
  })
  return [...google, ...chatgpt]
}

/** `reports:metrics` as the main process answers it: All counted once (the default). */
function metricsFor(request: Pick<MetricsRequest, 'engine' | 'from' | 'to'>): MetricsResult {
  return computeMetrics(
    input(rows(), {
      counting: undefined,
      engine: request.engine,
      window: { from: request.from ?? null, to: request.to ?? null }
    })
  )
}

function client(engines: ('google_aio' | 'chatgpt')[] = ['google_aio', 'chatgpt']): OverviewClient {
  return {
    ...fakeClient(() => overview()).client,
    'engines:summary': async () => ({
      projectId: 'proj-1',
      engines,
      counts: [],
      questions: []
    }),
    'reports:metrics': async (request) => metricsFor(request)
  }
}

/** Reports → Visibility report for the same scope, market and engine. */
function visibility(engine: 'all' | 'google_aio'): ReviewReport {
  const metrics = metricsFor({ engine, from: null, to: null })
  return buildReport(metrics, {
    brand: 'TextBolt',
    domain: 'textbolt.com',
    kind: 'visibility',
    day: (iso) => iso.slice(0, 10),
    marketLabel: 'all markets',
    engineLabel: engine === 'all' ? 'All engines' : 'Google AI Overview'
  })
}

beforeEach(() => {
  window.location.hash = '#/overview'
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetBoardMemory()
  resetCachedReads()
})

async function open(source: OverviewClient = client()): Promise<ReturnType<typeof render>> {
  const view = render(<OverviewScreen projectId="proj-1" client={source} />)
  await view.findByRole('region', { name: 'Headline numbers' })
  return view
}

function widget(view: ReturnType<typeof render>, kind: string): HTMLElement {
  return view.container.querySelector(`[data-kind="${kind}"]`) as HTMLElement
}

describe('Summary under All engines', () => {
  it('shows the Visibility report’s numbers, each drilling to exactly its rows', async () => {
    const view = await open()
    const report = visibility('all')
    const [tracked, answered, cited, named] = report.standing.kpis.map((kpi) => Number(kpi.now))
    // ChatGPT's two extra citations count: All is not Google's number.
    expect(cited).toBe(5)
    expect(visibility('google_aio').standing.kpis[2]?.now).toBe('3')

    const headline = widget(view, 'headline')
    const checks: [number | undefined, string][] = [
      [tracked, 'tracked'],
      [answered, 'with an AI answer'],
      [cited, 'where you’re cited'],
      [named, 'where you’re named']
    ]
    for (const [n, text] of checks) {
      const button = await within(headline).findByRole('button', {
        name: `${pluralize(n ?? 0, 'question')} ${text}`
      })
      fireEvent.click(button)
      const dialog = await view.findByRole('dialog')
      expect(await drawerRows(dialog)).toBe(n)
      fireEvent.keyDown(dialog, { key: 'Escape' })
      await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())
    }
    // Under All the words are an AI answer's, not Google's AI Overview's.
    expect(headline.textContent).toContain('AI answer shows')
    expect(headline.textContent).not.toContain('AI Overview')

    const metrics = metricsFor({ engine: 'all', from: null, to: null })
    const results = widget(view, 'results')
    const bar = await within(results).findByRole('img', { name: /questions on any engine:/ })
    expect(bar.getAttribute('aria-label')).toContain(`${metrics.now.target.n} right page cited`)
    expect(bar.getAttribute('aria-label')).toContain(`${metrics.now.noAnswer.n} no AI answer`)
    expect(results.textContent).not.toContain('AI Overview')

    // Who gets cited: your own row is the same cited count.
    const sites = widget(view, 'cited-sites')
    expect(
      await within(sites).findByRole('button', { name: `textbolt.com: ${cited} questions` })
    ).toBeTruthy()
  })

  it('keeps Google’s own numbers and AI Overview words on Google AI Overview', async () => {
    window.location.hash = '#/overview?engine=google_aio'
    const view = await open()
    const headline = widget(view, 'headline')
    expect(headline.textContent).toContain('AI Overview shows')
    expect(widget(view, 'trend').textContent).toContain('AI Overview')
  })

  it('reads All as Google when the project checks Google only', async () => {
    const view = await open(client(['google_aio']))
    expect(widget(view, 'headline').textContent).toContain('AI Overview shows')
  })
})
