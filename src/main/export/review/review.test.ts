import type { CheckProgress, ReportDownloadRequest } from '@shared/ipc'
import type { PromptCheckStatus } from '@shared/domain'
import { buildReport, reportFigures } from '@shared/report/review'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, page, seed, snapshot } from '../../engine/checks/checks.test-helper'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult,
  type NewAioReference
} from '../../storage/check-records'
import { insertEngineAnswer } from '../../storage/engine-records'
import { createFixFollowUp } from '../../storage/fix-follow-ups'
import { getProject } from '../../storage/records'
import { CLIENT_SCRIPT } from '../html/client/app'
import { buildReviewDownload, dayIn, reviewCsv, reviewHtml } from './index'
import { parseDownloadRequest } from './download'

/**
 * The downloaded ready reports read `reports:metrics` with the app's request, so the file
 * and the app show the same numbers (seeded project, no searches), and no cell prints an
 * object, "undefined" or "NaN".
 */

type Seeded = Awaited<ReturnType<typeof seed>>
type Db = Seeded['projectDb']

const PAGE_URL = page().url ?? ''
const SECOND_URL = 'https://textbolt.com/blog/second-page/'
const NOW = new Date('2026-10-30T12:00:00.000Z')
const ZONE = 'America/Toronto'

afterEach(() => closeSeeds())

function ref(
  id: string,
  position: number,
  url: string,
  classification: NewAioReference['classification']
): NewAioReference {
  return {
    id,
    position,
    url,
    normalizedUrl: url,
    domain: new URL(url).hostname,
    title: null,
    classification,
    untracked: false,
    sourceType: 'web'
  }
}

type Answer = readonly [string, PromptCheckStatus, readonly NewAioReference[]]

