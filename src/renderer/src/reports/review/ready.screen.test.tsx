// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MetricsRequest, ReportDownloadRequest } from '@shared/ipc'
import { buildReport } from '@shared/report/review'
import { sampleContext, sampleMetrics } from '@shared/report/review/sample.test-helper'
import { resetDrawersForTests } from '../../shell/drawers'
import { createMockSchedulesClient } from '../schedulesMock'
import { ReportsScreen } from '../ReportsScreen'
import type { ReviewClient } from './client'
import { GoalsView } from './GoalsView'
import type { CardEnv } from './HomeCard'
import type { ReviewProject } from './ReviewView'

/**
 * The short ready reports in the app: Pitch / audit, Content plan and Head-to-head open
 * from the URL with their tabs, numbers open drawers, the rival is picked in the header
 * and goes with the download, and the pitch goal's words follow the branding mode.
 */

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetDrawersForTests()
})

const PROJECT: ReviewProject = {
  id: 'proj-1',
  name: 'TextBolt',
  domain: 'textbolt.com',
  brand: 'TextBolt',
  defaultMarket: null,
  markets: []
}

function fakeClient(): {
  client: ReviewClient
  asked: MetricsRequest[]
  saved: ReportDownloadRequest[]
} {
  const asked: MetricsRequest[] = []
  const saved: ReportDownloadRequest[] = []
  return {
    asked,
    saved,
    client: {
      metrics: async (request) => {
        asked.push(request)
        return sampleMetrics({ engine: 'all', from: request.from === null ? null : undefined })
      },
      download: async (request) => {
        saved.push(request)
        return { ok: true, filePath: '/tmp/x.html', filename: 'x.html', bytes: 10 }
      }
    }
  }
}

function screen(client: ReviewClient): ReturnType<typeof render> {
  return render(
    <ReportsScreen
      client={createMockSchedulesClient()}
      timeZone="America/Chicago"
      reviewClient={client}
      project={PROJECT}
      pages={[]}
    />
  )
}

function tabNames(view: ReturnType<typeof render>): string[] {
  return within(view.getByRole('tablist', { name: 'Report sections' }))
    .getAllByRole('tab')
    .map((tab) => tab.textContent ?? '')
}

describe('Pitch / audit', () => {
  it('reads the latest check: summary tiles, and a plan whose numbers open drawers', async () => {
    window.location.hash = '#/?report=pitch'
    const { client, asked } = fakeClient()
    const view = screen(client)
    await view.findByText('The opportunity')
    expect(asked.at(-1)).toMatchObject({ from: null })
    expect(tabNames(view)).toEqual(['Summary', 'Competitors', 'Plan', 'How we measured'])
    expect(view.queryByRole('combobox', { name: /From/ })).toBeNull()
    expect(view.getByText('Answer without you')).toBeTruthy()
    window.location.hash = '#/?report=pitch&section=plan'
    const plan = await view.findByRole('region', { name: 'What we’d fix first' })
    const steps = plan.querySelectorAll('li')
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.length).toBeLessThanOrEqual(5)
    fireEvent.click(plan.querySelector('[data-rd]') as HTMLElement)
    await waitFor(() => expect(window.location.hash).toContain('drawer=report-drill'))
  })
})

describe('Content plan', () => {
  it('lists questions to win with a page, a Copy brief button and a CSV', async () => {
    window.location.hash = '#/?report=content'
    const { client, saved } = fakeClient()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const view = screen(client)
    await view.findAllByRole('button', { name: 'Copy brief' })
    expect(tabNames(view)).toEqual(['Plan', 'Topics', 'Answer shape', 'Sources', 'How we measured'])
    expect(view.getAllByText('New page').length).toBeGreaterThan(0)
    fireEvent.click(view.getAllByRole('button', { name: 'Copy brief' })[0] as HTMLElement)
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('Question: ')
    await view.findByRole('button', { name: 'Copied' })
    fireEvent.click(view.getByRole('button', { name: 'Download CSV' }))
    await waitFor(() =>
      expect(saved.at(-1)).toMatchObject({ report: 'content', format: 'csv', table: 'contentplan' })
    )
  })
})

describe('Head-to-head', () => {
  it('takes the rival from the URL, picks another in the header, and downloads it', async () => {
    window.location.hash = '#/?report=rival&rival=twilio.com'
    const { client, saved } = fakeClient()
    const view = screen(client)
    const picker = (await view.findByRole('combobox', { name: 'Rival' })) as HTMLSelectElement
    expect(picker.value).toBe('twilio.com')
    expect([...picker.options].map((option) => option.value)).not.toContain('reddit.com')
    expect(tabNames(view)).toEqual(['Head-to-head', 'Questions', 'How we measured'])
    expect(view.getByText('Only twilio.com: the gap')).toBeTruthy()
    expect(view.getByRole('table', { name: 'Head-to-head' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Print / PDF' }))
    await waitFor(() =>
      expect(saved.at(-1)).toMatchObject({ report: 'rival', format: 'pdf', rival: 'twilio.com' })
    )
    const other = [...picker.options].find((option) => option.value !== 'twilio.com')
    if (other) {
      fireEvent.change(picker, { target: { value: other.value } })
      await waitFor(() => expect(window.location.hash).toContain(`rival=${other.value}`))
    }
  })
})

describe('Reports home', () => {
  const metrics = sampleMetrics({ from: null })
  const report = buildReport(metrics, sampleContext('impact'))
  const env = (asked: unknown[]): CardEnv => ({
    client: fakeClient().client,
    requestFor: (kind) => {
      const request = {
        projectId: 'p',
        scope: { kind: 'project' as const },
        marketId: null,
        engine: 'all' as const,
        from: null,
        to: null
      }
      asked.push(kind)
      return request
    },
    onSchedule: () => undefined
  })

  it('the pitch goal follows the branding mode', () => {
    for (const [mode, title] of [
      ['agency', 'Pitch a new client'],
      ['company', 'Brief your leadership'],
      ['none', 'One-page audit']
    ] as const) {
      const view = render(
        <GoalsView
          report={report}
          metrics={metrics}
          onOpen={() => undefined}
          env={env([])}
          mode={mode}
        />
      )
      expect(view.getByRole('region', { name: title })).toBeTruthy()
      cleanup()
    }
  })

  it('goal cards open the new reports; the rival card opens its rival', () => {
    const opened: unknown[] = []
    const view = render(
      <GoalsView
        report={report}
        metrics={metrics}
        onOpen={(kind, extra) => opened.push([kind, extra])}
        env={env([])}
      />
    )
    for (const name of [
      'Pitch a new client',
      'What should we write next?',
      'Us vs one competitor'
    ]) {
      fireEvent.click(
        within(view.getByRole('region', { name })).getByRole('button', { name: 'Open' })
      )
    }
    const rival = (view.getByRole('combobox', { name: 'Competitor' }) as HTMLSelectElement).value
    expect(opened).toEqual([
      ['pitch', undefined],
      ['content', undefined],
      ['rival', { rival }]
    ])
  })
})
