import { afterEach, describe, expect, test } from 'vitest'
import { cleanupHarness, harness } from '../../handlers/test-harness'
import type { ClaudeCompletionRequest, ClaudeProvider } from '../../providers/claude/claude-code'
import { readActivePrompts, type ActivePrompt } from '../../questions/reads'
import { insertPage } from '../../storage/pages'
import { closeProjectDatabase, createProjectDatabase } from '../../storage/project-files'
import { writeProjectProfile } from '../../storage/project-profile'
import { getProject, insertProject } from '../../storage/records'
import { projectDatabaseRelativePath } from '../../storage/slug'
import { topicFixtureReply } from '../fixture-replies'
import { seedTextboltTopic } from '../fixture-seed'
import {
  cleanIdeas,
  cleanProposals,
  cleanTopicName,
  NO_SAVED_DATA_MESSAGE,
  sortProblem,
  suggestProblem,
  TOPIC_NAME_MAX,
  type IdeaRules,
  type SortBatch
} from './ai'

afterEach(cleanupHarness)

const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const BRANDS = ['TextBolt', 'Text Bolt']

/** A question of the right shape that never names the brand. */
const QUESTION =
  'I run IT for a small clinic and our alarm emails go unseen at night; how can they reach the on-call phone as a text?'

function idea(
  name: string,
  questions: string[] = [QUESTION],
  fitsUrl: string | null = null
): {
  name: string
  situation: string
  example: string
  questions: { text: string; stage: 'problem' }[]
  fitsUrl: string | null
} {
  return {
    name,
    situation: ' Alerts reach email, not phones. ',
    example: 'send alerts as texts',
    questions: questions.map((text) => ({ text, stage: 'problem' })),
    fitsUrl
  }
}

const RULES: IdeaRules = {
  brandNames: BRANDS,
  ownUrls: [PAGE_URL, 'https://textbolt.com/pricing'],
  taken: ['Text alerts for teams without a developer', 'Cheaper alternative to Twilio for alerts'],
  createId: () => 'x'
}

describe('suggest: cleanIdeas', () => {
  test('drops brand questions, taken names and unlisted URLs; keeps at most four', () => {
    const ideas = cleanIdeas(
      {
        ideas: [
          idea('10DLC registration for small senders.', [
            QUESTION,
            'Is TextBolt good for 10DLC registration at a small dental office with one shared number?',
            'Does text bolt handle carrier registration for us if we have no developer on the team?'
          ]),
          // Taken (tracked topic), compared case-insensitively.
          idea('text alerts for teams without a developer'),
          // Already shown ("Suggest others").
          idea('Cheaper alternative to Twilio for alerts'),
          // Every question names the brand: nothing left to show.
          idea('Alarm texts for plants', [
            'Can TextBolt send our plant alarm emails as texts to the night crew phones?'
          ]),
          // The name names the brand.
          idea('TextBolt for clinics'),
          idea('Text alerts from monitoring tools', [QUESTION], `${PAGE_URL}?ref=x`.split('?')[0]),
          idea('Appointment reminders by text', [QUESTION], 'https://textbolt.com/pricing/'),
          idea('Closure alerts for schools', [QUESTION], 'https://other.example/page'),
          idea('One idea too many')
        ]
      },
      RULES
    )
    expect(ideas.map((item) => item.name)).toEqual([
      '10DLC registration for small senders',
      'Text alerts from monitoring tools',
      'Appointment reminders by text',
      'Closure alerts for schools'
    ])
    expect(ideas[0]?.questions).toEqual([{ text: QUESTION, stage: 'problem' }])
    expect(ideas[0]?.situation).toBe('Alerts reach email, not phones.')
    expect(ideas.map((item) => item.fitsUrl)).toEqual([
      null,
      PAGE_URL,
      'https://textbolt.com/pricing',
      null
    ])
    expect(ideas.every((item) => item.id === 'idea-x')).toBe(true)
  })

  test('caps questions at twelve and drops repeats; the same name twice shows once', () => {
    const many = Array.from({ length: 15 }, (_, index) => `${QUESTION} Case ${index + 1}.`)
    const ideas = cleanIdeas(
      { ideas: [idea('Night alerts', [...many, many[0] ?? '']), idea('night alerts')] },
      RULES
    )
    expect(ideas).toHaveLength(1)
    expect(ideas[0]?.questions).toHaveLength(12)
  })

  test('suggestProblem names the brand once, then repeats, else nothing', () => {
    expect(suggestProblem({ ideas: [idea('Alerts', ['Is TextBolt cheap?'])] }, RULES)).toMatch(
      /name the brand/u
    )
    expect(
      suggestProblem({ ideas: [idea('Cheaper alternative to Twilio for alerts')] }, RULES)
    ).toMatch(/Every idea repeats a tracked topic or one already shown: Cheaper alternative/u)
    // One repeat among new ideas is dropped by code, not asked again.
    expect(
      suggestProblem(
        { ideas: [idea('Cheaper alternative to Twilio for alerts'), idea('Night alerts')] },
        RULES
      )
    ).toBeNull()
  })
})

