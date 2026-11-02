// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MetricsRequest } from '@shared/ipc'
import {
  buildReport,
  EMPTY_EXTRAS,
  REPORT_KINDS,
  REPORT_SECTIONS,
  type ReportExtras
} from '@shared/report/review'
import { sampleContext, sampleMetrics } from '@shared/report/review/sample.test-helper'
import { answerExtras } from '@shared/report/review/sources.test-helper'
import { resetDrawersForTests } from '../../shell/drawers'
import { createMockSchedulesClient } from '../schedulesMock'
import { ReportsScreen } from '../ReportsScreen'
import type { ReviewClient } from './client'
import { openReportDetail, openReportDrill, pageDetail, questionDetail, siteDetail } from './drill'
import type { ReviewProject } from './ReviewView'

/**
 * The owner's copy/open rule (Docs/REPORT-SPEC.md "Copy and open"): no Reports screen
 * shows a bare web address or a `/path` without Copy (and Open). Renders every section
 * of every report kind, and the drawers, from the sample data, and fails on any text
 * that looks like an address outside UrlText / CopyText.
 */

afterEach(() => {
  cleanup()
  window.location.hash = ''
  resetDrawersForTests()
})

const SITE = 'https://textbolt.com'

const PROJECT: ReviewProject = {
  id: 'proj-1',
  name: 'TextBolt',
  domain: 'textbolt.com',
  brand: 'TextBolt',
  defaultMarket: {
    id: 'us',
    country: 'US',
    language: 'en',
    location: null,
    device: 'desktop',
    localWording: false,
    serpapiLocation: null
  },
  markets: []
}

const EXTRAS: ReportExtras = {
  ...EMPTY_EXTRAS,
  backlinks: [
    {
      url: `${SITE}/textbolt-for-schools`,
      title: 'TextBolt for schools',
      priority: 'first',
      reason: 'Not indexed',
      anchor: 'TextBolt for schools',
      anchorSaved: false,
      daysLive: 5
    }
  ],
  changes: {
    [`${SITE}/features`]: {
      url: `${SITE}/features`,
      changedAt: '2026-10-06T00:00:00.000Z',
      sectionsAdded: 0,
      sectionsRemoved: 1,
      headingsChanged: 0,
      textChanged: 1,
      sections: ['Pricing table'],
      wordsBefore: 1200,
      wordsAfter: 900
    }
  },
  answers: answerExtras(),
  questionTargets: { q1: [`${SITE}/email-to-sms-outlook`] }
}

function client(): ReviewClient {
  const read = (request: MetricsRequest): ReturnType<typeof sampleMetrics> =>
    sampleMetrics({
      engine:
        request.engine === 'chatgpt' || request.engine === 'google_aio' ? request.engine : 'all',
      from: request.from === null ? null : undefined
    })
  return {
    metrics: async (request) => read(request),
    review: async (request) => ({ metrics: read(request), extras: EXTRAS }),
    download: async () => ({ ok: false, reason: 'not in tests', nextStep: null })
  }
}

const SKIP = '.ui-url, .sr-only, option, th, pre, script, style, svg, [aria-hidden="true"]'
const ADDRESS = /https?:\/\/|^\/[\w\-.%][\w\-./%]*$/i

/** Text that reads as a web address or a site path, with no Copy control around it. */
export function bareAddresses(root: Element): string[] {
  const found: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim()
    if (text === '' || !ADDRESS.test(text)) continue
    const parent = node.parentElement
    if (parent === null || parent.closest(SKIP) !== null) continue
    found.push(text)
  }
  return found
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await waitFor(() => expect(document.body.textContent).not.toContain('Loading the report'))
}

function screen(): ReturnType<typeof render> {
  return render(
    <ReportsScreen
      client={createMockSchedulesClient()}
      timeZone="America/Chicago"
      reviewClient={client()}
      project={PROJECT}
      pages={[]}
    />
  )
}

describe('Reports › copy and open on every address', () => {
  for (const kind of REPORT_KINDS) {
    it(`${kind}: every section shows addresses with Copy and Open`, async () => {
      window.location.hash = `#/?report=${kind}`
      screen()
      await settle()
      const misses: string[] = []
      let controls = 0
      for (const section of REPORT_SECTIONS[kind]) {
        await act(async () => {
          window.location.hash = `#/?report=${kind}&section=${section}`
          window.dispatchEvent(new HashChangeEvent('hashchange'))
        })
        await settle()
        for (const text of bareAddresses(document.body)) misses.push(`${section}: ${text}`)
        controls += document.querySelectorAll('.ui-url .ui-url-copy').length
      }
      expect(misses).toEqual([])
      // The rule's controls are really there, so the check above scanned real sections.
      expect(controls).toBeGreaterThan(3)
    })
  }

  it('drawers: a number, a question, a page and a site', async () => {
    const report = buildReport(sampleMetrics(), sampleContext(), EXTRAS)
    window.location.hash = '#/?report=impact'
    screen()
    await settle()
    const question = report.questions.rows[0]?.id ?? ''
    const page = report.published.rows[0]?.url ?? `${SITE}/features`
    const steps: [string, () => void][] = [
      ['drill', () => openReportDrill('cite:a')],
      ['question', () => openReportDetail(questionDetail(question))],
      ['page', () => openReportDetail(pageDetail(page))],
      ['site', () => openReportDetail(siteDetail('twilio.com'))]
    ]
    const misses: string[] = []
    for (const [name, open] of steps) {
      await act(async () => open())
      await settle()
      for (const text of bareAddresses(document.body)) misses.push(`${name}: ${text}`)
      resetDrawersForTests()
    }
    expect(misses).toEqual([])
  })
})
