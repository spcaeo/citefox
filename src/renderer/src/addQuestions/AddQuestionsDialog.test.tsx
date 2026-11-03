// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Market } from '@shared/domain'
import type {
  AssistItem,
  AssistRunRequest,
  HelpFillDescribeRequest,
  HelpFillPromptRequest,
  HelpFillReadRequest,
  HelpFillResult,
  ImportCommitRequest,
  ImportResult,
  ImportRow,
  ImportUndoRequest,
  ImportValidateRequest,
  QuestionsDraft,
  QuestionTarget,
  QuestionTargets,
  QuestionsList,
  SaveQuestionsDraftRequest,
  StartCheckRequest,
  UpdatePageRequest
} from '@shared/ipc'
import {
  BuildToolsContext,
  ipcBuildClient,
  type BuildNoticeAction,
  type BuildNoticeLink
} from '../buildMenu/buildClient'
import { AddQuestionsDialog, type AddQuestionsDialogProps } from './AddQuestionsDialog'
import type { AddQuestionsSource } from './source'

afterEach(() => {
  cleanup()
})

/** Friday 23 Oct 2026; the next check below is the following Tuesday. */
const NOW = new Date(2026, 9, 23, 10, 0, 0)
const TUESDAY = new Date(2026, 9, 27, 9, 0, 0).toISOString()

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
    nextCheckAt: TUESDAY,
    intervalDays: 14,
    ...patch
  }
}

const TOPIC = 'topic-1'

const UK: Market = { ...US, id: 'mkt-uk', country: 'GB' }

function targets(searchesLeft: number | null = 412): QuestionTargets {
  return {
    projectId: 'proj-1',
    markets: [US, UK],
    searchesLeft,
    targets: [
      target({ id: 'page-1', name: 'Email to SMS', url: 'https://textbolt.com/email-to-sms/' }),
      target({ id: 'page-2', name: 'Pricing', url: 'https://textbolt.com/pricing/' }),
      target({ id: 'page-3', name: 'Outlook', status: 'not_tracked', nextCheckAt: null }),
      target({
        id: TOPIC,
        kind: 'topic',
        url: null,
        name: 'Replacing a carrier email-to-text gateway',
        questions: 9
      })
    ]
  }
}

const TRACKED_TEXT = 'send text alerts from outlook'

function trackedList(): QuestionsList {
  const row = (
    promptId: string,
    sourceId: string,
    text: string,
    stage: string | null
  ): Record<string, unknown> => ({
    promptId,
    sourceId,
    text,
    stage
  })
  return {
    projectId: 'proj-1',
    marketId: 'mkt-us',
    markets: [],
    sources: [
      { id: TOPIC, name: 'Replacing a carrier email-to-text gateway' },
      { id: 'page-1', name: 'Email to SMS' }
    ],
    rows: [
      row('q1', TOPIC, TRACKED_TEXT, 'problem'),
      row('q2', TOPIC, 'best email to text service for clinics', 'options'),
      row('q3', 'page-1', 'how do I send a text from my email account to a phone', 'problem')
    ]
  } as unknown as QuestionsList
}

function words(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length
}

interface Fake extends AddQuestionsSource {
  validates: ImportValidateRequest[]
  commits: ImportCommitRequest[]
  undos: ImportUndoRequest[]
  runs: AssistRunRequest[]
  starts: StartCheckRequest[]
  updates: UpdatePageRequest[]
  describes: HelpFillDescribeRequest[]
  prompts: HelpFillPromptRequest[]
  reads: HelpFillReadRequest[]
}

/** What main's helper hands back: two rows ready, one set aside for naming the brand. */
function helpResult(texts: readonly string[]): HelpFillResult {
  return {
    kind: 'questions',
    rows: texts.map((text, index) => ({
      id: `r${index + 1}`,
      section: null,
      values: {
        question: text,
        stage: index === 0 ? 'problem' : '',
        page: index === 0 ? '/email-to-sms/' : ''
      }
    })),
    setAside: [
      { id: 'r9', section: null, values: { question: 'Is TextBolt good?', stage: '', page: '' } }
    ],
    counts: { read: texts.length + 1, tracked: 0, repeats: 0, setAside: 1, ready: texts.length },
    noun: ['question', 'questions'],
    brand: 'TextBolt',
    warnings: []
  }
}