describe('sort: cleanProposals', () => {
  const question = (
    promptId: string,
    text: string
  ): { ref: { sourceId: string; promptId: string }; text: string } => ({
    ref: { sourceId: 'page-1', promptId },
    text
  })
  const batch = (allowNew: boolean): SortBatch => ({
    questions: new Map([
      ['q1', question('prompt-1', 'How do I alert the crew?')],
      ['q2', question('prompt-2', 'How do I reach the night shift?')],
      ['q3', question('prompt-3', 'What does it cost?')]
    ]),
    topics: new Map([
      ['t1', 'topic-a'],
      ['t2', 'topic-b']
    ]),
    allowNew,
    brandNames: BRANDS
  })

  test('maps back to the requested questions only; unknown topic ids become null', () => {
    const reply = {
      proposals: [
        { id: 'q2', topicId: 't2', newTopic: 'ignored', reason: ' Night shift. ' },
        { id: 'q1', topicId: 'topic-a', newTopic: null, reason: 'Real id, not listed.' },
        { id: 'q9', topicId: 't1', newTopic: null, reason: 'Not asked.' }
      ]
    }
    const proposals = cleanProposals(reply, batch(true))
    expect(proposals).toEqual([
      {
        sourceId: 'page-1',
        promptId: 'prompt-1',
        text: 'How do I alert the crew?',
        topicId: null,
        newTopic: null,
        reason: 'Real id, not listed.'
      },
      {
        sourceId: 'page-1',
        promptId: 'prompt-2',
        text: 'How do I reach the night shift?',
        topicId: 'topic-b',
        newTopic: null,
        reason: 'Night shift.'
      },
      {
        sourceId: 'page-1',
        promptId: 'prompt-3',
        text: 'What does it cost?',
        topicId: null,
        newTopic: null,
        reason: 'No topic was proposed for this question.'
      }
    ])
  })

  test('a new topic name only when allowed, trimmed, and never naming the brand', () => {
    const reply = {
      proposals: [
        { id: 'q1', topicId: null, newTopic: '  Crew alerts by text. ', reason: 'New.' },
        { id: 'q2', topicId: null, newTopic: 'TextBolt pricing', reason: 'Brand.' },
        { id: 'q3', topicId: 't1', newTopic: 'Also new', reason: 'Listed wins.' }
      ]
    }
    expect(cleanProposals(reply, batch(true)).map((item) => item.newTopic)).toEqual([
      'Crew alerts by text',
      null,
      null
    ])
    expect(cleanProposals(reply, batch(false)).map((item) => item.newTopic)).toEqual([
      null,
      null,
      null
    ])
  })

  test('sortProblem names a skipped question, then an invented topic id', () => {
    const one = { id: 'q1', topicId: 't1', newTopic: null, reason: 'r' }
    expect(sortProblem({ proposals: [one] }, batch(true))).toMatch(/missing: q2, q3/u)
    const all = ['q1', 'q2', 'q3'].map((id) => ({ ...one, id }))
    expect(sortProblem({ proposals: all }, batch(true))).toBeNull()
    expect(
      sortProblem({ proposals: [...all.slice(1), { ...one, topicId: 't7' }] }, batch(true))
    ).toMatch(/not listed: t7/u)
  })
})

