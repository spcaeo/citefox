// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type JSX } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Market } from '@shared/domain'
import type { HelpFillWay } from '@shared/helpfill'
import type {
  HelpFillDescribeRequest,
  HelpFillPromptRequest,
  HelpFillReadRequest,
  HelpFillResult,
  QuestionTarget,
  QuestionTargets,
  QuestionsList
} from '@shared/ipc'
import type { HelpFillBot } from '../ui'
import { AddQuestionsDialog } from './AddQuestionsDialog'
import type { AddQuestionsSource } from './source'
import { matchOutcome, matchSummary } from './utils/matchPages'
import { emptyRow } from './utils/rows'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const TOPIC = 'topic-1'
const PRICING = 'https://textbolt.com/pricing/'
const Q = [
  'How much does it cost to text a whole crew from email every month?',
  'Can church volunteers reply to a group text sent from the office?',
  'Which tool sends alarm emails as texts at night?'
]

const US: Market = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
}

function target(patch: Partial<QuestionTarget> & Pick<QuestionTarget, 'id'>): QuestionTarget {
  return {
    kind: 'page',
    name: patch.id,
    url: `https://textbolt.com/${patch.id}/`,
    status: 'tracked',
    questions: 2,
    keywords: 0,
    samples: 1,
    marketIds: ['mkt-us'],
    nextCheckAt: null,
    intervalDays: 14,
    ...patch
  }
}

function targets(): QuestionTargets {
  return {
    projectId: 'proj-1',
    markets: [US],
    searchesLeft: 400,
    targets: [
      target({ id: 'page-2', name: 'Pricing', url: PRICING }),
      target({ id: TOPIC, kind: 'topic', url: null, name: 'Crew alerts', questions: 0 })
    ]
  }
}

/** Main's answer: a tracked page, one that is not tracked (flagged), one with none. */
function answer(): HelpFillResult {
  return {
    kind: 'matchPages',
    rows: [
      { id: 'row-1', section: null, values: { question: Q[0] ?? '', page: PRICING } },
      {
        id: 'row-2',
        section: null,
        values: { question: Q[1] ?? '', page: '', untracked: '/church-texting/' }
      },
      { id: 'row-3', section: null, values: { question: (Q[2] ?? '').toUpperCase(), page: '' } }
    ],
    setAside: [],
    counts: { read: 3, tracked: 0, repeats: 0, setAside: 0, ready: 3 },
    noun: ['question', 'questions'],
    brand: 'TextBolt',
    warnings: []
  }
}

interface Fake extends AddQuestionsSource {
  prompts: HelpFillPromptRequest[]
  reads: HelpFillReadRequest[]
  describes: HelpFillDescribeRequest[]
}

function fakeSource(): Fake {
  const prompts: HelpFillPromptRequest[] = []
  const reads: HelpFillReadRequest[] = []
  const describes: HelpFillDescribeRequest[] = []
  const unused = async (): Promise<never> => {
    throw new Error('not used')
  }
  return {
    prompts,
    reads,
    describes,
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: true,
      calls: 1,
      costText: '1 AI call · about $0.01',
      reason: null
    }),
    'helpfill:prompt': async (request) => {
      prompts.push(request)
      return {
        kind: request.kind,
        prompt: 'question,page',
        columns: ['question', 'page'],
        tracked: 0
      }
    },
    'helpfill:read': async (request) => {
      reads.push(request)
      return answer()
    },
    'helpfill:describe': async (request) => {
      describes.push(request)
      return answer()
    },
    'prompts:addTargets': async () => targets(),
    'questions:list': async () =>
      ({
        projectId: 'proj-1',
        marketId: 'mkt-us',
        markets: [],
        sources: [],
        rows: []
      }) as unknown as QuestionsList,
    'import:validate': async (request) => ({
      rows: request.rows.map((row) => ({
        key: row.key,
        result: 'new' as const,
        reason: null,
        fix: null,
        match: null,
        kind: 'question' as const
      })),
      counts: {
        new: request.rows.length,
        keyword: 0,
        similar: 0,
        duplicate: 0,
        fix: 0,
        total: request.rows.length
      }
    }),
    'import:commit': unused,
    'import:undo': unused,
    'import:template': unused,
    'assist:run': unused,
    'checks:start': unused,
    'pages:add': unused,
    'pages:update': unused
  }
}

function Harness({ source }: { source: Fake }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [way, setWay] = useState<HelpFillWay | null>(null)
  const [bot, setBot] = useState<HelpFillBot | null>(null)
  return (
    <AddQuestionsDialog
      projectId="proj-1"
      targetId={TOPIC}
      kindHint="topic"
      source={source}
      onClose={() => undefined}
      match={{ open, way, bot, onOpen: setOpen, onWay: setWay, onBot: setBot }}
      openLink={() => undefined}
    />
  )
}

