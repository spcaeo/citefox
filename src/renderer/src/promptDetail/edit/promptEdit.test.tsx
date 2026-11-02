// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PromptCheckDetail, PromptCheckRow, ResultsHistory, TrendPoint } from '@shared/domain'
import type {
  CheckJob,
  CheckProgress,
  GetPromptCheckRequest,
  PageDetail,
  PromptTextRules,
  PromptVersions,
  RewordPromptRequest,
  StartCheckRequest
} from '@shared/ipc'
import { TEXTBOLT_MARKETS, textboltResults } from '../../m3/fixtures'
import { PromptDetailScreen } from '..'
import type { PromptDetailSource } from '../source'
import type { PromptPanel } from './model'
import { costLine, costProblem, textProblem, versionLinks, wordHint, wordingChange } from './model'
import type { PromptEditSource } from './source'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const results = textboltResults()
const ROW: PromptCheckRow = [...results.prompts].sort(
  (a, b) => a.promptPosition - b.promptPosition
)[0] as PromptCheckRow
const US = TEXTBOLT_MARKETS.find((market) => market.id === 'us-en')
const UK = TEXTBOLT_MARKETS.find((market) => market.id === 'uk-en')
const NEW_TEXT = 'How do I text the whole crew when a Saturday shift changes at short notice?'

const BUYER: PromptTextRules = {
  kind: 'buyer_prompt',
  minWords: 8,
  maxWords: 32,
  brands: ['TextBolt', 'Text Bolt']
}

const PAGE: PageDetail = {
  id: 'textbolt-alerts',
  projectId: 'textbolt',
  url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/',
  title: 'How to Set Up Text Alerts for Business',
  label: 'Text alerts for business',
  folder: null,
  status: 'tracked',
  setupStep: null,
  intervalDays: 14,
  samples: 3,
  promptCount: 10,
  defaultMarketId: 'us-en',
  pinned: false,
  score: 50,
  promptSetVersion: 2,
  markets: TEXTBOLT_MARKETS,
  snapshotId: 'snap-1'
}

function point(runId: string, finishedAt: string, version: number, partial = false): TrendPoint {
  return {
    runId,
    finishedAt,
    promptSetVersion: version,
    partial,
    pageCitedRate: 0.5,
    promptsChecked: 10,
    promptsTotal: 10,
    visibilityScore: 50,
    contentChanged: false
  }
}

const HISTORY: ResultsHistory = {
  pageId: 'textbolt-alerts',
  marketId: 'us-en',
  promptSetVersion: 2,
  points: [
    point('run-1', '2026-10-05T09:00:00.000Z', 1),
    point('run-current', '2026-10-19T09:00:00.000Z', 2)
  ]
}

function detailFor(row: PromptCheckRow | null, runId: string): PromptCheckDetail {
  return {
    pageId: 'textbolt-alerts',
    marketId: 'us-en',
    runId,
    row,
    samples: [],
    searchesUsed: 0,
    otherMarkets: [],
    aioGap: null,
    whereCovered: [],
    lens: {
      brandNames: ['TextBolt'],
      ownDomain: 'textbolt.com',
      includeSubdomains: true,
      productName: null,
      competitors: []
    },
    overviewReads: [],
    google: { ownRank: null, hasResults: false, questions: [] }
  }
}

/** The prompt shown is version 2; version 1 (prompt-old) asked other wording. */
function versions(patch: Partial<PromptVersions> = {}): PromptVersions {
  return {
    pageId: 'textbolt-alerts',
    promptId: ROW.promptId,
    active: true,
    currentPromptId: null,
    steps: [
      {
        promptId: ROW.promptId,
        promptSetVersion: 2,
        savedAt: '2026-10-12T10:00:00.000Z',
        texts: [{ marketId: 'us-en', text: ROW.text }]
      },
      {
        promptId: 'prompt-old',
        promptSetVersion: 1,
        savedAt: '2026-09-01T10:00:00.000Z',
        texts: [{ marketId: 'us-en', text: 'How do I alert the crew?' }]
      }
    ],
    rules: BUYER,
    ...patch
  }
}

