import { describe, expect, it } from 'vitest'
import { CHECK_SLOWED_NOTICE } from '@shared/domain'
import type { AssistProgress, CheckProgress, PageReadProgress } from '@shared/ipc'
import { fromAssist, fromCheckProgress, fromPageRead } from './sources'

const AT = 5_000

function check(extra: Partial<CheckProgress> = {}): CheckProgress {
  return {
    jobId: 'j1',
    projectId: 'p1',
    pageId: 'g1',
    marketId: 'm1',
    promptId: 'q1',
    sampleNo: 1,
    phase: 'search',
    state: 'running',
    detail: 'best sms api',
    nextStep: null,
    errorCode: null,
    retrySearches: 0,
    done: 3,
    total: 12,
    searchesUsed: 3,
    searchesMax: 60,
    monthUsed: null,
    monthLimit: null,
    markets: [],
    ...extra
  }
}

function assist(extra: Partial<AssistProgress> = {}): AssistProgress {
  return {
    runId: 'r1',
    channel: 'projects:fillFromWebsite',
    scope: 'textbolt.com',
    stepId: 'read-pricing',
    kind: 'read',
    label: 'Reading /pricing',
    state: 'running',
    detail: null,
    startedAt: AT,
    endedAt: null,
    claude: null,
    ...extra
  }
}

describe('console sources: checks', () => {
  it('reports the search stage with "3 of 12" and a Stop', () => {
    const update = fromCheckProgress(check(), AT)
    expect(update).toMatchObject({
      jobId: 'check:j1',
      kind: 'checks',
      stage: 'SEARCH',
      stageText: '3 of 12 questions · 3 searches used · best sms api',
      progress: { done: 3, total: 12 },
      state: 'running',
      final: false,
      stop: { kind: 'check', jobId: 'j1' }
    })
  })

  it('says it is going slower, and that nothing is lost, while a rate limit holds it back', () => {
    const update = fromCheckProgress(
      check({ inFlight: 3, slowedNotice: CHECK_SLOWED_NOTICE, detail: CHECK_SLOWED_NOTICE }),
      AT
    )
    expect(update.stageText).toBe(`3 of 12 questions · 3 searches used · ${CHECK_SLOWED_NOTICE}`)
    expect(update.state).toBe('running')
    expect(CHECK_SLOWED_NOTICE).toBe(
      'Going slower: your CiteFox credits plan allows only a few searches at a time. CiteFox keeps going, nothing is lost.'
    )
    expect(CHECK_SLOWED_NOTICE).not.toMatch(/cloro|serpapi/i)
  })

  it('ends the job on the last question, and offers retry on an error', () => {
    expect(fromCheckProgress(check({ done: 12, state: 'ok' }), AT)).toMatchObject({
      final: true,
      state: 'ok',
      summary: '12 of 12 questions checked',
      stop: null
    })
    const failed = fromCheckProgress(
      check({ state: 'error', detail: 'SerpApi refused the key', nextStep: 'Check the key.' }),
      AT
    )
    expect(failed.error).toEqual({ message: 'SerpApi refused the key', nextStep: 'Check the key.' })
    expect(failed.retry).toEqual({ kind: 'check', projectId: 'p1', pageId: 'g1' })
  })

  it('says each step in plain words, with credits so far', () => {
    const words = (extra: Partial<CheckProgress>): string | undefined =>
      fromCheckProgress(check({ creditsUsed: 6, ...extra }), AT).stageText
    expect(
      words({ detail: 'Searching Google', promptText: 'nagios email to text not working' })
    ).toBe(
      '3 of 12 questions · 6 credits used · Searching Google for "nagios email to text not working"'
    )
    expect(words({ state: 'ok', detail: 'Loaded' })).toBe(
      '3 of 12 questions · 6 credits used · Reading the AI Overview'
    )
    expect(words({ phase: 'aio', state: 'ok', detail: 'Loaded' })).toBe(
      '3 of 12 questions · 6 credits used · Reading the AI Overview'
    )
    expect(words({ phase: 'analysis', state: 'ok', detail: 'Scored', sampleNo: null })).toBe(
      '3 of 12 questions · 6 credits used · Scoring'
    )
  })

  it('says how many questions run at once instead of naming one', () => {
    const words = (extra: Partial<CheckProgress>): string | undefined =>
      fromCheckProgress(check({ creditsUsed: 6, ...extra }), AT).stageText
    expect(words({ inFlight: 3, detail: 'Searching Google', promptText: 'best sms api' })).toBe(
      '3 of 12 questions · 6 credits used · searching 3'
    )
    expect(words({ inFlight: 2, phase: 'analysis', state: 'ok', detail: 'Scored' })).toBe(
      '3 of 12 questions · 6 credits used · searching 2'
    )
    // One left in flight reads as before.
    expect(words({ inFlight: 1, detail: 'Searching Google', promptText: 'best sms api' })).toBe(
      '3 of 12 questions · 6 credits used · Searching Google for "best sms api"'
    )
  })

  it('counts questions and keywords apart when a topic has both', () => {
    const mix = { questions: 8, keywords: 4 }
    expect(fromCheckProgress(check({ mix }), AT)).toMatchObject({
      command: 'check 8 questions and 4 keywords',
      stageText: '3 of 12 done · 3 searches used · best sms api'
    })
    expect(fromCheckProgress(check({ mix, done: 12, state: 'ok' }), AT).summary).toBe(
      '12 of 12 checked (8 questions and 4 keywords)'
    )
  })

  it('names the re-read stage READ', () => {
    expect(fromCheckProgress(check({ phase: 'reread', total: 0, done: 0 }), AT).stage).toBe('READ')
  })
})