async function typeRows(): Promise<void> {
  await waitFor(() =>
    expect((screen.getByTestId('aq-target') as HTMLSelectElement).value).toBe(TOPIC)
  )
  Q.forEach((text, index) => {
    fireEvent.change(screen.getByLabelText(`Question ${index + 1}`), { target: { value: text } })
  })
}

function pageOf(n: number): string {
  return (screen.getByLabelText(`Page to be cited for question ${n}`) as HTMLSelectElement).value
}

describe('Add questions › ✦ Match pages', () => {
  it('Describe: CiteFox AI gets the rows, sets tracked pages and flags the untracked one', async () => {
    const source = fakeSource()
    render(<Harness source={source} />)
    await typeRows()
    const button = screen.getByTestId('aq-match-pages')
    expect(button.textContent).toBe('Match pages')
    fireEvent.click(button)
    const panel = await screen.findByTestId('aq-match')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const write = await within(panel).findByRole('button', { name: 'Match 3 questions' })
    fireEvent.click(write)
    await waitFor(() => expect(source.describes).toHaveLength(1))
    expect(source.describes[0]).toMatchObject({
      kind: 'matchPages',
      scope: { pageId: TOPIC },
      items: Q
    })
    await waitFor(() => expect(pageOf(1)).toBe(PRICING))
    // Not tracked: never set, flagged in the panel. No page fits: left as it was.
    expect(pageOf(2)).toBe('')
    expect(pageOf(3)).toBe('')
    const result = within(panel).getByTestId('aq-match-result')
    expect(result.textContent).toContain('Set the page on 1 row. You can still change each one.')
    expect(result.textContent).toContain('1 has no tracked page that fits and keeps its page.')
    expect(result.textContent).toContain('1 named a page you don’t track')
    expect(
      within(result).getByRole('list', { name: 'Pages you don’t track' }).textContent
    ).toContain('/church-texting/')
    // Its own words on the Describe card, and its line in place of the kit's banner.
    expect(within(panel).getByTestId('hf-way-describe').textContent).toContain(
      'CiteFox picks a tracked page for each row with CiteFox AI.'
    )
    expect(within(panel).queryByTestId('aq-match-hf-summary')).toBeNull()
    // The user can still change it.
    fireEvent.change(screen.getByLabelText('Page to be cited for question 1'), {
      target: { value: '' }
    })
    expect(pageOf(1)).toBe('')
  })

  it('the chatbot way sends the rows with the question and the paste', async () => {
    const source = fakeSource()
    render(<Harness source={source} />)
    await typeRows()
    fireEvent.click(screen.getByTestId('aq-match-pages'))
    const panel = await screen.findByTestId('aq-match')
    const way = within(panel).getByRole('radio', { name: /Use your own ChatGPT/u })
    fireEvent.click(way)
    await waitFor(() => expect(source.prompts.at(-1)?.items).toEqual(Q))
    expect(source.prompts.at(-1)?.kind).toBe('matchPages')
    fireEvent.change(within(panel).getByLabelText('Paste its answer below'), {
      target: { value: 'question,page\nx,/pricing/' }
    })
    fireEvent.click(within(panel).getByRole('button', { name: 'Read the answer' }))
    await waitFor(() => expect(pageOf(1)).toBe(PRICING))
    expect(source.reads[0]?.items).toEqual(Q)
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('aq-match')).toBeNull()
  })

  it('only a topic has it (a page’s questions are cited on the page itself)', async () => {
    const source = fakeSource()
    render(
      <AddQuestionsDialog
        projectId="proj-1"
        targetId="page-2"
        kindHint="page"
        source={source}
        onClose={() => undefined}
        match={{
          open: false,
          way: null,
          bot: null,
          onOpen: () => undefined,
          onWay: () => undefined,
          onBot: () => undefined
        }}
      />
    )
    await waitFor(() =>
      expect((screen.getByTestId('aq-target') as HTMLSelectElement).value).toBe('page-2')
    )
    expect(screen.queryByTestId('aq-match-pages')).toBeNull()
  })
})

describe('matchOutcome', () => {
  it('matches answer rows back by question, case and punctuation ignored', () => {
    const rows = Q.map((question) => ({ ...emptyRow(), question }))
    const outcome = matchOutcome(rows, {
      ...answer(),
      rows: [
        ...answer().rows,
        {
          id: 'row-4',
          section: null,
          values: { question: 'A question nobody typed', page: PRICING }
        }
      ]
    })
    expect([...outcome.pages.values()]).toEqual([PRICING])
    expect(outcome.untracked.map((item) => item.page)).toEqual(['/church-texting/'])
    expect(outcome.none).toBe(1)
    expect(outcome.unknown).toBe(1)
    expect(matchSummary(outcome)).toBe(
      'Set the page on 1 row. You can still change each one. 1 has no tracked page that fits and keeps its page. 1 answer row was not a question in the rows.'
    )
  })
})