function fakeSource(
  options: { searchesLeft?: number | null; items?: AssistItem[]; noKey?: boolean } = {}
): Fake {
  const validates: ImportValidateRequest[] = []
  const commits: ImportCommitRequest[] = []
  const undos: ImportUndoRequest[] = []
  const runs: AssistRunRequest[] = []
  const starts: StartCheckRequest[] = []
  const updates: UpdatePageRequest[] = []
  const describes: HelpFillDescribeRequest[] = []
  const prompts: HelpFillPromptRequest[] = []
  const reads: HelpFillReadRequest[] = []
  const check = (
    text: string,
    keep: boolean,
    topic: boolean
  ): { result: ImportResult; reason: string | null } => {
    if (text.toLowerCase() === TRACKED_TEXT)
      return { result: 'duplicate', reason: 'Already tracked in “Text alerts” · skipped.' }
    if (text.includes('alarm') && !keep)
      return { result: 'similar', reason: 'Close to “AT&T email to text for alarms” (tracked).' }
    if (topic && words(text) <= 4)
      return { result: 'keyword', reason: `${words(text)} words: tracked as a keyword` }
    return { result: 'new', reason: null }
  }
  return {
    validates,
    commits,
    undos,
    runs,
    starts,
    updates,
    describes,
    prompts,
    reads,
    'helpfill:estimate': async ({ kind }) => ({
      kind,
      available: options.noKey !== true,
      calls: 1,
      costText: options.noKey === true ? '1 AI call' : '1 AI call · about $0.01',
      reason: options.noKey === true ? 'Needs CiteFox AI connected.' : null
    }),
    'helpfill:prompt': async (request) => {
      prompts.push(request)
      return {
        kind: request.kind,
        prompt:
          'You help a company find the questions its buyers type into Google.\nquestion,stage,page',
        columns: ['question', 'stage', 'page'],
        tracked: 2
      }
    },
    'helpfill:read': async (request) => {
      reads.push(request)
      return helpResult(['Can I text my on-call tech from Nagios without a carrier gateway?'])
    },
    'helpfill:describe': async (request) => {
      describes.push(request)
      return helpResult([
        'email to text for a dental office after Verizon ended vtext',
        'which email to SMS service works for a 20-person IT team'
      ])
    },
    'prompts:addTargets': async () =>
      targets(options.searchesLeft === undefined ? 412 : options.searchesLeft),
    'questions:list': async () => trackedList(),
    'import:validate': async (request) => {
      validates.push(request)
      // Main's rules for a file's Topic and Market cells: a topic that does not exist
      // needs "create it"; a market the topic does not check needs "add it".
      const fixOf = (values: Record<string, string>): ImportRow['fix'] =>
        values.topic && values.createTopic !== '1'
          ? 'topic'
          : values.market === 'mkt-uk' && values.addMarket !== '1'
            ? 'market'
            : null
      const rows = request.rows.map((row) => {
        const fix = fixOf(row.values)
        return {
          key: row.key,
          ...(fix === null
            ? check(row.values.question ?? '', row.keep === true, request.targetId === TOPIC)
            : {
                result: 'fix' as const,
                reason:
                  fix === 'topic' ? 'No topic named that yet.' : 'GB isn’t checked in this topic.'
              }),
          fix,
          match: null,
          kind: 'question' as const
        }
      })
      const count = (result: ImportResult): number =>
        rows.filter((row) => row.result === result).length
      return {
        rows,
        counts: {
          new: count('new'),
          keyword: count('keyword'),
          similar: count('similar'),
          duplicate: count('duplicate'),
          fix: count('fix'),
          total: rows.length
        }
      }
    },
    'import:commit': async (request) => {
      commits.push(request)
      return {
        batchId: 'batch-1',
        added: request.rows.length,
        skipped: [],
        promptIds: [
          {
            sourceId: request.targetId ?? '',
            promptIds: request.rows.map((_, index) => `new-${index}`)
          }
        ],
        message: `Added ${request.rows.length} questions.`
      }
    },
    'import:undo': async (request) => {
      undos.push(request)
      return { removed: 2, message: 'Undone: removed 2 questions.' }
    },
    'import:template': async () => ({ saved: true, fileName: 'questions.csv' }),
    'assist:run': async (request) => {
      runs.push(request)
      return {
        runId: `run-${runs.length}`,
        assistId: 'prompts.more',
        title: 'More buyer questions',
        summary: null,
        items: options.items ?? [],
        usage: null
      } as unknown as Awaited<ReturnType<AddQuestionsSource['assist:run']>>
    },
    'checks:start': async (request) => {
      starts.push(request)
      return { status: 'finished' } as unknown as Awaited<
        ReturnType<AddQuestionsSource['checks:start']>
      >
    },
    'pages:add': async () => {
      throw new Error('not used')
    },
    'pages:update': async (request) => {
      updates.push(request)
      return {} as Awaited<ReturnType<AddQuestionsSource['pages:update']>>
    }
  }
}