function detailSource(calls: GetPromptCheckRequest[] = []): PromptDetailSource {
  return {
    'pages:get': async () => PAGE,
    'results:get': async () => results,
    'results:history': async () => ({
      ...HISTORY,
      points: [...HISTORY.points, point('run-recheck', '2026-10-23T09:00:00.000Z', 3, true)]
    }),
    'checks:getPrompt': async (request) => {
      calls.push(request)
      if (request.runId === 'run-1') {
        return detailFor({ ...ROW, promptId: 'prompt-old', status: 'not_cited' }, 'run-1')
      }
      return detailFor(request.promptId === ROW.promptId ? ROW : null, 'run-current')
    }
  }
}

function job(patch: Partial<CheckJob> = {}): CheckJob {
  return {
    id: 'job-1',
    projectId: 'textbolt',
    pageIds: ['textbolt-alerts'],
    marketIds: ['us-en'],
    promptIds: ['prompt-new'],
    status: 'finished',
    startedAt: '2026-10-23T09:00:00.000Z',
    finishedAt: '2026-10-23T09:00:30.000Z',
    done: 1,
    total: 1,
    searchesUsed: 3,
    searchesMax: 6,
    brandSearchesMax: 0,
    monthUsed: null,
    monthLimit: null,
    runIds: ['run-recheck'],
    markets: [],
    steps: [],
    message: null,
    nextStep: null,
    ...patch
  }
}

interface FakeEdits extends PromptEditSource {
  rewords: RewordPromptRequest[]
  starts: StartCheckRequest[]
  emit: (event: Partial<CheckProgress>) => void
  release: () => void
}

