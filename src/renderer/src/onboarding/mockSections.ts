import type {
  FinishSetupRequest,
  FinishSetupResult,
  HelpFillEstimate,
  SetupContext,
  SetupRow,
  SetupSectionId,
  SetupSectionRequest,
  SetupSectionResult
} from '@shared/ipc'
import { guessPromptShape, isPromptShape } from '@shared/ipc'
import { MOCK_SCENARIO_STORAGE_KEY } from './flags'
import type { MockOnboardingClient } from './mockClient'
import { MOCK_COLUMNS, MOCK_ROWS, MOCK_TEXT } from './mockSectionData'
import type { SetupSectionClient } from './sectionClient'

/**
 * In-memory stand-in for the onboarding v2 section channels (`onboarding:section*`,
 * `onboarding:finishSetup`). Answers come from canned TextBolt rows after a short
 * pace, so the cards show their working state. Claude counts as missing when the mock
 * scenario is a failed checkup (`checkup-missing`, `checkup-logged-out`,
 * `checkup-fail`) or `claude: false`: every estimate is then `available: false` and the
 * cards offer "use your own ChatGPT". `finishSetup` finishes the mock onboarding client
 * (the one passed in, else the last one made), with or without a search key.
 */

export interface MockSectionOptions {
  /** Milliseconds a ✦ run takes (competitors take twice as long). Default 400. */
  pace?: number
  /** Force Claude on or off; default reads the mock scenario. */
  claude?: boolean
  /** The onboarding mock whose state finishSetup finishes. Default: the last one made. */
  onboarding?: MockOnboardingClient
  wait?: (ms: number) => Promise<void>
}

let lastOnboarding: MockOnboardingClient | null = null

/** Called by `createMockOnboardingClient`, so finishSetup can finish that client. */
export function registerMockOnboarding(client: MockOnboardingClient): void {
  lastOnboarding = client
}

/**
 * The topic Finish opens: a topic the mock topic page knows (MOCK_CARRIER_TOPIC_ID in
 * topics/results/source/mock.ts, kept as a literal so the fixture stays out of this file).
 */
const MOCK_FIRST_TOPIC_ID = 'topic-carrier-gateway'
const NO_CLAUDE_SCENARIOS = ['checkup-missing', 'checkup-logged-out', 'checkup-fail']
const NOTHING_NEW = 'Nothing new came back. Try other words, or edit the prompt.'
export const MOCK_NO_SEARCH_KEY_MESSAGE =
  'The first check did not start because no search key is on. Add a search key in Connections, then press Check now.'

function claudeOn(option: boolean | undefined): boolean {
  if (option !== undefined) return option
  try {
    const scenario =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(MOCK_SCENARIO_STORAGE_KEY)
    return scenario === null || !NO_CLAUDE_SCENARIOS.includes(scenario)
  } catch {
    return true
  }
}

/** False in the no-Claude scenarios, so step 3's estimate agrees with the section cards. */
export function mockClaudeAvailable(): boolean {
  return claudeOn(undefined)
}

const fold = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** Rows not already held (by name or host) and not repeated. */
function fresh(rows: readonly SetupRow[], current: readonly SetupRow[]): SetupRow[] {
  const seen = new Set(
    current.flatMap((row) => [fold(row.name), row.url ? fold(row.url) : '']).filter(Boolean)
  )
  const out: SetupRow[] = []
  for (const row of rows) {
    const keys = [fold(row.name), row.url ? fold(row.url) : ''].filter(Boolean)
    if (keys.length === 0 || keys.some((key) => seen.has(key))) continue
    keys.forEach((key) => seen.add(key))
    out.push({ ...row })
  }
  return out
}

function listResult(section: SetupSectionId, rows: SetupRow[]): SetupSectionResult {
  return { section, rows, text: null, warnings: rows.length === 0 ? [NOTHING_NEW] : [] }
}

/** A short prompt in main's shape: role, context, task, held rows, the user's words, reply rules. */
function mockPrompt(request: SetupSectionRequest): string {
  const c = request.context
  const lines = [
    `You help set up AI-search tracking for ${c.domain || 'the site'}.`,
    ...[
      ['Website', c.domain],
      ['Market', [c.country, c.language].filter(Boolean).join(' · ')],
      ['What it does', c.summary],
      ['Brand names', c.brands.join('; ')],
      ['Products', c.products.map((row) => row.name).join('; ')],
      ['Buyers', c.buyers.map((row) => row.name).join('; ')],
      ['Topic', c.topic]
    ]
      .filter(([, value]) => (value ?? '').trim().length > 0)
      .map(([label, value]) => `${label}: ${value}`),
    '',
    `Suggest ${request.section} for this business.`
  ]
  const held = request.current.filter((row) => row.name.trim().length > 0)
  if (held.length > 0) {
    lines.push(
      '',
      request.mode === 'more'
        ? `Already listed, don't repeat: ${held.length}.`
        : 'Keep these, the user chose them:',
      ...held.map((row) => `- ${row.name}`)
    )
  }
  if (request.instruction) lines.push('', `The user asks for this: ${request.instruction}`)
  const columns = MOCK_COLUMNS[request.section]
  lines.push(
    '',
    columns[0] === 'text'
      ? 'Reply with the text only: no heading, no notes, no quote marks.'
      : `Reply with CSV only, this header:\n${columns.join(',')}`
  )
  return lines.join('\n')
}

const STAGES = ['problem', 'options', 'doubts', 'fit', 'compare', 'decide']

