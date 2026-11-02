import { afterEach, describe, expect, test } from 'vitest'
import { TEXTBOLT_TOPIC_MARKET } from '@shared/fixtures/textbolt-topic'
import { cleanupHarness, harness } from '../handlers/test-harness'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../providers/claude/claude-code'
import { insertEngineAnswer, type NewEngineAnswer } from '../storage/engine-records'
import { insertPage } from '../storage/pages'
import {
  closeProjectDatabase,
  createProjectDatabase,
  openProjectDatabase
} from '../storage/project-files'
import { writeProjectProfile } from '../storage/project-profile'
import { getProject, insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { topicFixtureReply } from './fixture-replies'
import { seedTextboltTopic } from './fixture-seed'
import { activePromptSetId } from './results'
import {
  cleanTargetReply,
  engineList,
  promptNoun,
  targetPick,
  targetProblem,
  type TargetCandidate
} from './target-suggest'

afterEach(cleanupHarness)

const PROJECT = 'proj-textbolt'
/** The projects folder of the latest `seeded()` harness, to add rows after seeding. */
let projectsDirectory = ''

const ANSWER: Omit<NewEngineAnswer, 'id' | 'runId' | 'promptId' | 'checkedAt'> = {
  sampleNo: 1,
  engine: 'chatgpt',
  keyId: null,
  status: 'cited',
  citedUrl: null,
  position: null,
  named: true,
  answerText: 'An answer.',
  answerMarkdown: null,
  errorCode: null,
  message: null,
  searches: 0,
  credits: 1,
  costMicros: 0,
  rawJson: null,
  sources: []
}
const TRACKED = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

/** A fake CiteFox AI: records each prompt and answers with `reply(prompt)`, else the fixture. */
function fakeClaude(prompts: string[], reply?: (prompt: string) => unknown): ClaudeProvider {
  return {
    id: 'claude-code',
    async complete(request: ClaudeCompletionRequest) {
      prompts.push(request.prompt)
      const json = reply?.(request.prompt) ?? topicFixtureReply(request.prompt)
      return {
        provider: 'claude-code',
        text: JSON.stringify(json),
        json,
        inputTokens: 10,
        outputTokens: 10,
        durationMs: 5,
        model: 'claude-sonnet-5-5',
        resolvedModel: 'claude-sonnet-5-5',
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0
        }
      } as Awaited<ReturnType<ClaudeProvider['complete']>>
    }
  }
}

/**
 * TextBolt with one tracked page, the seeded TextBolt topic (two Google checks with
 * own references) and ChatGPT answers on its latest check shaped like the real
 * textbolt project: an own source list plus the cited page.
 */