function editSource(
  options: {
    versions?: PromptVersions
    reword?: (request: RewordPromptRequest) => Promise<string>
    job?: CheckJob
    hold?: boolean
  } = {}
): FakeEdits {
  const rewords: RewordPromptRequest[] = []
  const starts: StartCheckRequest[] = []
  const listeners = new Set<(event: CheckProgress) => void>()
  let release = (): void => undefined
  return {
    rewords,
    starts,
    emit: (event) => {
      for (const listener of listeners) {
        listener({
          jobId: 'job-1',
          projectId: 'textbolt',
          pageId: 'textbolt-alerts',
          marketId: 'us-en',
          promptId: 'prompt-new',
          sampleNo: 1,
          phase: 'search',
          state: 'running',
          detail: 'Searching Google',
          nextStep: null,
          errorCode: null,
          retrySearches: 0,
          done: 0,
          total: 1,
          searchesUsed: 1,
          searchesMax: 6,
          monthUsed: null,
          monthLimit: null,
          markets: [],
          ...event
        })
      }
    },
    release: () => release(),
    'prompts:versions': async () => options.versions ?? versions(),
    'prompts:reword': async (request) => {
      rewords.push(request)
      const promptId = options.reword ? await options.reword(request) : 'prompt-new'
      return {
        pageId: request.pageId,
        promptId,
        previousPromptId: request.promptId,
        changed: true,
        version: 3,
        savedAt: '2026-10-23T08:59:00.000Z'
      }
    },
    'checks:start': async (request) => {
      starts.push(request)
      if (options.hold) await new Promise<void>((resolve) => (release = resolve))
      return options.job ?? job()
    },
    'checks:progress': (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    'status:getCapsule': async () => ({
      searchesLeft: 31898,
      issueCount: 0,
      serpapi: 'ok',
      claudeCode: 'ok',
      jina: 'ok',
      youtube: 'ok'
    })
  }
}

const HERE = `#/pages/textbolt-alerts/prompt/${ROW.promptId}`

/** Prompt detail at its own URL; `panel` opens its drawer from the link (`?drawer=pd-…`). */
function screen(
  edits: FakeEdits,
  panel: PromptPanel | null = null,
  calls: GetPromptCheckRequest[] = [],
  legacy: PromptPanel | null = null
): ReturnType<typeof render> {
  window.location.hash = panel ? `${HERE}?drawer=pd-${panel}` : HERE
  return render(
    <PromptDetailScreen
      source={detailSource(calls)}
      editSource={edits}
      projectId="textbolt"
      projectName="TextBolt"
      pageId="textbolt-alerts"
      promptId={ROW.promptId}
      marketId={undefined}
      panel={legacy}
      onMarketChange={() => undefined}
    />
  )
}

describe('edit question model', () => {
  it('checks wording like the Questions tab', () => {
    expect(textProblem('  ', BUYER)).toBe('Write the wording before saving.')
    expect(textProblem('Crew text alerts', BUYER)).toMatch(/is 3 words.*at least 8 words/)
    expect(textProblem(`${'word '.repeat(33)}`, BUYER)).toMatch(/is 33 words.*at most 32/)
    expect(textProblem('Which textbolt plan texts the whole crew on a Saturday?', BUYER)).toBe(
      'A buyer question contains the brand name "TextBolt".'
    )
    expect(textProblem(NEW_TEXT, BUYER)).toBeNull()
    const question: PromptTextRules = { ...BUYER, kind: 'question', minWords: 1 }
    expect(textProblem('crew text alerts', question)).toBeNull()
    expect(textProblem('Is Text Bolt cheaper', question)).toMatch(/names your brand/)
    // Whole words only for topic questions.
    expect(textProblem('textboltish crew alerts', question)).toBeNull()
    expect(wordHint(NEW_TEXT, BUYER)).toBe(
      '15 words · 8 to 32 for a buyer question, without your brand'
    )
  })

  it('says what a re-check costs before it runs', () => {
    if (!US || !UK) throw new Error('fixture markets missing')
    expect(costLine(3, [US], 31898)).toBe(
      'Uses 3 searches in US · EN, up to 6 if Google loads the overview separately · 31,898 left'
    )
    expect(costLine(1, [US, UK], null)).toBe(
      'Uses 2 searches in US · EN and UK · EN, up to 4 if Google loads the overview separately'
    )
    expect(costLine(3, [], 10)).toBe('Pick a market to re-check.')
    expect(costProblem(3, 1, 2)).toBe(
      'Not enough searches left this month: this uses 3 and 2 are left.'
    )
    expect(costProblem(3, 0, 100)).toBe('Pick at least one market.')
    expect(costProblem(3, 1, null)).toBeNull()
  })

  it('links each prompt-set version to its question and finds where the wording changed', () => {
    const links = versionLinks(versions(), 'us-en')
    expect(links.get(2)).toEqual({ promptId: ROW.promptId, earlierWording: null })
    expect(links.get(1)).toEqual({
      promptId: 'prompt-old',
      earlierWording: 'How do I alert the crew?'
    })
    expect(wordingChange(versions(), 'us-en')).toEqual({
      changedAt: '2026-10-12T10:00:00.000Z',
      previous: 'How do I alert the crew?'
    })
    expect(wordingChange(versions(), 'uk-en')).toBeNull()
    expect(versionLinks(null, 'us-en').size).toBe(0)
  })
})

describe('Edit question on Question detail', () => {
  it('opens from the pencil and the More menu as a drawer on the URL; Esc and Back close it', async () => {
    const view = screen(editSource())
    fireEvent.click(await view.findByRole('button', { name: 'Edit question' }))
    expect(window.location.hash).toBe(`${HERE}?drawer=pd-edit`)
    expect(await view.findByRole('dialog', { name: 'Edit question' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog', { name: 'Edit question' })).toBeNull()
    await waitFor(() => expect(window.location.hash).toBe(HERE))
    fireEvent.click(view.getByRole('button', { name: 'More fix actions' }))
    fireEvent.click(view.getByRole('menuitem', { name: 'Check now' }))
    expect(window.location.hash).toBe(`${HERE}?drawer=pd-recheck`)
    expect(await view.findByRole('dialog', { name: 'Check this question now' })).toBeTruthy()
    await act(async () => {
      window.history.back()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(window.location.hash).toBe(HERE)
    expect(view.queryByRole('dialog', { name: 'Check this question now' })).toBeNull()
  })

  it('an old ?panel= link opens the drawer, and changed wording asks before closing', async () => {
    const view = screen(editSource(), null, [], 'edit')
    const dialog = await view.findByRole('dialog', { name: 'Edit question' })
    expect(window.location.hash).toBe(`${HERE}?drawer=pd-edit`)
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: NEW_TEXT } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Edit question' }))
    expect(view.getByRole('alertdialog', { name: 'Discard changes?' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Discard' }))
    expect(view.queryByRole('dialog', { name: 'Edit question' })).toBeNull()
    await waitFor(() => expect(window.location.hash).toBe(HERE))
  })

  it('checks the wording before saving and shows the cost', async () => {
    const view = screen(editSource(), 'edit')
    const dialog = await view.findByRole('dialog', { name: 'Edit question' })
    expect(await within(dialog).findByText(/Uses 3 searches in US · EN.*31,898 left/)).toBeTruthy()
    const field = within(dialog).getByRole('textbox')
    expect((field as HTMLTextAreaElement).value).toBe(ROW.text)
    const save = within(dialog).getByRole('button', { name: 'Save only' })
    expect(save).toHaveProperty('disabled', true)
    fireEvent.change(field, {
      target: { value: 'Which TextBolt plan texts the whole crew on Saturdays?' }
    })
    expect(within(dialog).getByRole('alert').textContent).toBe(
      'A buyer question contains the brand name "TextBolt".'
    )
    expect(save).toHaveProperty('disabled', true)
    fireEvent.change(field, { target: { value: NEW_TEXT } })
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(save).toHaveProperty('disabled', false)
  })

  it('Save only saves the wording and moves to the new question without a check', async () => {
    const edits = editSource()
    const view = screen(edits, 'edit')
    const dialog = await view.findByRole('dialog', { name: 'Edit question' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: NEW_TEXT } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save only' }))
    await waitFor(() =>
      expect(window.location.hash).toBe('#/pages/textbolt-alerts/prompt/prompt-new')
    )
    expect(edits.rewords).toEqual([
      {
        projectId: 'textbolt',
        pageId: 'textbolt-alerts',
        promptId: ROW.promptId,
        marketId: 'us-en',
        text: NEW_TEXT,
        allMarkets: false
      }
    ])
    expect(edits.starts).toEqual([])
  })

  it('Save and check now checks only this question in this market, in line, then pins the new check', async () => {
    const edits = editSource({ hold: true })
    const view = screen(edits, 'edit')
    const dialog = await view.findByRole('dialog', { name: 'Edit question' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: NEW_TEXT } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and check now' }))
    await waitFor(() => expect(edits.starts).toHaveLength(1))
    expect(edits.starts[0]).toEqual({
      projectId: 'textbolt',
      pageIds: ['textbolt-alerts'],
      marketIds: ['us-en'],
      promptIds: ['prompt-new']
    })
    expect(await view.findByText(/Checking in US · EN/)).toBeTruthy()
    act(() => edits.emit({ done: 0, searchesUsed: 2 }))
    expect(view.getByText(/0 of 1 done · 2 of up to 6 searches used/)).toBeTruthy()
    act(() => edits.emit({ promptId: 'someone-else', searchesUsed: 5 }))
    expect(view.getByText(/2 of up to 6 searches used/)).toBeTruthy()
    edits.release()
    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/pages/textbolt-alerts/prompt/prompt-new?market=us-en&run=run-recheck'
      )
    )
    expect(await view.findByText(/Checked in US · EN\. Used 3 searches/)).toBeTruthy()
  })

  it('shows why a save or a re-check failed, in plain words', async () => {
    const edits = editSource({
      reword: async () => {
        throw new Error(
          "Error invoking remote method 'prompts:reword': IpcRequestError: prompts:reword: This page has unsaved question edits on its Questions tab. Save or discard them there first, then edit this question."
        )
      }
    })
    const view = screen(edits, 'edit')
    const dialog = await view.findByRole('dialog', { name: 'Edit question' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: NEW_TEXT } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and check now' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'This page has unsaved question edits on its Questions tab. Save or discard them there first, then edit this question.'
    )
    expect(edits.starts).toEqual([])
    cleanup()

    const refused = editSource({
      job: job({
        status: 'error',
        message: 'This check would pass the 60-search live cap.',
        nextStep: 'Raise the cap in Settings.'
      })
    })
    const second = screen(refused, 'recheck')
    const panel = await second.findByRole('dialog', { name: 'Check this question now' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Spend and check now' }))
    const alert = await second.findByText(/The re-check did not run\./)
    expect(alert.closest('[role="alert"]')?.textContent).toContain(
      'This check would pass the 60-search live cap. Raise the cap in Settings.'
    )
  })

  it('Check now picks among the question’s markets, the shown one first', async () => {
    const both = versions({
      steps: [
        {
          promptId: ROW.promptId,
          promptSetVersion: 2,
          savedAt: '2026-10-12T10:00:00.000Z',
          texts: [
            { marketId: 'us-en', text: ROW.text },
            { marketId: 'uk-en', text: ROW.text }
          ]
        }
      ]
    })
    const edits = editSource({ versions: both })
    const view = screen(edits, 'recheck')
    const panel = await view.findByRole('dialog', { name: 'Check this question now' })
    const us = within(panel).getByRole('checkbox', { name: 'US · EN' })
    const uk = within(panel).getByRole('checkbox', { name: 'UK · EN' })
    expect(us).toHaveProperty('checked', true)
    expect(uk).toHaveProperty('checked', false)
    fireEvent.click(uk)
    expect(
      within(panel).getAllByText(/Uses 6 searches in US · EN and UK · EN/).length
    ).toBeGreaterThan(0)
    fireEvent.click(uk)
    fireEvent.click(within(panel).getByRole('button', { name: 'Spend and check now' }))
    await waitFor(() => expect(edits.starts).toHaveLength(1))
    expect(edits.starts[0]).toMatchObject({ marketIds: ['us-en'], promptIds: [ROW.promptId] })
  })

  it('an older version cannot be edited and points at the current wording', async () => {
    const edits = editSource({
      versions: versions({ active: false, currentPromptId: 'prompt-current' })
    })
    const view = screen(edits, 'edit')
    const dialog = await view.findByRole('dialog', { name: 'Edit question' })
    expect(
      within(dialog).getByRole('link', { name: 'Open the current wording' }).getAttribute('href')
    ).toBe('#/pages/textbolt-alerts/prompt/prompt-current?drawer=pd-edit')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: NEW_TEXT } })
    expect(within(dialog).getByRole('button', { name: 'Save only' })).toHaveProperty(
      'disabled',
      true
    )
  })

  it('Over time reads earlier checks with the earlier question and says where the wording changed', async () => {
    const calls: GetPromptCheckRequest[] = []
    const view = screen(editSource(), null, calls)
    fireEvent.click(await view.findByRole('tab', { name: /^Over time/ }))
    expect(await view.findByText(/Wording changed on/)).toBeTruthy()
    expect(view.getByText(/Checks before then asked “How do I alert the crew\?”/)).toBeTruthy()
    await waitFor(() => expect(view.getAllByText('Earlier wording').length).toBe(1))
    expect(calls.find((call) => call.runId === 'run-1')?.promptId).toBe('prompt-old')
    const earlier = view.getAllByRole('link', { name: /show this question in that check$/ })
    expect(earlier.some((link) => link.getAttribute('href')?.includes('/prompt/prompt-old?'))).toBe(
      true
    )
  })
})
