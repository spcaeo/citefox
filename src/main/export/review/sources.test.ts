import type { CheckProgress, ReportDownloadRequest } from '@shared/ipc'
import type { CitationSourceType, PromptCheckStatus } from '@shared/domain'
import { buildReport, type ReviewReport } from '@shared/report/review'
import { afterEach, describe, expect, test } from 'vitest'
import { overviewHash } from '../../analytics/answer-shape/vocabulary'
import { closeSeeds, page, seed, snapshot } from '../../engine/checks/checks.test-helper'
import { saveAnswerShape } from '../../storage/answer-shapes'
import {
  finishStoredRun,
  insertStoredCheckJob,
  insertStoredRun,
  insertStoredSerpResult,
  type NewAioReference
} from '../../storage/check-records'
import { insertEngineAnswer } from '../../storage/engine-records'
import { getProject } from '../../storage/records'
import { buildReviewDownload, dayIn, reviewCsv, reviewHtml } from './index'
import { htmlProblems } from './quality'

/**
 * The Sources and Answer shape tabs read the stored answers of every engine: Google's
 * references and the answer engines' sources, the stored block classifications and the
 * Communities caches. The app (`reports:review`) and the download show the same numbers,
 * the file passes its quality check, and the YouTube, Reddit and LinkedIn tables save
 * as CSV. Nothing is searched.
 */

type Seeded = Awaited<ReturnType<typeof seed>>

const PAGE_URL = page().url ?? ''
const NOW = new Date('2026-10-30T12:00:00.000Z')
const ZONE = 'America/Toronto'
const THREAD = 'https://www.reddit.com/r/sysadmin/comments/abc123/email_to_sms/'
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const LINKEDIN = 'https://www.linkedin.com/pulse/email-sms-guide-someone'
const TWILIO = 'https://www.twilio.com/sms/'
const OVERVIEW = 'Email to SMS sends a text from your inbox. Step 1: pick a gateway.'

afterEach(() => closeSeeds())

function ref(
  id: string,
  position: number,
  url: string,
  classification: NewAioReference['classification'],
  sourceType: CitationSourceType = 'web'
): NewAioReference {
  return {
    id,
    position,
    url,
    normalizedUrl: url,
    domain: new URL(url).hostname,
    title: `Title ${id}`,
    classification,
    untracked: false,
    sourceType
  }
}

function plant(db: Seeded['projectDb'], answers: boolean): void {
  insertStoredCheckJob(db, {
    id: 'job-1',
    startedAt: '2026-10-28T15:00:00.000Z',
    status: 'running',
    pageIds: ['page-1'],
    marketIds: ['mkt-us'],
    promptIds: null,
    reason: 'manual',
    message: null,
    nextStep: null
  })
  insertStoredRun(db, {
    id: 'run-1',
    jobId: 'job-1',
    pageId: 'page-1',
    promptSetId: 'pset-1',
    snapshotId: 'snap-1',
    marketId: 'mkt-us',
    startedAt: '2026-10-28T15:00:00.000Z',
    kind: 'manual',
    partial: false,
    samples: 1,
    contentHash: snapshot().contentHash
  })
  finishStoredRun(db, 'run-1', '2026-10-28T15:00:00.000Z', 'finished')
  const plan: [string, PromptCheckStatus, NewAioReference[]][] = answers
    ? [
        [
          'prompt-1',
          'not_cited',
          [
            ref('a1', 1, THREAD, 'other', 'reddit'),
            ref('a2', 2, VIDEO, 'other', 'youtube'),
            ref('a3', 3, TWILIO, 'competitor')
          ]
        ],
        [
          'prompt-2',
          'page_cited',
          [ref('b1', 1, PAGE_URL, 'target'), ref('b2', 2, LINKEDIN, 'other', 'linkedin')]
        ]
      ]
    : [
        ['prompt-1', 'no_aio', []],
        ['prompt-2', 'no_aio', []]
      ]
  for (const [promptId, status, refs] of plan) {
    const own = refs.find((item) => item.classification === 'target')
    insertStoredSerpResult(db, {
      id: `serp-${promptId}`,
      runId: 'run-1',
      promptId,
      sampleNo: 1,
      keyId: null,
      hasAio: status !== 'no_aio',
      neededFollowup: false,
      searches: 1,
      status,
      named: status === 'no_aio' ? null : false,
      citedUrl: own?.url ?? null,
      position: own?.position ?? null,
      aioText: status === 'no_aio' ? null : promptId === 'prompt-1' ? OVERVIEW : 'Other text.',
      errorCode: null,
      message: null,
      nextStep: null,
      rawSearchJson: '{}',
      rawAioJson: null,
      references: refs
    })
  }
  if (!answers) return
  insertEngineAnswer(db, {
    id: 'gpt-1',
    runId: 'run-1',
    promptId: 'prompt-1',
    sampleNo: 1,
    engine: 'chatgpt',
    keyId: null,
    status: 'not_cited',
    citedUrl: null,
    position: null,
    named: false,
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
        position: 1,
        url: THREAD,
        normalizedUrl: THREAD,
        domain: 'reddit.com',
        title: null,
        classification: 'other'
      }
    ]
  })
  saveAnswerShape(db, {
    overviewHash: overviewHash(OVERVIEW),
    templateHash: 'a'.repeat(64),
    blocks: [
      { code: 'A1', excerpt: 'Email to SMS sends a text' },
      { code: 'C4', excerpt: 'Step 1: pick a gateway' }
    ],
    classifiedAt: '2026-10-28T16:00:00.000Z'
  })
}

