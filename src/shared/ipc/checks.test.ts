import { describe, expect, test } from 'vitest'
import type {
  AioReference,
  AlertSettings,
  CheckComparisonColumn,
  EmailAccount,
  MarketCheckMetrics,
  ProjectScoreSummary,
  PromptCheckRow,
  ResultsScope,
  TopAction,
  TrendPoint
} from '../domain'
import {
  isIpcEventChannel,
  isIpcInvokeChannel,
  type CheckJob,
  type CheckProgress,
  type CheckStepSnapshot
} from './index'

describe('IPC contract: checks and results', () => {
  test('check progress is a push event and score and email results carry no secret', () => {
    const progress: CheckProgress = {
      jobId: 'job-1',
      projectId: 'textbolt',
      pageId: 'alerts',
      marketId: 'us-en',
      promptId: 'p1',
      sampleNo: 1,
      phase: 'search',
      state: 'running',
      detail: 'Searching…',
      nextStep: null,
      errorCode: null,
      retrySearches: 0,
      done: 16,
      total: 40,
      searchesUsed: 34,
      searchesMax: 80,
      monthUsed: 1274,
      monthLimit: 5000,
      markets: [{ marketId: 'us-en', done: 10, total: 10, state: 'ok' }]
    }
    const score: ProjectScoreSummary = {
      projectId: 'textbolt',
      averageScore: 50,
      change: 12,
      nextCheckAt: '2026-11-02T14:00:00.000Z',
      searchesUsed: 1240,
      searchCap: 5000,
      pagesDueToday: 14
    }
    const account: EmailAccount = {
      id: 'mail-1',
      provider: 'gmail',
      fromName: 'CiteFox',
      fromAddress: 'reports@textbolt.com',
      replyTo: null,
      host: 'smtp.gmail.com',
      port: 587,
      security: 'starttls',
      username: 'reports@textbolt.com',
      keychainRef: 'smtp/gmail',
      isDefault: true,
      lastTestAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      lastTestNextStep: null,
      usedFor: []
    }
    const alerts: AlertSettings = {
      projectId: 'textbolt',
      desktop: true,
      emailAfterCheck: false,
      emailAccountId: null,
      emailTo: [],
      slackEnabled: false,
      slackWebhookStored: false,
      monthlyClientPdf: false,
      monthlyPdfTo: null
    }
    expect(isIpcEventChannel('checks:progress')).toBe(true)
    expect(isIpcInvokeChannel('checks:progress')).toBe(false)
    expect(isIpcInvokeChannel('checks:start')).toBe(true)
    expect(isIpcEventChannel('exports:progress')).toBe(true)
    expect(isIpcInvokeChannel('queue:status')).toBe(false)
    const serialized = JSON.stringify({ progress, score, account, alerts })
    expect(serialized).not.toMatch(/secret|password|api[_-]?key|token/i)
    expect(Object.hasOwn(account, 'password')).toBe(false)
    expect(Object.hasOwn(alerts, 'slackWebhook')).toBe(false)
  })

  test('results and running display fields stay on the contract', () => {
    const references: readonly AioReference[] = [
      {
        id: 'ref-1',
        position: 1,
        url: 'https://simpletexting.com/help',
        normalizedUrl: 'https://simpletexting.com/help',
        domain: 'simpletexting.com',
        title: 'Help',
        classification: 'competitor',
        untracked: false,
        sourceType: 'web'
      },
      {
        id: 'ref-2',
        position: 2,
        url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
        normalizedUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business',
        domain: 'textbolt.com',
        title: null,
        classification: 'target',
        untracked: false,
        sourceType: 'web'
      }
    ]
    const lost: PromptCheckRow = {
      promptId: 'p9',
      promptPosition: 9,
      label: 'Saturday field techs',
      text: 'How do I send a text to my field techs early Saturday morning?',
      source: 'trigger_event',
      intentStage: 'comparison',
      status: 'not_cited',
      frequency: { matching: 1, samples: 1 },
      position: null,
      citedUrl: null,
      references,
      wrongPageCited: false,
      named: false,
      movement: 'lost',
      previousStatus: 'page_cited',
      previousPosition: 2,
      coverage: 'partial',
      action: 'Add the Saturday FAQ.',
      aioSummary: 'simpletexting.com is cited first.',
      checkedAt: '2026-10-19T14:14:00.000Z'
    }
    const firstCheck: PromptCheckRow = {
      ...lost,
      promptId: 'p1',
      status: 'page_cited',
      position: 2,
      citedUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
      movement: null,
      previousStatus: null,
      previousPosition: null
    }
    const scope: ResultsScope = {
      promptCount: 10,
      marketCount: 4,
      brands: ['TextBolt', 'Text Bolt'],
      pageUrl: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
      pageTitle: 'How to set up text alerts',
      checkedAt: '2026-10-19T14:14:00.000Z',
      builtAt: '2026-10-19T14:20:00.000Z',
      promptSetVersion: 2,
      promptSetSavedAt: '2026-09-20T16:00:00.000Z',
      stale: false,
      nextFixNumber: 1
    }
    const unsaved: ResultsScope = { ...scope, promptSetVersion: null, promptSetSavedAt: null }
    const missing: CheckComparisonColumn = {
      which: 'baseline',
      runId: null,
      finishedAt: null,
      score: null,
      pageCited: null,
      anyOwnPageCited: null,
      linksThisPage: null,
      linksOtherOwn: null,
      brandMentioned: null,
      aiosShown: null,
      averagePosition: null,
      contentChanged: null,
      promptsChecked: 0
    }
    const current: CheckComparisonColumn = {
      ...missing,
      which: 'current',
      runId: 'run-3',
      finishedAt: '2026-10-19T14:14:00.000Z',
      score: 50,
      pageCited: 3,
      anyOwnPageCited: 4,
      linksThisPage: 3,
      linksOtherOwn: 1,
      brandMentioned: 1,
      aiosShown: 8,
      averagePosition: 3.2,
      contentChanged: true,
      promptsChecked: 10
    }
    const action: TopAction = {
      rank: 1,
      text: 'Add the txt.att.net migration step',
      reason: 'Prompt 4 is invisible: simpletexting.com and clicksend.com are cited instead.',
      linkLabel: 'Open the gap for prompt 4',
      screen: 'gaps',
      promptId: 'p4'
    }
    const step: CheckStepSnapshot = {
      pageId: 'alerts',
      marketId: 'us-austin',
      promptId: 'p4',
      promptPosition: 4,
      label: 'txt.att.net stopped',
      promptText:
        'My email-to-text through txt.att.net stopped working. What is the best replacement for business alerts in Austin?',
      sampleNo: 1,
      phase: 'search',
      state: 'error',
      detail: 'Timed out once, retried',
      errorCode: 'timeout',
      error: 'The Google search timed out.',
      retrySearches: 1
    }
    const job: CheckJob = {
      id: 'job-1',
      projectId: 'textbolt',
      pageIds: ['alerts'],
      marketIds: ['us-austin'],
      promptIds: null,
      status: 'running',
      startedAt: '2026-10-19T15:14:00.000Z',
      finishedAt: null,
      done: 16,
      total: 40,
      searchesUsed: 34,
      searchesMax: 80,
      brandSearchesMax: 0,
      monthUsed: 1274,
      monthLimit: 5000,
      runIds: [],
      markets: [],
      steps: [step],
      message: null,
      nextStep: null
    }

    expect(lost.references.map((reference) => reference.position)).toEqual([1, 2])
    expect(lost.citedUrl).toBeNull()
    expect(lost.previousStatus).toBe('page_cited')
    expect(lost.previousPosition).toBe(2)
    expect(firstCheck.previousStatus).toBeNull()
    expect(firstCheck.previousPosition).toBeNull()
    expect(firstCheck.citedUrl).toBe(
      'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
    )
    const missingMetricsVersion: MarketCheckMetrics['promptSetVersion'] = null
    const missingTrendVersion: TrendPoint['promptSetVersion'] = null
    expect(scope.promptSetSavedAt).toBe('2026-09-20T16:00:00.000Z')
    expect(unsaved.promptSetSavedAt).toBeNull()
    expect(missingMetricsVersion).toBeNull()
    expect(missingTrendVersion).toBeNull()
    expect(missing.promptsChecked).toBe(0)
    expect(current.promptsChecked).toBe(10)
    expect(current.aiosShown).toBe(8)
    expect(action.text).toContain('txt.att.net')
    expect(action.reason).toContain('cited instead')
    expect(action.linkLabel).toBe('Open the gap for prompt 4')
    expect(action.screen).toBe('gaps')
    expect(step.promptText).toContain('txt.att.net')
    expect(step.label).toBe('txt.att.net stopped')
    expect(job.status).toBe('running')
    expect(job.message).toBeNull()
    expect(step.error).toBe('The Google search timed out.')
    expect(step.error).not.toMatch(/api[_-]?key|bearer|\btoken\b|sk-ant-|[{}]/i)
  })
})