function plantRun(
  db: Db,
  id: string,
  pageId: string,
  at: string,
  answers: readonly Answer[]
): void {
  insertStoredCheckJob(db, {
    id: `job-${id}`,
    startedAt: at,
    status: 'running',
    pageIds: [pageId],
    marketIds: ['mkt-us'],
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  insertStoredRun(db, {
    id,
    jobId: `job-${id}`,
    pageId,
    promptSetId: pageId === 'page-1' ? 'pset-1' : 'pset-2',
    snapshotId: pageId === 'page-1' ? 'snap-1' : 'snap-2',
    marketId: 'mkt-us',
    startedAt: at,
    kind: 'manual',
    partial: false,
    samples: 1,
    contentHash: snapshot().contentHash
  })
  finishStoredRun(db, id, at, 'finished')
  for (const [promptId, status, refs] of answers) {
    const own = refs.find((item) => item.classification === 'target')
    insertStoredSerpResult(db, {
      id: `serp-${id}-${promptId}`,
      runId: id,
      promptId,
      sampleNo: 1,
      keyId: null,
      hasAio: status !== 'no_aio',
      neededFollowup: false,
      searches: 1,
      status,
      named: status === 'no_aio' ? null : promptId === 'prompt-1',
      citedUrl: own?.url ?? null,
      position: own?.position ?? null,
      aioText: status === 'no_aio' ? null : 'An overview.',
      errorCode: null,
      message: null,
      nextStep: null,
      rawSearchJson: '{}',
      rawAioJson: null,
      references: refs
    })
  }
}

const REDDIT = 'https://www.reddit.com/r/x/'
const TWILIO = 'https://www.twilio.com/sms/'

function plant(db: Db): void {
  plantRun(db, 'run-1', 'page-1', '2026-09-16T15:00:00.000Z', [
    ['prompt-1', 'not_cited', [ref('a1', 1, REDDIT, 'other')]],
    [
      'prompt-2',
      'page_cited',
      [ref('a2', 1, PAGE_URL, 'target'), ref('a3', 2, TWILIO, 'competitor')]
    ]
  ])
  plantRun(db, 'run-2', 'page-2', '2026-09-16T15:10:00.000Z', [['prompt-2b', 'no_aio', []]])
  plantRun(db, 'run-3', 'page-1', '2026-10-28T15:00:00.000Z', [
    ['prompt-1', 'page_cited', [ref('b1', 1, PAGE_URL, 'target'), ref('b2', 2, REDDIT, 'other')]],
    ['prompt-2', 'not_cited', [ref('b3', 1, TWILIO, 'competitor')]]
  ])
  plantRun(db, 'run-4', 'page-2', '2026-10-28T15:10:00.000Z', [
    [
      'prompt-2b',
      'other_own_page',
      [ref('c1', 1, SECOND_URL, 'own'), ref('c2', 2, TWILIO, 'competitor')]
    ]
  ])
  insertEngineAnswer(db, {
    id: 'gpt-1',
    runId: 'run-3',
    promptId: 'prompt-2',
    sampleNo: 1,
    engine: 'chatgpt',
    keyId: null,
    status: 'cited',
    citedUrl: PAGE_URL,
    position: 2,
    named: true,
    answerText: 'An answer',
    answerMarkdown: null,
    errorCode: null,
    message: null,
    searches: 1,
    credits: 1,
    costMicros: 0,
    rawJson: null,
    checkedAt: '2026-10-28T15:00:00.000Z',
    sources: [
      {
        id: 'gpt-s1',
        position: 2,
        url: PAGE_URL,
        normalizedUrl: PAGE_URL,
        domain: new URL(PAGE_URL).hostname,
        title: null,
        classification: 'target'
      }
    ]
  })
  createFixFollowUp(db, {
    id: 'fix-1',
    pageId: 'page-1',
    description: 'Rewrite the intro',
    goLiveAt: '2026-10-01T00:00:00.000Z',
    rule: 'after_7_days',
    promptIds: ['prompt-1'],
    marketIds: ['mkt-us']
  })
}

const REQUEST: ReportDownloadRequest = {
  projectId: 'proj-1',
  scope: { kind: 'project' },
  marketId: null,
  engine: 'all',
  from: 'first',
  to: null,
  report: 'impact',
  format: 'html',
  table: null,
  timeZone: ZONE
}

async function seeded(): Promise<Seeded> {
  const project = await seed({
    progress: [] as CheckProgress[],
    secondPrompt: true,
    secondPage: true,
    http() {
      throw new Error('Reports must not search')
    }
  })
  plant(project.projectDb)
  return project
}

function record(project: Seeded): NonNullable<ReturnType<typeof getProject>> {
  const found = getProject(project.storage.db, 'proj-1')
  if (found === null) throw new Error('no project')
  return found
}

describe('downloaded ready reports', () => {
  test('the app and the downloaded file show identical numbers', async () => {
    const project = await seeded()
    // The app: `reports:review` over IPC, then the shared report model.
    const { metrics, extras } = await project.handlers['reports:review']({
      projectId: 'proj-1',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'all',
      from: 'first',
      to: null
    })
    const ctx = {
      brand: 'TextBolt',
      domain: 'textbolt.com',
      kind: 'impact' as const,
      day: dayIn(ZONE, NOW),
      marketLabel: 'US · EN',
      engineLabel: 'all engines'
    }
    const app = buildReport(metrics, ctx, extras)
    // The download: the same request through `reports:download`'s builder.
    const file = buildReviewDownload(project.projectDb, record(project), REQUEST, NOW)
    expect(reportFigures(file.report)).toEqual(reportFigures(app))
    expect(
      app.verdict.kpis.find((kpi) => kpi.label === 'Questions citing your site')
    ).toMatchObject({ now: '3', before: '1' })
    // One view per engine on offer, beside All engines.
    expect(file.variants.map((variant) => variant.view)).toEqual(['all', 'google_aio', 'chatgpt'])

    // Every drill button in the file shows its list's size, as the app's numbers do.
    const html = reviewHtml(file, NOW, ZONE)
    const data = JSON.parse(
      /<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1] ??
        '{}'
    ) as { drills: Record<string, string[]>; rows: { id: string }[] }
    const buttons = [...html.matchAll(/data-drill="([^"]+)" data-n="(\d+)"/g)]
    expect(buttons.length).toBeGreaterThan(20)
    for (const [, token, n] of buttons) {
      const id = (token ?? '').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      expect(data.drills[id]?.length, id).toBe(Number(n))
      const [view, drill] = [id.slice(0, id.indexOf('|')), id.slice(id.indexOf('|') + 1)]
      const report = file.variants.find((variant) => variant.view === view)?.report
      expect(report?.drills[drill]?.ids.length, id).toBe(Number(n))
    }
    const ids = new Set(data.rows.map((row) => row.id))
    for (const list of Object.values(data.drills))
      for (const id of list) expect(ids.has(id)).toBe(true)
  })

  test('every section, drill and panel step renders text only', async () => {
    const project = await seeded()
    for (const report of ['impact', 'changed', 'visibility'] as const) {
      const file = buildReviewDownload(
        project.projectDb,
        record(project),
        { ...REQUEST, report, from: report === 'visibility' ? null : 'first' },
        NOW
      )
      const html = reviewHtml(file, NOW, ZONE)
      const window = new Window({ url: 'https://report.local/index.html' })
      try {
        window.document.write(html.replace(`<script>${CLIENT_SCRIPT}</script>`, ''))
        window.eval(CLIENT_SCRIPT)
        const bad = /\[object|\bundefined\b|\bNaN\b/
        const main = window.document.getElementById('main')
        expect(bad.test(main?.textContent ?? 'undefined'), report).toBe(false)
        const drawer = window.document.getElementById('drawer')
        const buttons = [...window.document.querySelectorAll('main button.drill[data-drill]')]
        expect(buttons.length, report).toBeGreaterThan(5)
        for (const button of buttons) {
          ;(button as unknown as HTMLButtonElement).click()
          expect(bad.test(drawer?.textContent ?? ''), button.getAttribute('data-drill') ?? '').toBe(
            false
          )
          const step = window.document.querySelector('#drawer-body button[data-open]')
          if (step) {
            ;(step as unknown as HTMLButtonElement).click()
            expect(bad.test(drawer?.textContent ?? '')).toBe(false)
          }
          ;(window.document.getElementById('drawer-close') as unknown as HTMLButtonElement).click()
        }
        // The engine switch shows one engine's numbers at a time.
        const chatgpt = window.document.querySelector(
          '[data-switch="engine"][data-value="chatgpt"]'
        )
        ;(chatgpt as unknown as HTMLButtonElement | null)?.click()
        const shown = [...window.document.querySelectorAll('[data-switch-panel="engine"]')].filter(
          (panel) => !(panel as unknown as HTMLElement).hidden
        )
        expect(shown.every((panel) => panel.getAttribute('data-value') === 'chatgpt')).toBe(true)
      } finally {
        await window.happyDOM.close()
      }
    }
    // It clicks every number in three reports; under a busy test run that takes a while.
  }, 20_000)

  test('one table as CSV, and a bad request is refused', async () => {
    const project = await seeded()
    const file = buildReviewDownload(project.projectDb, record(project), REQUEST, NOW)
    const csv = reviewCsv(file, 'questions')
    expect(csv.startsWith('﻿Question,Topic,Target page,Also OK pages,Funnel,Intent')).toBe(true)
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1 + file.report.questions.rows.length)
    expect(reviewCsv(file, 'competitors')).toContain('twilio.com')
    expect(() => parseDownloadRequest({ ...REQUEST, format: 'csv', table: null })).toThrow()
    expect(() => parseDownloadRequest({ ...REQUEST, report: 'other' })).toThrow()
    expect(parseDownloadRequest({ ...REQUEST, format: 'csv', table: 'topics' }).table).toBe(
      'topics'
    )
  })

  test('the shared parts: Competitors tab, question columns, drawer tabs, engine columns, search', async () => {
    const project = await seeded()
    const file = buildReviewDownload(project.projectDb, record(project), REQUEST, NOW)
    const { competition } = file.report
    expect(competition.tiles).toHaveLength(5)
    const twilio = competition.sites.find((site) => site.domain === 'twilio.com')
    expect(twilio?.positionNow).toBe(1.5)
    expect(twilio?.positionBefore).toBe(2)
    expect(file.report.questions.rows.some((row) => row.targets.length > 0)).toBe(true)
    expect(reviewCsv(file, 'sitekinds').split('\r\n')[0]).toContain('Kind of site')
    expect(reviewCsv(file, 'competitors').split('\r\n')[0]).toContain('Avg position')

    const html = reviewHtml(file, NOW, ZONE)
    for (const words of ['Every cited site', 'Share of voice', 'Who else the AI answers cite']) {
      expect(html).toContain(words)
    }
    expect(html).toContain('Target page')
    expect(html).toContain('Cited through')
    const window = new Window({ url: 'https://report.local/index.html' })
    try {
      window.document.write(html.replace(`<script>${CLIENT_SCRIPT}</script>`, ''))
      window.eval(CLIENT_SCRIPT)
      const doc = window.document
      const body = (): string => doc.getElementById('drawer-body')?.innerHTML ?? ''
      const click = (selector: string): void => {
        const found = doc.querySelector(selector) as unknown as HTMLButtonElement | null
        expect(found, selector).not.toBeNull()
        found?.click()
      }
      // A site's list: You in the same answer, and change tabs with counts.
      click('button.drill[data-drill="all|dom:twilio.com:a"]')
      expect(body()).toContain('You in the same answer')
      expect(body()).toContain('data-dtab="gained"')
      expect(body()).toContain('Named before')
      // Under All engines: one column per engine, with its logo.
      expect(body()).toContain('ChatGPT')
      expect(body()).toMatch(/<img class="rv-logo"/)
      click('#drawer-body [data-dtab="lost"]')
      const rows = [...doc.querySelectorAll('#drawer-body tr[data-row-id]')]
      expect(rows.length).toBeGreaterThan(0)
      for (const tr of rows) {
        const hidden = (tr as unknown as HTMLElement).hidden
        expect(hidden).toBe(tr.getAttribute('data-chg') !== 'lost')
      }
      // A question shows brand named and the cited-through page at each end.
      click('#drawer-body button[data-open^="q:"]')
      expect(body()).toContain('data-testid="q-sides"')
      expect(body()).toContain('Cited through')
      click('#drawer-close')
      // The header search also lists sites and pages.
      const search = doc.getElementById('search') as unknown as HTMLInputElement
      search.value = 'twilio'
      search.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }) as never)
      expect(body()).toContain('data-testid="search-sites"')
    } finally {
      await window.happyDOM.close()
    }
  })
})
