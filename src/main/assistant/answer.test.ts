import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AssistantAskRequest, AssistantContextInput } from '@shared/ipc'
import { seedTwoMarketProject } from '../../../tests/e2e/screens-seed'
import { createIpcHandlers } from '../handlers'
import type { EngineHost } from '../engine/host'
import { createLogger } from '../logging/logger'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../providers/claude/claude-code'
import { setHelpDirectory } from '../ask/help/library'
import { helpIntent } from './answer'
import { emptyClaudeCliUsage } from '../providers/claude/parse'
import type { HttpRequest, HttpResponse } from '../providers/http'
import { MemorySecretStore } from '../secrets/secret-store'
import { openAppStorage } from '../storage/app-storage'

/**
 * Ask CiteFox through the real IPC handler, over the two-market TextBolt seed
 * the e2e screens use (page-1 "Alerts", two prompts, US · EN and UK · EN, so
 * 4 prompt checks). Claude replies with the recorded fixtures; no network.
 */

const NOW = '2026-10-20T09:00:00.000Z'
let seeded = ''
const cleanups: Array<() => void> = []

function fixture(kind: string): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), `src/main/assistant/fixtures/${kind}.json`), 'utf8')
  ) as unknown
}

beforeAll(async () => {
  seeded = mkdtempSync(join(tmpdir(), 'citefox-assistant-seed-'))
  await seedTwoMarketProject(seeded)
})

