import type { AnswerEngineId, EngineAnswerStatus } from '@shared/domain'
import { openAppStorage } from '../../src/main/storage/app-storage'
import { insertEngineAnswer, saveEngineSettings } from '../../src/main/storage/engine-records'
import { closeProjectDatabase, openProjectDatabase } from '../../src/main/storage/project-files'
import { SEED, seedTwoMarketProject } from './screens-seed'

const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'

/** The ChatGPT answer to US prompt 1, as cloro returns it: markdown with a raw tag in it. */
export const CHATGPT_ANSWER =
  'You can alert a crew by **email to text**: each message goes to a phone number at the carrier gateway.\n\n' +
  '- Twilio needs a developer to set up.\n' +
  '- SimpleTexting sends from a web app.\n\n' +
  '<script>alert(1)</script>'

interface SeedAnswer {
  engine: AnswerEngineId
  promptId: string
  status: EngineAnswerStatus
  markdown?: string
  citedUrl?: string
  position?: number
  named?: boolean
  message?: string
  sources?: readonly {
    url: string
    domain: string
    title: string | null
    kind: 'target' | 'own' | 'competitor' | 'other'
  }[]
}

/** The latest US check: ChatGPT answers both prompts, Perplexity is down at cloro (MODEL_UNAVAILABLE). */
const LATEST: readonly SeedAnswer[] = [
  {
    engine: 'chatgpt',
    promptId: 'prompt-1',
    status: 'not_cited',
    markdown: CHATGPT_ANSWER,
    sources: [
      {
        url: 'https://www.twilio.com/docs/sms',
        domain: 'twilio.com',
        title: 'Twilio SMS docs',
        kind: 'competitor'
      },
      {
        url: 'https://simpletexting.com/features/',
        domain: 'simpletexting.com',
        title: null,
        kind: 'competitor'
      },
      {
        url: 'https://www.reddit.com/r/sysadmin/comments/crew_alerts/',
        domain: 'reddit.com',
        title: 'Crew alerts without a dev',
        kind: 'other'
      }
    ]
  },
  {
    engine: 'chatgpt',
    promptId: 'prompt-2',
    status: 'cited',
    markdown: 'TextBolt’s **Pro** plan covers scheduled texts.',
    citedUrl: PAGE_URL,
    position: 2,
    named: true,
    sources: [
      {
        url: 'https://simpletexting.com/pricing/',
        domain: 'simpletexting.com',
        title: 'Pricing',
        kind: 'competitor'
      },
      { url: PAGE_URL, domain: 'textbolt.com', title: 'Text alerts for business', kind: 'target' }
    ]
  },
  {
    engine: 'perplexity',
    promptId: 'prompt-1',
    status: 'unavailable',
    message: 'Perplexity is unavailable at cloro right now.'
  },
  {
    engine: 'perplexity',
    promptId: 'prompt-2',
    status: 'unavailable',
    message: 'Perplexity is unavailable at cloro right now.'
  }
]

/**
 * The two-market TextBolt project checking Google AI Overview, ChatGPT and Perplexity:
 * the recorded Google checks, then stored cloro answers on the same runs (no live calls).
 * ChatGPT gained prompt 2 since the check before.
 */
export async function seedEnginesProject(userDataDir: string): Promise<void> {
  await seedTwoMarketProject(userDataDir)
  const storage = openAppStorage(userDataDir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    saveEngineSettings(
      db,
      { engines: ['google_aio', 'chatgpt', 'perplexity'], provider: 'cloro' },
      '2026-10-19T12:00:00.000Z'
    )
    const runs = db
      .prepare<[string, string], { id: string; finished_at: string }>(
        `SELECT id, finished_at FROM runs WHERE page_id = ? AND market_id = ?
         ORDER BY started_at DESC, id DESC`
      )
      .all(SEED.pageId, SEED.us)
    const [latest, previous] = runs
    if (latest === undefined || previous === undefined) throw new Error('Seed needs two US checks')
    let sequence = 0
    const id = (prefix: string): string => {
      sequence += 1
      return `${prefix}-${sequence}`
    }
    const write = (runId: string, checkedAt: string, answer: SeedAnswer): void => {
      const unavailable = answer.status === 'unavailable'
      insertEngineAnswer(db, {
        id: id('ans'),
        runId,
        promptId: answer.promptId,
        sampleNo: 1,
        engine: answer.engine,
        keyId: null,
        status: answer.status,
        citedUrl: answer.citedUrl ?? null,
        position: answer.position ?? null,
        named: answer.named ?? false,
        answerText: answer.markdown ?? null,
        answerMarkdown: answer.markdown ?? null,
        errorCode: unavailable ? 'MODEL_UNAVAILABLE' : null,
        message: answer.message ?? null,
        searches: 1,
        credits: unavailable ? 0 : 7,
        costMicros: unavailable ? 0 : 5_600,
        rawJson: null,
        checkedAt,
        sources: (answer.sources ?? []).map((source, index) => ({
          id: id('src'),
          position: index + 1,
          url: source.url,
          normalizedUrl: source.url,
          domain: source.domain,
          title: source.title,
          classification: source.kind
        }))
      })
    }
    for (const answer of LATEST) write(latest.id, latest.finished_at, answer)
    write(previous.id, previous.finished_at, {
      engine: 'chatgpt',
      promptId: 'prompt-2',
      status: 'not_cited',
      markdown: 'SimpleTexting covers scheduled texts.',
      sources: []
    })
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}