interface Notice {
  message: string
  link?: BuildNoticeLink
  action?: BuildNoticeAction
}

function renderDialog(
  source: Fake,
  props: Partial<AddQuestionsDialogProps> = {}
): { notices: Notice[]; onClose: ReturnType<typeof vi.fn> } {
  const notices: Notice[] = []
  const onClose = vi.fn()
  const tools = {
    client: ipcBuildClient,
    notify: (
      message: string,
      _tone?: unknown,
      link?: BuildNoticeLink,
      action?: BuildNoticeAction
    ) => {
      notices.push({ message, ...(link ? { link } : {}), ...(action ? { action } : {}) })
    }
  }
  const element: ReactElement = (
    <BuildToolsContext.Provider value={tools}>
      <AddQuestionsDialog
        projectId="proj-1"
        targetId={TOPIC}
        kindHint="topic"
        source={source}
        now={() => NOW}
        onClose={onClose}
        {...props}
      />
    </BuildToolsContext.Provider>
  )
  render(element)
  return { notices, onClose }
}

async function ready(): Promise<void> {
  await waitFor(() =>
    expect((screen.getByTestId('aq-target') as HTMLSelectElement).value).toBe(TOPIC)
  )
}

function questionBox(n: number): HTMLTextAreaElement {
  return screen.getByLabelText(`Question ${n}`) as HTMLTextAreaElement
}

function footer(): HTMLElement {
  return screen.getByTestId('add-questions-drawer')
}