describe('name: cleanTopicName', () => {
  test('one line, no trailing full stop, cut at a word to 80 characters', () => {
    expect(cleanTopicName('  Text alerts\nfrom monitoring tools.  ')).toBe(
      'Text alerts from monitoring tools'
    )
    const long = cleanTopicName(
      'Sending text alerts from monitoring tools like Datadog and Grafana to on-call engineers at night without a developer.'
    )
    expect(long.length).toBeLessThanOrEqual(TOPIC_NAME_MAX)
    expect(long).toBe(
      'Sending text alerts from monitoring tools like Datadog and Grafana to on-call'
    )
  })
})

// ---------------------------------------------------------------------------
// Through the handlers, with a fake Claude (never live Claude or SerpApi)
// ---------------------------------------------------------------------------

/** A fake Claude: records each prompt and answers with `reply(prompt)`, else the fixture. */
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

const MARKET = {
  id: 'mkt-us',
  country: 'US',
  language: 'en',
  location: null,
  device: 'desktop',
  localWording: false,
  serpapiLocation: null
} as const

/** A project file with its profile; returns the open database. */
function project(
  h: ReturnType<typeof harness>,
  slug: string,
  domain: string,
  brandNames: string[]
): ReturnType<typeof createProjectDatabase> {
  insertProject(h.storage.db, {
    id: `proj-${slug}`,
    name: slug,
    slug,
    domain,
    dbPath: projectDatabaseRelativePath(slug),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(h.storage.paths.projectsDirectory, slug)
  writeProjectProfile(db, {
    includeSubdomains: false,
    brandNames,
    competitors: ['simpletexting.com', 'twilio.com'],
    market: MARKET
  })
  return db
}

/**
 * TextBolt with one tracked page and the seeded TextBolt topic (its questions are the
 * ones to sort and name). Claude is the fake above; nothing is searched.
 */
function seeded(reply?: (prompt: string) => unknown): {
  handlers: ReturnType<typeof harness>['handlers']
  prompts: string[]
  topicId: string
  questions: ActivePrompt[]
} {
  const prompts: string[] = []
  const h = harness({ claude: fakeClaude(prompts, reply) })
  const db = project(h, 'textbolt', 'textbolt.com', BRANDS)
  insertPage(db, {
    id: 'page-setup',
    projectId: 'proj-textbolt',
    url: PAGE_URL,
    title: 'How to set up text alerts',
    label: null,
    folder: null,
    status: 'tracked',
    setupStep: null,
    intervalDays: 14,
    samples: 1,
    promptCount: 10,
    defaultMarketId: 'mkt-us',
    pinned: false,
    score: null,
    promptSetVersion: null
  })
  const record = getProject(h.storage.db, 'proj-textbolt')
  if (record === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(db, record)
  const questions = readActivePrompts(db, 'mkt-us').filter(
    (prompt) => prompt.pageId === topicId && prompt.kind === 'question'
  )
  closeProjectDatabase(db)
  return { handlers: h.handlers, prompts, topicId, questions }
}

const firstLine = (prompt: string): string => prompt.split('\n', 1)[0] ?? ''

const TOPIC_NAME = 'Text alerts for teams without a developer'

describe('topics:suggestTopics', () => {
  test('asks once from saved data and leaves out tracked and already-shown topics', async () => {
    const { handlers, prompts } = seeded()
    const result = await handlers['topics:suggestTopics']({
      projectId: 'proj-textbolt',
      avoid: ['Cheaper alternative to Twilio for alerts']
    })
    expect(prompts.map(firstLine)).toEqual(['Template: topic_cluster_suggest.md'])
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain(
      `Topics already tracked. Never suggest one of these or a near copy:\n- ${TOPIC_NAME}`
    )
    expect(prompt).toContain(
      'Ideas already shown. Suggest different ones:\n- Cheaper alternative to Twilio for alerts'
    )
    expect(prompt).toContain(`${PAGE_URL} · `)
    expect(prompt).toContain('Direct competitors of this business')
    expect(prompt).toContain('Market: United States (English)')
    expect(prompt).toContain('The names to leave out are: TextBolt; aliases: Text Bolt.')
    expect(prompt).not.toContain('{{')
    expect(result.message).toBeNull()
    expect(result.info?.searchesUsed).toBe(0)
    expect(result.ideas.map((item) => item.name)).toEqual([
      '10DLC registration for small senders',
      'Text alerts from monitoring tools',
      'Appointment reminders by text for small clinics'
    ])
    expect(result.ideas[1]?.fitsUrl).toBe(PAGE_URL)
    expect(result.ideas.every((item) => /^idea-.+/u.test(item.id))).toBe(true)
    expect(result.ideas.every((item) => item.questions.length >= 8)).toBe(true)
  })

  test('a reply naming the brand is asked again once, then its brand questions are dropped', async () => {
    const branded = {
      ideas: [
        idea('Night alerts for small IT teams', [
          QUESTION,
          'Can TextBolt send our server alerts to the on-call phone at night without a developer?',
          `${QUESTION} We have two sites.`,
          `${QUESTION} We use Grafana.`
        ])
      ]
    }
    const { handlers, prompts } = seeded((prompt) =>
      prompt.startsWith('Template: topic_cluster_suggest.md') ? branded : null
    )
    const result = await handlers['topics:suggestTopics']({ projectId: 'proj-textbolt' })
    expect(prompts).toHaveLength(2)
    expect(result.ideas.map((item) => item.questions.map((q) => q.text))).toEqual([
      [QUESTION, `${QUESTION} We have two sites.`, `${QUESTION} We use Grafana.`]
    ])
  })

  test('with no products and no pages it says what to add and asks nothing', async () => {
    const prompts: string[] = []
    const h = harness({ claude: fakeClaude(prompts) })
    closeProjectDatabase(project(h, 'empty', 'empty.example', ['Empty']))
    const result = await h.handlers['topics:suggestTopics']({ projectId: 'proj-empty' })
    expect(result).toEqual({ ideas: [], info: null, message: NO_SAVED_DATA_MESSAGE })
    expect(prompts).toEqual([])
  })
})

describe('topics:sortQuestions', () => {
  test('sorts only the active questions asked for into the listed topics', async () => {
    const { handlers, prompts, topicId, questions } = seeded()
    const [first, second] = questions
    if (first === undefined || second === undefined) throw new Error('seed has no questions')
    const result = await handlers['topics:sortQuestions']({
      projectId: 'proj-textbolt',
      items: [
        { sourceId: topicId, promptId: second.id },
        { sourceId: topicId, promptId: 'gone' },
        { sourceId: 'page-setup', promptId: first.id },
        { sourceId: topicId, promptId: first.id },
        { sourceId: topicId, promptId: second.id }
      ],
      candidates: [
        { id: 'topic-a', name: 'Monitoring alerts', situation: 'Alerts reach email only.' },
        { id: 'topic-b', name: 'Reminders', situation: 'Clinics.' }
      ]
    })
    expect(prompts.map(firstLine)).toEqual(['Template: topic_cluster_sort.md'])
    const prompt = prompts[0] ?? ''
    expect(prompt).toContain('t1 · Monitoring alerts: Alerts reach email only.')
    expect(prompt).toContain('t2 · Reminders: Clinics.')
    expect(prompt).toContain(`q1 · ${second.text}`)
    expect(prompt).toContain(`q2 · ${first.text}`)
    expect(prompt).not.toContain('topic-a')
    expect(prompt).not.toContain('q3 · ')
    expect(result.proposals.map((item) => [item.promptId, item.text, item.topicId])).toEqual([
      [second.id, second.text, 'topic-a'],
      [first.id, first.text, 'topic-a']
    ])
    expect(result.proposals.every((item) => item.newTopic === null)).toBe(true)
  })

  test('with no candidates the tracked topics are offered; an unknown id becomes null', async () => {
    const { handlers, prompts, topicId, questions } = seeded((prompt) =>
      prompt.startsWith('Template: topic_cluster_sort.md')
        ? { proposals: [{ id: 'q1', topicId: 't9', newTopic: 'Crew alerts', reason: 'Made up.' }] }
        : null
    )
    const question = questions[0]
    if (question === undefined) throw new Error('seed has no questions')
    const result = await handlers['topics:sortQuestions']({
      projectId: 'proj-textbolt',
      items: [{ sourceId: topicId, promptId: question.id }],
      allowNew: false
    })
    // The invented id is named back once, then dropped.
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain(`t1 · ${TOPIC_NAME}`)
    expect(prompts[0]).toContain('- newTopic: always null')
    expect(prompts[0]).not.toContain(topicId)
    expect(result.proposals).toEqual([
      {
        sourceId: topicId,
        promptId: question.id,
        text: question.text,
        topicId: null,
        newTopic: null,
        reason: 'Made up.'
      }
    ])
  })

  test('a tracked topic id maps back; with no candidates a new topic is proposed', async () => {
    const { handlers, topicId, questions } = seeded()
    const question = questions[0]
    if (question === undefined) throw new Error('seed has no questions')
    const tracked = await handlers['topics:sortQuestions']({
      projectId: 'proj-textbolt',
      items: [{ sourceId: topicId, promptId: question.id }]
    })
    expect(tracked.proposals.map((item) => item.topicId)).toEqual([topicId])
    const fresh = await handlers['topics:sortQuestions']({
      projectId: 'proj-textbolt',
      items: [{ sourceId: topicId, promptId: question.id }],
      candidates: []
    })
    expect(fresh.proposals.map((item) => [item.topicId, item.newTopic])).toEqual([
      [null, 'Text alerts from monitoring tools']
    ])
  })

  test('nothing to sort into and no new topics: no call, every proposal null', async () => {
    const { handlers, prompts, topicId, questions } = seeded()
    const question = questions[0]
    if (question === undefined) throw new Error('seed has no questions')
    const result = await handlers['topics:sortQuestions']({
      projectId: 'proj-textbolt',
      items: [{ sourceId: topicId, promptId: question.id }],
      candidates: [],
      allowNew: false
    })
    expect(prompts).toEqual([])
    expect(result.proposals.map((item) => item.topicId)).toEqual([null])
    expect(result.info.durationMs).toBe(0)
  })
})

describe('topics:suggestName', () => {
  test('names the questions with a trimmed name and a one-line situation', async () => {
    const { handlers, prompts, topicId, questions } = seeded((prompt) =>
      prompt.startsWith('Template: topic_cluster_name.md')
        ? {
            name: 'Getting urgent alerts to field crews and night shift staff by text message when nobody watches email.',
            situation: 'Crews miss alerts.\nThey need texts.'
          }
        : null
    )
    const [first, second] = questions
    if (first === undefined || second === undefined) throw new Error('seed has no questions')
    const result = await handlers['topics:suggestName']({
      projectId: 'proj-textbolt',
      items: [
        { sourceId: topicId, promptId: first.id },
        { sourceId: topicId, promptId: second.id }
      ]
    })
    expect(prompts.map(firstLine)).toEqual(['Template: topic_cluster_name.md'])
    expect(prompts[0]).toContain(`- ${first.text}`)
    expect(prompts[0]).toContain(`- ${second.text}`)
    expect(result.name.length).toBeLessThanOrEqual(TOPIC_NAME_MAX)
    expect(result.name).toBe(
      'Getting urgent alerts to field crews and night shift staff by text message when'
    )
    expect(result.situation).toBe('Crews miss alerts. They need texts.')
    expect(result.info.searchesUsed).toBe(0)
  })

  test('questions no longer tracked get a plain error and no call', async () => {
    const { handlers, prompts, topicId } = seeded()
    await expect(
      handlers['topics:suggestName']({
        projectId: 'proj-textbolt',
        items: [{ sourceId: topicId, promptId: 'gone' }]
      })
    ).rejects.toThrow(/None of the picked questions are tracked any more/u)
    expect(prompts).toEqual([])
  })
})