afterAll(() => {
  rmSync(seeded, { recursive: true, force: true })
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

interface FakeClaude extends ClaudeProvider {
  requests: ClaudeCompletionRequest[]
}

function fakeClaude(replies: unknown[]): FakeClaude {
  const requests: ClaudeCompletionRequest[] = []
  return {
    id: 'claude-code',
    requests,
    async complete(request) {
      requests.push(request)
      const reply = replies.length > 1 ? replies.shift() : replies[0]
      return {
        provider: 'claude-code',
        text: JSON.stringify(reply),
        json: reply ?? null,
        inputTokens: 40,
        outputTokens: 12,
        durationMs: 2400,
        model: 'claude-test',
        resolvedModel: null,
        usage: emptyClaudeCliUsage()
      }
    }
  }
}

function open(claude: ClaudeProvider): {
  handlers: ReturnType<typeof createIpcHandlers>
  http: ReturnType<typeof vi.fn>
} {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-assistant-'))
  cpSync(seeded, dir, { recursive: true })
  const storage = openAppStorage(dir)
  let host: EngineHost | undefined
  const http = vi.fn(async (request: HttpRequest): Promise<HttpResponse> => {
    throw new Error(`No network in Ask CiteFox: ${request.url}`)
  })
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '0.1.0' }),
    storage,
    secrets: new MemorySecretStore(),
    logger: createLogger({ write: () => undefined }),
    http: { request: http },
    claudeCommand: {
      run: () => Promise.reject(new Error('The claude binary must not run in this test'))
    },
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    now: () => new Date(NOW),
    claude,
    onHost: (opened) => {
      host = opened
    }
  })
  cleanups.push(() => {
    host?.email.close()
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return { handlers, http }
}

function context(patch: Partial<AssistantContextInput> = {}): AssistantContextInput {
  return {
    screen: 'overview',
    screenLabel: 'Summary',
    crumbs: ['TextBolt', 'Summary'],
    pageId: null,
    topicId: null,
    promptId: null,
    marketId: null,
    runId: null,
    about: null,
    entities: [],
    selection: [],
    filters: {},
    numbers: [],
    facts: [],
    capabilities: [],
    ...patch
  }
}

function ask(question: string, patch: Partial<AssistantContextInput> = {}): AssistantAskRequest {
  return { projectId: 'proj-1', question, context: context(patch), history: [] }
}

describe('assistant:ask', () => {
  it('explains from the packet, asks again once over an invented number, then takes it out', async () => {
    const claude = fakeClaude([fixture('assistant_explain')])
    const { handlers, http } = open(claude)
    const answer = await handlers['assistant:ask'](
      ask('Explain this number', {
        about: { kind: 'kpi', id: null, label: 'Prompt checks', detail: '4' },
        numbers: [{ label: 'Prompt checks', value: '4', drill: 'overview:checks' }]
      })
    )

    expect(answer.intent).toBe('explain')
    expect(answer.savedDataOnly).toBe(true)
    // "About 37 of your searches…" is not in the data: asked again, then removed.
    expect(claude.requests).toHaveLength(2)
    expect(claude.requests[1]?.prompt).toContain('These numbers are not in the data: 37')
    expect(answer.flagged).toEqual(['37'])
    expect(answer.text).not.toContain('37')
    expect(answer.text).toContain('2 questions in 2 markets: 4 prompt checks')
    // The KPI's drill comes first, then the rows the answer cites.
    expect(answer.sources[0]).toMatchObject({ kind: 'drill', drill: 'overview:checks' })
    expect(
      answer.sources.some((source) => source.kind === 'check' && source.pageId === 'page-1')
    ).toBe(true)
    expect(answer.basedOn).toMatchObject({ checks: 4, markets: 2 })
    expect(answer.label?.text).toMatch(/^CiteFox AI · on your plan/)
    // Actions are checked cards: a re-check within the cap, the drill behind the number.
    const kinds = answer.actions.map((action) => action.kind)
    expect(kinds).toContain('start-check')
    expect(kinds).toContain('open-drill')
    const check = answer.actions.find((action) => action.kind === 'start-check')
    expect(check?.searches).toBeLessThanOrEqual(60)
    expect(check?.pageId).toBe('page-1')

    const prompt = claude.requests[0]?.prompt ?? ''
    expect(prompt.split('\n')[0]).toBe('Template: assistant_explain.md')
    expect(prompt).toContain('TextBolt')
    expect(prompt).toContain('simpletexting.com')
    expect(prompt).toContain('Explain this number')
    expect(http).not.toHaveBeenCalled()
  })

  it('drops actions the screen does not allow', async () => {
    const claude = fakeClaude([fixture('assistant_explain')])
    const { handlers } = open(claude)
    const answer = await handlers['assistant:ask'](
      ask('Explain this number', { capabilities: ['draft-fix'] })
    )
    expect(answer.actions).toEqual([])
  })

  it('offers a draft for the question in view when it is not cited', async () => {
    const claude = fakeClaude([fixture('assistant_why_not_cited')])
    const { handlers } = open(claude)
    const answer = await handlers['assistant:ask'](
      ask("Why isn't my page cited for this?", {
        screen: 'prompt',
        screenLabel: 'Prompt',
        pageId: 'page-1',
        promptId: 'prompt-1',
        marketId: 'mkt-uk'
      })
    )
    expect(answer.intent).toBe('why_not_cited')
    expect(answer.flagged).toEqual([])
    expect(answer.unknowns).toEqual(["The overview's own words for this question"])
    const draft = answer.actions.find((action) => action.kind === 'draft-fix')
    expect(draft).toMatchObject({
      pageId: 'page-1',
      promptIds: ['prompt-1'],
      marketIds: ['mkt-uk']
    })
    expect(answer.sources[0]).toMatchObject({
      kind: 'check',
      promptId: 'prompt-1',
      marketId: 'mkt-uk'
    })
    expect(claude.requests[0]?.prompt.split('\n')[0]).toBe('Template: assistant_why_not_cited.md')
  })

  it('turns suggested questions into an add-questions card for the page in view', async () => {
    const claude = fakeClaude([fixture('assistant_questions')])
    const { handlers } = open(claude)
    const answer = await handlers['assistant:ask'](
      ask('Suggest 5 similar questions', { screen: 'page.prompts', pageId: 'page-1' })
    )
    expect(answer.questions).toHaveLength(3)
    const add = answer.actions.find((action) => action.kind === 'add-questions')
    expect(add).toMatchObject({ pageId: 'page-1', topicId: null })
    expect(add?.questions).toHaveLength(3)
  })

  it('answers settings questions from the shipped help, with no actions', async () => {
    const claude = fakeClaude([fixture('assistant_help')])
    const { handlers } = open(claude)
    const answer = await handlers['assistant:ask'](
      ask('What does this setting do?', { screen: 'settings', screenLabel: 'Settings' })
    )
    expect(answer.intent).toBe('help')
    expect(answer.actions).toEqual([])
    expect(claude.requests[0]?.prompt.split('\n')[0]).toBe('Template: assistant_help.md')
  })

  it('answers with no project open from stored app data and the setup help only', async () => {
    const claude = fakeClaude([fixture('assistant_help')])
    const { handlers, http } = open(claude)
    const answer = await handlers['assistant:ask']({
      projectId: null,
      question: 'How do I start tracking my site?',
      context: context({ screen: 'overview', screenLabel: 'Summary', crumbs: ['Summary'] }),
      history: []
    })
    expect(answer.intent).toBe('help')
    expect(answer.actions).toEqual([])
    expect(answer.sources).toEqual([])
    expect(answer.basedOn).toEqual({ checkedThrough: null, checks: 0, markets: 0 })
    expect(answer.savedDataOnly).toBe(true)
    expect(answer.text).toContain('nothing here runs a search')
    const prompt = claude.requests[0]?.prompt ?? ''
    expect(prompt.split('\n')[0]).toBe('Template: assistant_help.md')
    // The app's stored data: the project list and the search keys, and how to start.
    expect(prompt).toContain('No project is open.')
    expect(prompt).toContain('Projects: 1 (TextBolt (textbolt.com))')
    expect(prompt).toMatch(/Search keys: (none added yet|\d+ keys?;)/)
    expect(prompt).toContain('Getting started: create a project')
    // Never a project's checks.
    expect(prompt).not.toContain('simpletexting.com')
    expect(claude.requests[0]?.trace?.projectId ?? null).toBeNull()
    expect(http).not.toHaveBeenCalled()
  })

  it('refuses a request with unknown keys or a bad id before Claude', async () => {
    const claude = fakeClaude([fixture('assistant_help')])
    const { handlers } = open(claude)
    const request = ask('Explain this number')
    await expect(
      handlers['assistant:ask']({ ...request, extra: true } as unknown as AssistantAskRequest)
    ).rejects.toThrow()
    await expect(
      handlers['assistant:ask']({
        ...request,
        context: { ...request.context, pageId: 'bad id with spaces' }
      })
    ).rejects.toThrow()
    expect(claude.requests).toHaveLength(0)
  })
})

describe('assistant:ask with the help docs', () => {
  const HELP = join(process.cwd(), 'src/main/ask/fixtures/help')

  afterEach(() => setHelpDirectory(undefined))

  function helpReply(sources: string[]): unknown {
    return {
      text: 'What changed compares two checks, so it waits for your next check.',
      sources,
      unknowns: [],
      draft: null,
      questions: [],
      actions: []
    }
  }

  it('answers a why question from the matching help section and the project facts, with a Read more link', async () => {
    setHelpDirectory(HELP)
    const claude = fakeClaude([helpReply(['H1', 'N1'])])
    const { handlers, http } = open(claude)
    const answer = await handlers['assistant:ask'](ask('Why is What changed empty?'))
    expect(answer.intent).toBe('help')
    expect(answer.help).toEqual([{ id: 'history', title: 'Check history' }])
    expect(answer.next).toEqual({ section: 'history', label: 'Open Check history' })
    expect(answer.actions).toEqual([])
    expect(answer.flagged).toEqual([])
    const prompt = claude.requests[0]?.prompt ?? ''
    expect(prompt.split('\n')[0]).toBe('Template: assistant_help.md')
    expect(prompt).toContain('H1 · Check history › Why is What changed empty? (topic id history)')
    expect(prompt).toMatch(/Checks finished: \d+/)
    expect(prompt).toContain('Fixes logged: 0.')
    expect(prompt).toContain('N1 · Questions in scope')
    expect(prompt).not.toMatch(/SerpApi|Jina|Claude Code/)
    expect(http).not.toHaveBeenCalled()
  })

  it('adds the help to a data answer for a why question, and keeps its sources', async () => {
    setHelpDirectory(HELP)
    const claude = fakeClaude([fixture('assistant_why_not_cited')])
    const { handlers } = open(claude)
    const answer = await handlers['assistant:ask'](
      ask("Why isn't my page cited for this question?", { screen: 'prompt', pageId: 'page-1' })
    )
    expect(answer.intent).toBe('why_not_cited')
    const prompt = claude.requests[0]?.prompt ?? ''
    expect(prompt).toContain('CiteFox help that may answer part of the question')
    expect(prompt).toMatch(/H1 · /)
    expect(prompt).toMatch(/Checks finished: \d+/)
    // The fixture cites no H ref: a data answer links no help topic of its own accord.
    expect(answer.help).toEqual([])
  })

  it('sends "none" for help when there is no help folder, and still answers', async () => {
    setHelpDirectory(null)
    const claude = fakeClaude([fixture('assistant_help')])
    const { handlers } = open(claude)
    const answer = await handlers['assistant:ask'](
      ask('What does this setting do?', { screen: 'settings', screenLabel: 'Settings' })
    )
    expect(answer.intent).toBe('help')
    expect(answer.help).toEqual([])
    expect(answer.next).toBeNull()
    expect(claude.requests[0]?.prompt).toContain(
      'CiteFox help sections that match the question (ref · topic › section, then the text):\nnone'
    )
  })

  it('keeps a list question on the filter engine, with no help links', async () => {
    setHelpDirectory(HELP)
    const claude = fakeClaude([
      {
        filters: {
          pageIds: null,
          marketIds: null,
          statuses: ['not_cited'],
          movements: null,
          intentStages: null,
          citedDomain: null,
          text: null
        },
        notCovered: null
      }
    ])
    const { handlers } = open(claude)
    const answer = await handlers['assistant:ask'](ask('Which questions are not cited?'))
    expect(answer.intent).toBe('list')
    expect(answer.list).not.toBeNull()
    expect(answer.help).toEqual([])
  })
})

describe('helpIntent', () => {
  const strong = [
    {
      ref: 'H1',
      score: 5,
      section: {
        topicId: 'history',
        topicTitle: 'Check history',
        screen: 'history',
        heading: 'Why is What changed empty?',
        text: 'What changed compares two checks.',
        keywords: []
      }
    }
  ]

  it('sends how / why questions about the screen itself to help, and keeps data questions', () => {
    expect(helpIntent('changes', 'Why is What changed empty?', strong)).toBe('help')
    expect(helpIntent('explain', 'Where is report branding?', strong)).toBe('help')
    expect(helpIntent('changes', 'Why did my citations drop?', strong)).toBe('changes')
    expect(helpIntent('next_steps', 'What should I fix first?', strong)).toBe('next_steps')
    expect(helpIntent('list', 'Which questions are not cited?', strong)).toBe('list')
    expect(helpIntent('explain', 'Explain this number', strong)).toBe('explain')
    expect(helpIntent('explain', 'Where is report branding?', [])).toBe('explain')
  })
})