function seeded(reply?: (prompt: string) => unknown): {
  handlers: ReturnType<typeof harness>['handlers']
  prompts: string[]
  topicId: string
} {
  const prompts: string[] = []
  const h = harness({ claude: fakeClaude(prompts, reply) })
  insertProject(h.storage.db, {
    id: PROJECT,
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  projectsDirectory = h.storage.paths.projectsDirectory
  const db = createProjectDatabase(projectsDirectory, 'textbolt')
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames: ['TextBolt'],
    competitors: ['simpletexting.com'],
    market: {
      id: TEXTBOLT_TOPIC_MARKET,
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    }
  })
  insertPage(db, {
    id: 'page-alerts',
    projectId: PROJECT,
    url: TRACKED,
    title: 'How to set up text alerts for business',
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: TEXTBOLT_TOPIC_MARKET,
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  const record = getProject(h.storage.db, PROJECT)
  if (record === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(db, record)
  const setId = activePromptSetId(db, topicId)
  const promptIds = db
    .prepare<unknown[], { id: string }>(
      'SELECT id FROM prompts WHERE prompt_set_id = ? ORDER BY position'
    )
    .all(setId)
    .map((row) => row.id)
  const latest = db
    .prepare<unknown[], { id: string; finished_at: string }>(
      'SELECT id, finished_at FROM runs WHERE page_id = ? ORDER BY finished_at DESC LIMIT 1'
    )
    .get(topicId)
  if (latest === undefined) throw new Error('no run')
  for (const [index, promptId] of promptIds.slice(0, 6).entries()) {
    const cited = index < 4 ? `${TRACKED}?utm_source=chatgpt.com` : null
    insertEngineAnswer(db, {
      ...ANSWER,
      id: `ans-${index}`,
      runId: latest.id,
      promptId,
      status: cited === null ? (index === 5 ? 'error' : 'not_cited') : 'cited',
      citedUrl: cited,
      position: cited === null ? null : index + 1,
      named: cited !== null,
      checkedAt: latest.finished_at,
      sources:
        index === 1
          ? [
              {
                id: `src-${index}`,
                position: 9,
                url: 'https://www.textbolt.com/pricing/',
                normalizedUrl: 'https://textbolt.com/pricing',
                domain: 'textbolt.com',
                title: 'TextBolt pricing',
                classification: 'own'
              }
            ]
          : []
    })
  }
  closeProjectDatabase(db)
  return { handlers: h.handlers, prompts, topicId }
}

const ALERTS = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business'

describe('topics:targetSuggestions', () => {
  test('ranks own pages by the latest checks on every engine, and picks a clear winner', async () => {
    const { handlers, topicId, prompts } = seeded()
    const result = await handlers['topics:targetSuggestions']({ projectId: PROJECT, topicId })
    expect(prompts).toEqual([])
    expect(result.marketId).toBe(TEXTBOLT_TOPIC_MARKET)
    const [top, second] = result.suggestions
    // The tracked page, its ChatGPT citation with `?utm_source` and a trailing slash counted as the same page.
    expect(top).toMatchObject({
      url: ALERTS,
      title: 'How to set up text alerts for business',
      pageId: 'page-alerts',
      source: 'tracked',
      citedPrompts: 17,
      engines: [
        { engine: 'google_aio', prompts: 14 },
        { engine: 'chatgpt', prompts: 4 }
      ],
      bestPosition: 1
    })
    // A page only an answer cites: its source title, and `www.` merged.
    expect(second).toMatchObject({
      url: 'https://textbolt.com/pricing',
      title: 'TextBolt pricing',
      pageId: null,
      source: 'cited',
      citedPrompts: 4
    })
    const counts = result.suggestions.map((item) => item.citedPrompts)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(result.checkedPrompts).toBe(146)
    expect(result.citedPrompts).toBe(30)
    expect(result.noun).toBe('questions and keywords')
    expect(result.pick).toEqual({
      url: ALERTS,
      note: 'Picked because Google and ChatGPT already cite it for 17 of 146 questions and keywords'
    })
  })

  test('reads only the latest check per question and engine', async () => {
    const { handlers, topicId } = seeded()
    const before = await handlers['topics:targetSuggestions']({ projectId: PROJECT, topicId })
    expect(before.suggestions.some((item) => item.url.endsWith('/old-page'))).toBe(false)
    // The earlier check is the only ChatGPT check for its question: it counts. The same
    // earlier check for a question ChatGPT answered again later does not.
    addOlderAnswers(topicId)
    const after = await handlers['topics:targetSuggestions']({ projectId: PROJECT, topicId })
    const old = after.suggestions.find((item) => item.url === 'https://textbolt.com/old-page')
    expect(old).toMatchObject({ citedPrompts: 1, engines: [{ engine: 'chatgpt', prompts: 1 }] })
    expect(after.suggestions.find((item) => item.url.endsWith('/replaced-page'))).toBeUndefined()
  })

  test('a topic with no check has no suggestions and no pick', async () => {
    const { handlers, topicId } = seeded()
    const result = await handlers['topics:targetSuggestions']({
      projectId: PROJECT,
      topicId,
      marketId: 'mkt-other'
    })
    expect(result).toMatchObject({
      suggestions: [],
      checkedPrompts: 0,
      citedPrompts: 0,
      pick: null
    })
  })

  test('checks the request', async () => {
    const { handlers, topicId } = seeded()
    const invalid = /topics:(targetSuggestions|suggestTarget): Invalid request/u
    await expect(
      handlers['topics:targetSuggestions']({ projectId: PROJECT } as never)
    ).rejects.toThrow(invalid)
    await expect(
      handlers['topics:targetSuggestions']({ projectId: PROJECT, topicId, marketId: 7 } as never)
    ).rejects.toThrow(invalid)
    await expect(
      handlers['topics:targetSuggestions']({ projectId: PROJECT, topicId: 'page-alerts' })
    ).rejects.toThrow('That topic was not found')
    await expect(handlers['topics:suggestTarget']('topic' as never)).rejects.toThrow(invalid)
  })
})

/** Two ChatGPT answers on the topic's earlier check (see the test above). */
function addOlderAnswers(topicId: string): void {
  const db = openProjectDatabase(projectsDirectory, 'textbolt')
  const older = db
    .prepare<unknown[], { id: string; finished_at: string }>(
      'SELECT id, finished_at FROM runs WHERE page_id = ? ORDER BY finished_at ASC LIMIT 1'
    )
    .get(topicId)
  const setId = activePromptSetId(db, topicId)
  const ids = db
    .prepare<unknown[], { id: string }>(
      'SELECT id FROM prompts WHERE prompt_set_id = ? ORDER BY position'
    )
    .all(setId)
    .map((row) => row.id)
  if (older === undefined) throw new Error('no run')
  const answer = (index: number, url: string): void =>
    insertEngineAnswer(db, {
      ...ANSWER,
      id: `old-${index}`,
      runId: older.id,
      promptId: ids[index] ?? '',
      citedUrl: url,
      position: 2,
      checkedAt: older.finished_at
    })
  answer(0, 'https://textbolt.com/replaced-page')
  answer(8, 'https://textbolt.com/old-page/')
  closeProjectDatabase(db)
}

describe('topics:suggestTarget (fake CiteFox AI)', () => {
  test('sends the topic, its questions and the cited pages first; keeps listed picks only', async () => {
    const { handlers, topicId, prompts } = seeded((prompt) =>
      prompt.startsWith('Template: topic_target_suggest.md')
        ? {
            picks: [
              { url: `${ALERTS}/`, reason: ' Its title names this buyer problem. ' },
              { url: 'https://textbolt.com/not-a-page', reason: 'Made up.' },
              { url: 'https://textbolt.com/pricing', reason: 'Cited for price questions.' }
            ],
            newPage: null
          }
        : null
    )
    const result = await handlers['topics:suggestTarget']({ projectId: PROJECT, topicId })
    expect(prompts).toHaveLength(1)
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain('Topic: ')
    expect(prompt).toContain(
      `${ALERTS} · How to set up text alerts for business · no headings read · cited for 17 of 146 questions and keywords (Google 14, ChatGPT 4, best #1)`
    )
    expect(prompt.indexOf(ALERTS)).toBeLessThan(prompt.indexOf('https://textbolt.com/pricing'))
    expect(prompt).toMatch(/^Problem · /mu)
    expect(result.picks).toEqual([
      {
        url: ALERTS,
        title: 'How to set up text alerts for business',
        reason: 'Its title names this buyer problem.'
      },
      {
        url: 'https://textbolt.com/pricing',
        title: 'TextBolt pricing',
        reason: 'Cited for price questions.'
      }
    ])
    expect(result.dropped).toBe(1)
    expect(result.newPage).toBeNull()
    expect(result.info.searchesUsed).toBe(0)
  })

  test('asks again when every pick is off the list, then keeps the good reply', async () => {
    let calls = 0
    const { handlers, topicId, prompts } = seeded((prompt) => {
      if (!prompt.startsWith('Template: topic_target_suggest.md')) return null
      calls += 1
      return calls === 1
        ? { picks: [{ url: 'https://simpletexting.com/', reason: 'A rival.' }], newPage: null }
        : {
            picks: [],
            newPage: {
              title: 'Replacing a carrier email-to-text gateway',
              path: 'email-to-text-gateway-replacement/',
              about: 'What to switch to when a gateway shuts down.'
            }
          }
    })
    const result = await handlers['topics:suggestTarget']({ projectId: PROJECT, topicId })
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('None of the picked pages is in the candidate list')
    expect(result.picks).toEqual([])
    expect(result.newPage).toEqual({
      title: 'Replacing a carrier email-to-text gateway',
      path: '/email-to-text-gateway-replacement',
      about: 'What to switch to when a gateway shuts down.'
    })
  })

  test('the fixture reply (e2e stand-in) picks listed pages and matches the schema', async () => {
    const { handlers, topicId } = seeded()
    const result = await handlers['topics:suggestTarget']({ projectId: PROJECT, topicId })
    expect(result.picks.map((pick) => pick.url)).toEqual([ALERTS, 'https://textbolt.com/pricing'])
    expect(result.dropped).toBe(0)
  })
})

describe('target suggestion rules', () => {
  const suggestion = (
    url: string,
    citedPrompts: number
  ): Parameters<typeof targetPick>[0][number] => ({
    url,
    title: null,
    pageId: null,
    source: 'cited',
    citedPrompts,
    engines: [
      { engine: 'google_aio', prompts: citedPrompts },
      { engine: 'chatgpt', prompts: 1 },
      { engine: 'perplexity', prompts: 1 }
    ],
    bestPosition: 1
  })
  const totals = { checked: 12, cited: 8, noun: 'questions' }

  test('a pick needs half the citing prompts, a lead, and not the home page', () => {
    expect(targetPick([suggestion('https://textbolt.com/a', 4)], totals)?.note).toBe(
      'Picked because Google, ChatGPT and Perplexity already cite it for 4 of 12 questions'
    )
    expect(targetPick([suggestion('https://textbolt.com/a', 3)], totals)).toBeNull()
    expect(
      targetPick(
        [suggestion('https://textbolt.com/a', 4), suggestion('https://textbolt.com/b', 4)],
        totals
      )
    ).toBeNull()
    expect(targetPick([suggestion('https://textbolt.com/', 8)], totals)).toBeNull()
    expect(targetPick([], totals)).toBeNull()
  })

  test('engine lists and nouns read as plain English', () => {
    expect(engineList(['google_aio'])).toBe('Google')
    expect(engineList(['google_aio', 'chatgpt'])).toBe('Google and ChatGPT')
    expect(promptNoun(1, 0)).toBe('question')
    expect(promptNoun(12, 0)).toBe('questions')
    expect(promptNoun(0, 3)).toBe('keywords')
    expect(promptNoun(2, 3)).toBe('questions and keywords')
  })

  test('cleanTargetReply keeps listed pages once, at most three, and an own-site new page', () => {
    const candidates: TargetCandidate[] = ['a', 'b', 'c', 'd'].map((name) => ({
      url: `https://textbolt.com/${name}`,
      title: name.toUpperCase(),
      outline: [],
      cited: 'not cited yet'
    }))
    const pick = (url: string): { url: string; reason: string } => ({ url, reason: 'Fits.' })
    const cleaned = cleanTargetReply(
      {
        picks: [
          pick('https://www.textbolt.com/a/'),
          pick('https://textbolt.com/a'),
          pick('https://other.example/a'),
          pick('https://textbolt.com/b'),
          pick('https://textbolt.com/c'),
          pick('https://textbolt.com/d')
        ],
        newPage: { title: 'T', path: 'https://other.example/new', about: 'A.' }
      },
      candidates,
      'textbolt.com'
    )
    expect(cleaned.picks.map((item) => item.url)).toEqual([
      'https://textbolt.com/a',
      'https://textbolt.com/b',
      'https://textbolt.com/c'
    ])
    expect(cleaned.dropped).toBe(1)
    expect(cleaned.newPage).toBeNull()
    const listed = new Set(['textbolt.com/a'])
    expect(targetProblem({ picks: [pick('https://textbolt.com/a')], newPage: null }, listed)).toBe(
      null
    )
    expect(targetProblem({ picks: [], newPage: null }, listed)).toBeNull()
    expect(
      targetProblem(
        { picks: [pick('https://textbolt.com/a'), pick('https://textbolt.com/a/')], newPage: null },
        listed
      )
    ).toMatch(/picked twice/u)
  })
})