/** A pasted answer: CSV, tab or pipe rows, or a plain list, one row per line. */
function readPaste(
  section: SetupSectionId,
  text: string,
  current: readonly SetupRow[]
): SetupSectionResult {
  const known = MOCK_COLUMNS[section]
  if (known[0] === 'text') {
    const body = text.trim()
    return {
      section,
      rows: [],
      text: body || null,
      warnings: body ? [] : ['No answer was found in the paste. Paste the whole reply.']
    }
  }
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/u, '').trim())
    .filter((line) => line.length > 0 && !/^\|?\s*-{3,}/u.test(line) && !line.startsWith('```'))
  const head = (lines[0] ?? '')
    .toLowerCase()
    .replace(/^\||\|$/gu, '')
    .split(/[,|\t]/u)
    .map((cell) => cell.trim())
  // A header row names the columns, in its own order.
  const hasHead = known.some((column) => head.includes(column))
  const columns = hasHead ? head : known
  const body = hasHead ? lines.slice(1) : lines
  const rows = body.map((line) => {
    const cells = line
      .replace(/^\||\|$/gu, '')
      .split(line.includes('\t') ? '\t' : line.includes('|') ? '|' : ',')
      .map((cell) => cell.trim())
    const value = (column: string): string => cells[columns.indexOf(column)] ?? ''
    const stage = value('stage').toLowerCase()
    const name = cells[0] ?? ''
    const shape = value('shape').toLowerCase()
    return {
      name,
      detail:
        section === 'questions'
          ? isPromptShape(shape)
            ? shape
            : guessPromptShape(name)
          : value('job') || value('situation') || value('why'),
      url: value('url') || value('domain') || value('page') || null,
      tag:
        section === 'questions'
          ? STAGES.includes(stage)
            ? stage
            : null
          : value('product') || null,
      ...(section === 'competitors'
        ? { tier: value('tier') === 'partial' ? ('partial' as const) : ('direct' as const) }
        : {})
    }
  })
  const found = fresh(
    rows.filter((row) => row.name.length > 1),
    current
  )
  if (found.length === 0 && rows.length === 0) {
    return {
      section,
      rows: [],
      text: null,
      warnings: [
        'No table or list was found in the answer. Paste the whole reply, or ask the chatbot for CSV.'
      ]
    }
  }
  return listResult(section, found)
}

function needsSite(context: SetupContext): void {
  if (context.domain.trim().length === 0)
    throw new Error('onboarding:sectionRun: Enter the website first.')
}

export function createMockSectionClient(options: MockSectionOptions = {}): SetupSectionClient {
  const pace = options.pace ?? 400
  const wait =
    options.wait ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
      }))

  return {
    async sectionEstimate(request): Promise<HelpFillEstimate> {
      const web = request.section === 'competitors'
      const callText = web ? '1 Claude call with web search' : '1 Claude call'
      if (!claudeOn(options.claude)) {
        return {
          kind: request.section,
          available: false,
          calls: 1,
          costText: callText,
          reason: 'Claude is not set up. Use your own ChatGPT for this section.'
        }
      }
      return {
        kind: request.section,
        available: true,
        calls: 1,
        costText: `${callText} · on your Claude plan`,
        reason: null
      }
    },

    async sectionPrompt(request) {
      return {
        section: request.section,
        prompt: mockPrompt(request),
        columns: [...MOCK_COLUMNS[request.section]],
        webSearch: request.section === 'competitors'
      }
    },

    async sectionRun(request) {
      if (!claudeOn(options.claude)) {
        throw new Error(
          'onboarding:sectionRun: Claude is not set up. Use your own ChatGPT for this section.'
        )
      }
      needsSite(request.context)
      await wait(request.section === 'competitors' ? pace * 2 : pace)
      if (request.section === 'summary' || request.section === 'topic') {
        return {
          section: request.section,
          rows: [],
          text: MOCK_TEXT[request.section],
          warnings: []
        }
      }
      const canned = MOCK_ROWS[request.section]
      const rows = request.mode === 'more' ? canned.more : canned.redo
      return listResult(request.section, fresh(rows, request.current))
    },

    async sectionRead(request) {
      return readPaste(request.section, request.text, request.current)
    },

    async rowFill(request) {
      if (!claudeOn(options.claude)) {
        throw new Error('onboarding:rowFill: CiteFox AI is not set up.')
      }
      await wait(pace)
      return request.list === 'buyers'
        ? { detail: 'Their old tool shut down and they need a new one', url: null }
        : { detail: 'Sends alerts as texts, for small teams', url: null }
    },

    async finishSetup(request: FinishSetupRequest): Promise<FinishSetupResult> {
      const onboarding = options.onboarding ?? lastOnboarding
      const saved = onboarding === null ? null : (await onboarding.getState()).profile
      if (onboarding === null || saved === null) {
        throw new Error('onboarding:finishSetup: Save your site first.')
      }
      await wait(pace)
      const done = onboarding.completeSetup()
      const topicId = request.questions.length > 0 ? MOCK_FIRST_TOPIC_ID : null
      const checkStarted = request.runFirstCheck && done.searchKey && topicId !== null
      let message: string | null = null
      if (request.runFirstCheck && topicId === null)
        message = 'Add at least one question to run a first check.'
      else if (request.runFirstCheck && !done.searchKey) message = MOCK_NO_SEARCH_KEY_MESSAGE
      return { state: done.state, projectId: saved.project.id, topicId, checkStarted, message }
    }
  }
}