describe('console sources: page reads and AI steps', () => {
  it('turns a page read into stages, ending on the summary or a failure', () => {
    const read = (extra: Partial<PageReadProgress>): PageReadProgress => ({
      pageId: 'g1',
      phase: 'fetch',
      state: 'running',
      detail: 'Fetching the page.',
      nextStep: null,
      ...extra
    })
    expect(fromPageRead(read({}), AT)).toMatchObject({
      jobId: 'read:g1',
      stage: 'FETCH',
      stageText: 'fetching the page',
      final: false
    })
    expect(fromPageRead(read({ phase: 'summary', state: 'ok' }), AT).final).toBe(true)
    expect(
      fromPageRead(read({ state: 'warning', detail: 'Blocked', nextStep: 'Paste the text.' }), AT)
    ).toMatchObject({ final: true, state: 'error', error: { nextStep: 'Paste the text.' } })
  })

  it('groups a fill run by domain, one question per kind of step, done on the result', () => {
    const reading = fromAssist(assist(), AT)
    expect(reading).toMatchObject({
      jobId: 'fill:textbolt.com',
      kind: 'fill',
      title: 'Fill from textbolt.com',
      command: 'fill textbolt.com',
      stage: 'READ',
      expectedMs: 90_000,
      final: false
    })
    expect(reading.step).toMatchObject({ id: 'r1:read-pricing', text: 'Reading /pricing' })
    const claude = fromAssist(
      assist({
        kind: 'claude',
        stepId: 'ask',
        label: 'Asking CiteFox AI',
        claude: {
          connection: 'claude-code',
          connectionText: 'CiteFox AI · on your plan',
          model: null
        }
      }),
      AT
    )
    expect(claude.stage).toBe('CLAUDE')
    expect(claude.step?.detail).toBe('CiteFox AI · on your plan')
    expect(
      fromAssist(assist({ kind: 'result', state: 'done', label: '31 suggestions' }), AT)
    ).toMatchObject({ final: true, summary: '31 suggestions' })
  })

  it('shows a failed AI step as a red line, and joins page-read AI steps to the read', () => {
    const failed = fromAssist(assist({ state: 'failed', detail: 'No AI is connected' }), AT)
    expect(failed.state).toBe('error')
    expect(failed.error?.message).toBe('Reading /pricing: No AI is connected')
    const pageAi = fromAssist(assist({ channel: 'pages:readStart', scope: null }), AT)
    expect(pageAi).toMatchObject({ jobId: 'ai:r1', kind: 'pages', attachTo: 'pages' })
  })

  it('marks the suggested start as background work: CiteFox started it, not the user', () => {
    expect(
      fromAssist(assist({ channel: 'topics:suggestedStart', scope: null }), AT).background
    ).toBe(true)
    expect(fromAssist(assist(), AT).background).toBeUndefined()
  })
})