const REQUEST: ReportDownloadRequest = {
  projectId: 'proj-1',
  scope: { kind: 'project' },
  marketId: null,
  engine: 'all',
  from: null,
  to: null,
  report: 'visibility',
  format: 'html',
  table: null,
  timeZone: ZONE
}

async function seeded(answers = true): Promise<Seeded> {
  const project = await seed({
    progress: [] as CheckProgress[],
    secondPrompt: true,
    http() {
      throw new Error('Reports must not search')
    }
  })
  plant(project.projectDb, answers)
  return project
}

function download(project: Seeded, request = REQUEST): ReturnType<typeof buildReviewDownload> {
  const found = getProject(project.storage.db, 'proj-1')
  if (found === null) throw new Error('no project')
  return buildReviewDownload(project.projectDb, found, request, NOW)
}

function figures(report: ReviewReport): unknown {
  return { sources: report.sources, shape: report.answerShape }
}

describe('Sources and Answer shape in the Visibility report', () => {
  test('the app and the file read every engine and show the same numbers', async () => {
    const project = await seeded()
    const { metrics, extras } = await project.handlers['reports:review']({
      projectId: 'proj-1',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'all',
      from: null,
      to: null
    })
    const app = buildReport(
      metrics,
      {
        brand: 'TextBolt',
        domain: 'textbolt.com',
        kind: 'visibility',
        day: dayIn(ZONE, NOW),
        marketLabel: 'US · EN',
        engineLabel: 'all engines'
      },
      extras
    )
    const file = download(project)
    expect(figures(file.report)).toEqual(figures(app))

    const { sources, answerShape } = app
    // Google: reddit, video, twilio, your page, LinkedIn; ChatGPT: the same thread again.
    expect(sources.total).toBe(6)
    expect(sources).toMatchObject({ yours: 1, competitor: 1, other: 4 })
    expect(sources.reddit.threads).toHaveLength(1)
    expect(sources.reddit.threads[0]).toMatchObject({ citations: 2, reply: 'unchecked' })
    expect(sources.reddit.threads[0]?.questions.n).toBe(1)
    expect(sources.reddit.threads[0]?.gap.n).toBe(1)
    expect(sources.youtube.videos[0]?.title).toBe('Title a2')
    expect(sources.linkedin[0]?.kind).toBe('article')
    expect(sources.gaps.n).toBe(1)
    // Google's stored classification of prompt 1's overview.
    expect(answerShape.analysed.n).toBe(1)
    expect(answerShape.waiting.n).toBe(1)
    expect(answerShape.mostCommon?.label).toBe('Definition → Step-by-step')
  })

  test('the file has both sections and passes its quality check', async () => {
    const project = await seeded()
    const file = download(project)
    const html = reviewHtml(file, NOW, ZONE)
    expect(html).toContain('id="sec-sources"')
    expect(html).toContain('id="sec-shape"')
    expect(html).toContain('Who the AI answers lean on')
    expect(html).toContain('Can we reply?')
    expect(html).toContain('Write a page in this order: Definition → Step-by-step')
    expect(htmlProblems(html, file.variants)).toEqual([])
  })

  test('YouTube, Reddit and LinkedIn save as CSV', async () => {
    const project = await seeded()
    const file = download(project)
    const reddit = reviewCsv(file, 'reddit').split('\r\n').filter(Boolean)
    expect(reddit[0]).toBe(
      '﻿Can we reply?,Upvotes,Thread,URL,Subreddit,Comments,Questions,Gap,Citations'
    )
    expect(reddit[1]).toContain('Not checked')
    expect(reddit[1]).toContain('r/sysadmin')
    expect(reviewCsv(file, 'youtube')).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(reviewCsv(file, 'linkedin')).toContain('Article')
  })

  test('with no AI answers each tab says so in one line and the file still passes', async () => {
    const project = await seeded(false)
    const file = download(project)
    expect(file.report.sources.total).toBe(0)
    expect(file.report.answerShape.withText).toBe(0)
    const html = reviewHtml(file, NOW, ZONE)
    expect(html).toContain('No AI answer cites a page in this check yet.')
    expect(html).toContain('No stored answer text to read for this check yet.')
    expect(htmlProblems(html, file.variants)).toEqual([])
  })
})