describe('AddQuestionsDialog', () => {
  it('shows the four ways in, the rows and the rail for the topic in the URL', async () => {
    renderDialog(fakeSource())
    await ready()
    const tabs = screen.getByRole('tablist', { name: 'How to add questions' })
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
    ).toEqual(['Type or paste', 'Import a file', 'Help me write', 'From tracked questions'])
    expect(screen.getByText('Have 100 or more?')).toBeTruthy()
    expect(screen.getByText('Default page to be cited')).toBeTruthy()
    expect(screen.getByTestId('aq-markets').textContent).toContain('US')
    // The topic tracks Problem and Options, so the rest are thin.
    expect(screen.getByTestId('aq-missing').textContent).toContain(
      'Stages with the fewest questions'
    )
    // A not-tracked page is not offered.
    expect(screen.queryByRole('option', { name: /Outlook/u })).toBeNull()
  })

  it('checks each typed row live: new, keyword, similar with keep both, duplicate skipped', async () => {
    const source = fakeSource()
    renderDialog(source)
    await ready()
    fireEvent.change(questionBox(1), {
      target: { value: 'my carrier shut down its email to text gateway, what do I use now' }
    })
    fireEvent.change(questionBox(2), { target: { value: 'email to sms gateway' } })
    fireEvent.change(questionBox(3), {
      target: { value: 'alternatives to AT&T txt.att.net for alarm system texts' }
    })
    fireEvent.change(questionBox(4), { target: { value: TRACKED_TEXT } })
    await waitFor(() => expect(footer().textContent).toContain('2 to add'))
    expect(footer().textContent).toContain('1 duplicate skipped')
    expect(footer().textContent).toContain('1 to decide')
    expect(screen.getByText('Keyword')).toBeTruthy()
    expect(screen.getByText('Duplicate')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'keep both' }))
    await waitFor(() => expect(footer().textContent).toContain('3 to add'))
    expect(screen.getByText('Kept')).toBeTruthy()
    expect(footer().textContent).toContain('Topic grows to 11 questions · 1 keyword')
    expect(footer().textContent).toContain('checking now uses 3 searches')
  })

  it('splits a block pasted from a sheet into rows and cells', async () => {
    renderDialog(fakeSource())
    await ready()
    const block = [
      'Question\tStage\tPage',
      'is there a replacement for vtext.com email to SMS\tOptions\thttps://textbolt.com/email-to-sms/',
      'cheapest way for a 10-person office to send texts from email\tDecide\thttps://textbolt.com/pricing/',
      'does email to text still work for Verizon business lines in 2026\tDoubts\t'
    ].join('\n')
    fireEvent.paste(questionBox(1), { clipboardData: { getData: () => block } })
    await waitFor(() => expect(questionBox(3).value).toContain('Verizon'))
    expect(questionBox(1).value).toBe('is there a replacement for vtext.com email to SMS')
    expect((screen.getByLabelText('Stage of question 2') as HTMLSelectElement).value).toBe('decide')
    expect(
      (screen.getByLabelText('Page to be cited for question 2') as HTMLSelectElement).value
    ).toBe('https://textbolt.com/pricing/')
    await waitFor(() => expect(footer().textContent).toContain('3 to add'))
  })

  it('adds the new rows as one batch with View them and Undo, then closes', async () => {
    const source = fakeSource()
    const { notices, onClose } = renderDialog(source)
    await ready()
    fireEvent.change(questionBox(1), {
      target: { value: 'is there a replacement for vtext.com email to SMS' }
    })
    fireEvent.change(questionBox(2), { target: { value: TRACKED_TEXT } })
    await waitFor(() => expect(footer().textContent).toContain('1 to add'))
    const later = screen.getByTestId('aq-add-later')
    expect(later.textContent).toBe('Add to Tuesday’s check')
    fireEvent.click(later)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(source.commits).toHaveLength(1)
    expect(source.commits[0]?.rows.map((row) => row.values.question)).toEqual([
      'is there a replacement for vtext.com email to SMS'
    ])
    expect(source.starts).toHaveLength(0)
    const notice = notices[0]
    expect(notice?.message).toBe('1 question added')
    expect(notice?.link?.label).toBe('View them')
    expect(notice?.action?.label).toBe('Undo')
    await act(async () => notice?.action?.onClick())
    expect(source.undos).toEqual([{ projectId: 'proj-1', batchId: 'batch-1' }])
  })

  it('checks just the added questions now when there are searches left', async () => {
    const source = fakeSource()
    renderDialog(source)
    await ready()
    fireEvent.change(questionBox(1), {
      target: { value: 'is there a replacement for vtext.com email to SMS' }
    })
    await waitFor(() => expect(footer().textContent).toContain('1 to add'))
    fireEvent.click(screen.getByTestId('aq-add-now'))
    await waitFor(() => expect(source.starts).toHaveLength(1))
    expect(source.starts[0]).toMatchObject({ pageIds: [TOPIC], promptIds: ['new-0'] })
  })

  it('blocks Add and check now with both numbers when searches run short', async () => {
    renderDialog(fakeSource({ searchesLeft: 1 }))
    await ready()
    fireEvent.change(questionBox(1), {
      target: { value: 'is there a replacement for vtext.com email to SMS' }
    })
    fireEvent.change(questionBox(2), {
      target: { value: 'cheapest way for a small office to send texts from email' }
    })
    await waitFor(() => expect(footer().textContent).toContain('2 to add'))
    expect((screen.getByTestId('aq-add-now') as HTMLButtonElement).disabled).toBe(true)
    expect(footer().textContent).toContain('Not enough searches left this month to check now')
    expect((screen.getByTestId('aq-add-later') as HTMLButtonElement).disabled).toBe(false)
  })

  it('matches stages and pages by keywords (no AI), and sets a stage for all', async () => {
    const source = fakeSource()
    renderDialog(source)
    await ready()
    fireEvent.change(questionBox(1), {
      target: { value: 'how much does email to sms pricing cost for a team' }
    })
    const match = screen.getByRole('button', { name: 'Match stages and pages by keywords' })
    // Word matching in the renderer: the label never claims AI, and Claude is not asked.
    expect(match.textContent).not.toMatch(/\bAI\b|CiteFox AI|smart/iu)
    fireEvent.click(match)
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Page to be cited for question 1') as HTMLSelectElement).value
      ).not.toBe('')
    )
    expect((screen.getByLabelText('Stage of question 1') as HTMLSelectElement).value).not.toBe('')
    expect(screen.getByText(/Matched 1 stage and 1 page by keywords/u)).toBeTruthy()
    expect(source.runs).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /Set stage for all/u }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Compare' }))
    expect((screen.getByLabelText('Stage of question 1') as HTMLSelectElement).value).toBe(
      'compare'
    )
  })

  it('Help me write: Describe drafts rows that come in ticked and go into the rows', async () => {
    const source = fakeSource()
    renderDialog(source, { tab: 'suggest' })
    await ready()
    const helper = screen.getByTestId('aq-hf')
    expect(await within(helper).findByText('1 AI call · about $0.01')).toBeTruthy()
    fireEvent.change(within(helper).getByLabelText("Who is searching, and what's their problem?"), {
      target: { value: 'Dental offices whose carrier gateway shut down' }
    })
    fireEvent.click(within(helper).getByRole('button', { name: 'Write 10 questions' }))
    await waitFor(() => expect(screen.getByText(/dental office/u)).toBeTruthy())
    expect(source.describes[0]).toMatchObject({
      kind: 'questions',
      scope: { pageId: TOPIC },
      sentence: 'Dental offices whose carrier gateway shut down',
      count: 10
    })
    expect(screen.getByTestId('aq-hf-summary').textContent).toBe(
      'Read 3 rows. 1 named TextBolt and was set aside. 2 are ready.'
    )
    // A topic's rows each cite a page: shown as its address on the site, not a bare path.
    const drafted = screen.getByRole('list', { name: 'Drafted · tick the ones to keep' })
    expect(drafted.textContent).toContain('textbolt.com/email-to-sms/')
    // Both come in ticked; the stage and the page the answer named go with them.
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 to the rows' }))
    await waitFor(() => expect(questionBox(2).value).toContain('20-person IT team'))
    expect(questionBox(1).value).toContain('dental office')
    expect((screen.getByLabelText('Stage of question 1') as HTMLSelectElement).value).toBe(
      'problem'
    )
    // "Tell Claude what to change" runs it again with the change.
    fireEvent.change(within(helper).getByLabelText('Tell CiteFox AI what to change'), {
      target: { value: 'shorter' }
    })
    fireEvent.click(within(helper).getByRole('button', { name: 'Redo' }))
    await waitFor(() => expect(source.describes).toHaveLength(2))
    expect(source.describes[1]?.sentence).toBe(
      'Dental offices whose carrier gateway shut down\nChange: shorter'
    )
  })

  it('Help me write: a page’s drafted rows show no page, as in the rows', async () => {
    const source = fakeSource()
    renderDialog(source, { tab: 'suggest', targetId: 'page-1', kindHint: 'page' })
    await waitFor(() =>
      expect((screen.getByTestId('aq-target') as HTMLSelectElement).value).toBe('page-1')
    )
    const helper = screen.getByTestId('aq-hf')
    await within(helper).findByText('1 AI call · about $0.01')
    fireEvent.click(within(helper).getByRole('button', { name: 'Write 10 questions' }))
    const drafted = await screen.findByRole('list', { name: 'Drafted · tick the ones to keep' })
    expect(drafted.textContent).toContain('dental office')
    expect(drafted.textContent).not.toContain('email-to-sms')
    expect(drafted.querySelector('.ui-url')).toBeNull()
  })

  it('Help me write: a quick-start chip fills the box, and the thin-stage chip names the stages', async () => {
    renderDialog(fakeSource(), { tab: 'suggest', help: 'describe' })
    await ready()
    const helper = screen.getByTestId('aq-hf')
    const box = within(helper).getByLabelText(
      "Who is searching, and what's their problem?"
    ) as HTMLTextAreaElement
    const thin = within(helper).getByRole('button', { name: /\(fewest now\)$/u })
    fireEvent.click(thin)
    expect(box.value).toContain('which have the fewest questions now')
    expect(thin.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(thin)
    expect(box.value).toBe('')
  })

  it('Help me write: the chatbot way shows the question, opens the bot and reads the answer', async () => {
    const source = fakeSource()
    const opened: string[] = []
    const onHelp = vi.fn()
    const onBot = vi.fn()
    renderDialog(source, {
      tab: 'suggest',
      help: 'chatbot',
      bot: 'perplexity',
      onHelp,
      onBot,
      openLink: (url) => opened.push(url)
    })
    await ready()
    const helper = screen.getByTestId('aq-hf')
    await waitFor(() =>
      expect(within(helper).getByTestId('hf-prompt').textContent).toContain('question,stage,page')
    )
    expect(source.prompts[0]).toMatchObject({ kind: 'questions', scope: { pageId: TOPIC } })
    expect(
      (within(helper).getByRole('radio', { name: 'Perplexity' }) as HTMLInputElement).checked
    ).toBe(true)
    fireEvent.click(within(helper).getByRole('button', { name: 'Open Perplexity' }))
    expect(opened[0]).toMatch(/^https:\/\/www\.perplexity\.ai\/search\?q=You%20help/u)
    fireEvent.click(within(helper).getByRole('radio', { name: 'Gemini' }))
    expect(onBot).toHaveBeenCalledWith('gemini')
    fireEvent.click(within(helper).getByRole('radio', { name: /Describe it/u }))
    expect(onHelp).toHaveBeenCalledWith('describe')

    fireEvent.change(within(helper).getByLabelText('Paste its answer below'), {
      target: { value: 'question,stage\n"Can I text my on-call tech from Nagios?",Problem' }
    })
    fireEvent.click(within(helper).getByRole('button', { name: 'Read the answer' }))
    await waitFor(() => expect(screen.getByText(/on-call tech/u)).toBeTruthy())
    expect(source.reads[0]?.text).toContain('Nagios')
    expect(screen.getByTestId('aq-hf-summary').textContent).toContain('1 is ready.')
  })

  it('Help me write: with no CiteFox AI key it opens on the free chatbot way', async () => {
    const source = fakeSource({ noKey: true })
    renderDialog(source, { tab: 'suggest' })
    await ready()
    const helper = screen.getByTestId('aq-hf')
    await waitFor(() => expect(within(helper).getByTestId('hf-chatbot')).toBeTruthy())
    const describe = within(helper).getByRole('radio', { name: /Describe it/u }) as HTMLInputElement
    expect(describe.disabled).toBe(true)
    expect(
      within(helper).getByText(
        /Needs CiteFox AI connected\. Use your own ChatGPT instead \(free\)\./u
      )
    ).toBeTruthy()
    expect(source.describes).toHaveLength(0)
  })

  it('offers People also ask from the last check as a free quick start', async () => {
    const reads: string[] = []
    const source: Fake = {
      ...fakeSource(),
      'prompts:googleQuestions': async ({ pageId }) => {
        reads.push(pageId)
        return {
          pageId,
          questions: ['Can I text employees from Outlook without an app?', 'Is email to SMS free?']
        }
      }
    }
    renderDialog(source, { tab: 'suggest', help: 'describe' })
    await ready()
    const chip = await screen.findByRole('button', {
      name: 'Questions people also ask on Google (2)'
    })
    expect(reads).toEqual([TOPIC])
    // Free and already searched, so the list shows without a click.
    const seen = await screen.findByTestId('aq-seen-google')
    const list = within(seen).getByRole('list', { name: 'Seen on Google' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    // They come in unticked: tick one and add it.
    fireEvent.click(within(list).getByRole('checkbox', { name: /without an app/u }))
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 to the rows' }))
    await waitFor(() => expect(questionBox(1).value).toContain('without an app'))
    // Added ones leave the list; the rest stay.
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('Is email to SMS free?')).toBeTruthy()
    // The chip hides the list.
    fireEvent.click(chip)
    expect(screen.queryByTestId('aq-seen-google')).toBeNull()
  })

  it('reads "Seen on Google" only when Help me write is open', async () => {
    const reads: string[] = []
    const source: Fake = {
      ...fakeSource(),
      'prompts:googleQuestions': async ({ pageId }) => {
        reads.push(pageId)
        return { pageId, questions: [] }
      }
    }
    renderDialog(source, { tab: 'type' })
    await ready()
    expect(reads).toEqual([])
    expect(screen.queryByTestId('aq-seen-google')).toBeNull()
  })

  it('asks CiteFox AI only for the thin stages from Missing from this topic', async () => {
    const source = fakeSource({
      items: [
        {
          id: 'c',
          text: 'is an email to SMS service HIPAA safe for appointment texts',
          detail: '',
          tag: 'objection',
          verify: null,
          sign: null
        }
      ] as unknown as AssistItem[]
    })
    renderDialog(source)
    await ready()
    const missing = screen.getByTestId('aq-missing')
    fireEvent.click(within(missing).getByRole('button', { name: 'Suggest 3 for these stages' }))
    await waitFor(() => expect(within(missing).getByText(/HIPAA/u)).toBeTruthy())
    expect(source.runs[0]?.instruction).toContain('fewest questions')
    fireEvent.click(within(missing).getByRole('button', { name: /^Add: is an email/u }))
    await waitFor(() => expect(questionBox(1).value).toContain('HIPAA'))
  })

  it('copies questions another page tracks, kept next to the tracked one', async () => {
    const source = fakeSource()
    renderDialog(source, { tab: 'tracked' })
    await ready()
    const panel = await screen.findByTestId('aq-tracked')
    // Only questions of other pages and topics are offered.
    expect(within(panel).queryByText(TRACKED_TEXT)).toBeNull()
    fireEvent.click(within(panel).getByRole('checkbox'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Add 1 to the rows' }))
    await waitFor(() => expect(questionBox(1).value).toContain('send a text from my email'))
    await waitFor(() => expect(source.validates.at(-1)?.rows[0]).toMatchObject({ keep: true }))
  })

  it('takes rows back from Import a file and returns to the rows', async () => {
    let receive: ((rows: readonly ImportRow[]) => void) | null = null
    const onTab = vi.fn()
    renderDialog(fakeSource(), {
      tab: 'import',
      onTab,
      onImport: (handler) => {
        receive = handler
      }
    })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'choose a file' }))
    expect(receive).not.toBeNull()
    const row = (n: number, question: string): ImportRow => ({
      row: n,
      values: { question, stage: 'decide', page: 'https://textbolt.com/pricing/' },
      result: 'new',
      reason: null,
      fix: null,
      match: null,
      kind: 'question'
    })
    act(() =>
      receive?.([
        row(2, 'what does email to sms cost per month for a team'),
        row(3, 'is email to sms cheaper than a texting app')
      ])
    )
    await waitFor(() => expect(questionBox(2).value).toContain('cheaper'))
    expect(onTab).toHaveBeenCalledWith('type')
    expect((screen.getByLabelText('Stage of question 1') as HTMLSelectElement).value).toBe('decide')
  })

  it('keeps a file’s Topic and Market per row: create the topic, add the market (W3I-C1, C3)', async () => {
    let receive: ((rows: readonly ImportRow[]) => void) | null = null
    const source = fakeSource()
    renderDialog(source, {
      tab: 'import',
      onImport: (handler) => {
        receive = handler
      }
    })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'choose a file' }))
    const row = (n: number, question: string, values: Record<string, string>): ImportRow => ({
      row: n,
      values: { question, ...values },
      result: 'fix',
      reason: null,
      fix: null,
      match: null,
      kind: 'question'
    })
    act(() =>
      receive?.([
        row(2, 'how do I page my on-call team by text at night', { topic: 'On-call paging' }),
        row(3, 'how do london plumbers text customers about a late van', { market: 'mkt-uk' })
      ])
    )
    // The Topic and Market cells came with the rows, so both columns show.
    await waitFor(() =>
      expect((screen.getByLabelText('Topic of question 1') as HTMLInputElement).value).toBe(
        'On-call paging'
      )
    )
    expect((screen.getByLabelText('Market of question 2') as HTMLSelectElement).value).toBe(
      'mkt-uk'
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'create it' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'create it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'add GB to this topic' }))
    await waitFor(() => expect(footer().textContent).toContain('2 to add'))
    const last = source.validates.at(-1)
    expect(last?.rows.map((item) => item.values)).toEqual([
      {
        question: 'how do I page my on-call team by text at night',
        topic: 'On-call paging',
        createTopic: '1'
      },
      {
        question: 'how do london plumbers text customers about a late van',
        market: 'mkt-uk',
        addMarket: '1'
      }
    ])
  })

  it('keeps unsaved rows in main and offers them again; Add clears them (W3I-C4)', async () => {
    const store = new Map<string, QuestionsDraft>()
    const saves: SaveQuestionsDraftRequest[] = []
    const clears: string[] = []
    const withDrafts = (): Fake => ({
      ...fakeSource(),
      'import:getDraft': async ({ projectId }) => store.get(projectId) ?? null,
      'import:saveDraft': async (request) => {
        saves.push(request)
        store.set(request.projectId, { ...request, savedAt: NOW.toISOString() })
        return { saved: true }
      },
      'import:clearDraft': async ({ projectId }) => {
        clears.push(projectId)
        return { cleared: store.delete(projectId) }
      }
    })
    // Typed rows are saved a moment after the last change.
    const first = renderDialog(withDrafts())
    await ready()
    fireEvent.change(questionBox(1), {
      target: { value: 'what replaced the vtext email to text gateway' }
    })
    await waitFor(() => expect(saves.length).toBeGreaterThan(0), { timeout: 3000 })
    expect(saves.at(-1)).toMatchObject({
      projectId: 'proj-1',
      targetId: TOPIC,
      rows: [expect.objectContaining({ question: 'what replaced the vtext email to text gateway' })]
    })
    cleanup()
    expect(first.onClose).not.toHaveBeenCalled()

    // Opening again (a reload) offers them: nothing is saved over them until one is picked.
    const source = withDrafts()
    renderDialog(source)
    await ready()
    const offer = await screen.findByTestId('aq-draft')
    expect(offer.textContent).toContain('1 question you did not add yet')
    expect(questionBox(1).value).toBe('')
    fireEvent.click(within(offer).getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(questionBox(1).value).toBe('what replaced the vtext email to text gateway')
    )
    expect(screen.queryByTestId('aq-draft')).toBeNull()

    // Adding them clears the draft.
    await waitFor(() => expect(footer().textContent).toContain('1 to add'))
    fireEvent.click(screen.getByTestId('aq-add-later'))
    await waitFor(() => expect(clears).toEqual(['proj-1']))
    expect(store.has('proj-1')).toBe(false)
  })

  it('discards an offered draft on Discard', async () => {
    const store = new Map<string, QuestionsDraft>([
      [
        'proj-1',
        {
          projectId: 'proj-1',
          targetId: TOPIC,
          defaultPage: null,
          savedAt: NOW.toISOString(),
          rows: [
            {
              question: 'is email to text still free',
              stage: 'doubts',
              page: '',
              market: '',
              tags: '',
              topic: '',
              createTopic: false,
              addMarket: false,
              keep: false,
              origin: 'typed'
            }
          ]
        }
      ]
    ])
    renderDialog({
      ...fakeSource(),
      'import:getDraft': async ({ projectId }) => store.get(projectId) ?? null,
      'import:saveDraft': async () => ({ saved: true }),
      'import:clearDraft': async ({ projectId }) => ({ cleared: store.delete(projectId) })
    })
    await ready()
    const offer = await screen.findByTestId('aq-draft')
    expect(offer.textContent).toContain('saved today at')
    fireEvent.click(within(offer).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(store.has('proj-1')).toBe(false))
    expect(screen.queryByTestId('aq-draft')).toBeNull()
    expect(questionBox(1).value).toBe('')
  })

  it('picks a new topic that comes back from + New topic', async () => {
    let receive: ((id: string) => void) | null = null
    const onTarget = vi.fn()
    renderDialog(fakeSource(), {
      onTarget,
      onNewTopic: (handler) => {
        receive = handler
      }
    })
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))
    act(() => receive?.('page-2'))
    expect(onTarget).toHaveBeenCalledWith('page-2', 'topic')
  })

  it('saves a new check frequency from Expert options with the add', async () => {
    const source = fakeSource()
    const { onClose } = renderDialog(source)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Expert options' }))
    fireEvent.change(screen.getByLabelText('Check this topic every'), { target: { value: '30' } })
    fireEvent.click(screen.getByLabelText(/A market for each row/u))
    expect(screen.getByRole('columnheader', { name: 'Market' })).toBeTruthy()
    fireEvent.change(questionBox(1), {
      target: { value: 'is there a replacement for vtext.com email to SMS' }
    })
    await waitFor(() => expect(footer().textContent).toContain('1 to add'))
    fireEvent.click(screen.getByTestId('aq-add-later'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(source.updates).toEqual([{ projectId: 'proj-1', pageId: TOPIC, intervalDays: 30 }])
  })

  it('keeps the drawer open and adds nothing when the check frequency cannot be saved', async () => {
    const source = fakeSource()
    source['pages:update'] = async () => {
      throw new Error('disk is full')
    }
    const { onClose } = renderDialog(source)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Expert options' }))
    fireEvent.change(screen.getByLabelText('Check this topic every'), { target: { value: '30' } })
    fireEvent.change(questionBox(1), {
      target: { value: 'is there a replacement for vtext.com email to SMS' }
    })
    await waitFor(() => expect(footer().textContent).toContain('1 to add'))
    fireEvent.click(screen.getByTestId('aq-add-later'))
    const message = await screen.findByTestId('aq-interval-error')
    expect(message.textContent).toContain('nothing was added')
    expect(onClose).not.toHaveBeenCalled()
    expect(questionBox(1).value).toBe('is there a replacement for vtext.com email to SMS')
  })
})
