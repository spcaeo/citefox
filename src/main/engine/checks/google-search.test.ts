import { afterEach, describe, expect, test } from 'vitest'
import type { HttpRequest } from '../../providers/http'
import type { SqliteDatabase } from '../../storage/database'
import { closeSeeds, envelope, seed } from './checks.test-helper'
import { decodeGoogleExtras, googleExtrasFor, ownRank, rankQuestions } from './google-search'

afterEach(() => {
  closeSeeds()
})

const PAGE_URL = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
const SITE = { ownDomain: 'textbolt.com', includeSubdomains: false }

/** Google's search holds organic results and People also ask; the follow-up holds the overview. */
function recorded(request: HttpRequest): ReturnType<typeof envelope> {
  const engine = new URL(request.url).searchParams.get('engine')
  return envelope(engine === 'google' ? 'google-page-token-extras.json' : 'google-ai-overview.json')
}

function googleJson(db: SqliteDatabase): (string | null)[] {
  return db
    .prepare<unknown[], { google_json: string | null }>(
      'SELECT google_json FROM serp_results ORDER BY rowid'
    )
    .all()
    .map((row) => row.google_json)
}

describe('Google search extras from the stored search', () => {
  test('a check stores them, prompt detail shows the rank and People also ask', async () => {
    const { handlers, projectDb } = await seed({ progress: [], http: recorded })
    const job = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    const stored = googleJson(projectDb)
    expect(stored).toHaveLength(1)
    expect(decodeGoogleExtras(stored[0] ?? '').organic).toHaveLength(4)

    const detail = await handlers['checks:getPrompt']({
      projectId: 'proj-1',
      pageId: 'page-1',
      promptId: 'prompt-1',
      marketId: null,
      runId: null
    })
    expect(detail.google).toEqual({
      ownRank: { position: 3, url: PAGE_URL, thisPage: true },
      hasResults: true,
      // A buyer prompt needs 8 to 32 words, so the short one cannot be tracked as it is.
      questions: [
        { text: 'Can I send text alerts to employees for free?', trackable: true },
        { text: 'Which plan covers scheduled texts?', trackable: false },
        { text: 'How do I set up an emergency text alert system?', trackable: true },
        { text: 'What is the best mass texting service for small business?', trackable: true },
        { text: 'Is business texting legal?', trackable: false }
      ]
    })

    // Add questions' "Seen on Google" reads the same check.
    const seen = await handlers['prompts:googleQuestions']({
      projectId: 'proj-1',
      pageId: 'page-1'
    })
    expect(seen.questions).toHaveLength(5)

    // A question tracked since (any case or punctuation) is left out of both.
    await handlers['prompts:addQuestions']({
      projectId: 'proj-1',
      pageId: 'page-1',
      questions: [{ text: 'can i send text alerts to employees for free' }]
    })
    const after = await handlers['prompts:googleQuestions']({
      projectId: 'proj-1',
      pageId: 'page-1'
    })
    expect(after.questions).not.toContain('Can I send text alerts to employees for free?')
    expect(after.questions).toHaveLength(4)
    const again = await handlers['checks:getPrompt']({
      projectId: 'proj-1',
      pageId: 'page-1',
      promptId: 'prompt-1',
      marketId: null,
      runId: null
    })
    expect(again.google.questions.map((item) => item.text)).toEqual([
      'Which plan covers scheduled texts?',
      'How do I set up an emergency text alert system?',
      'What is the best mass texting service for small business?',
      'Is business texting legal?'
    ])
  })

  test('rows from before migration 044 are read from the raw search once, then kept', async () => {
    const { handlers, projectDb } = await seed({ progress: [], http: recorded })
    await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    // An old row: the extras were never read.
    projectDb.prepare('UPDATE serp_results SET google_json = NULL').run()
    const ask = (): ReturnType<(typeof handlers)['checks:getPrompt']> =>
      handlers['checks:getPrompt']({
        projectId: 'proj-1',
        pageId: 'page-1',
        promptId: 'prompt-1',
        marketId: null,
        runId: null
      })
    expect((await ask()).google.ownRank).toEqual({ position: 3, url: PAGE_URL, thisPage: true })
    const filled = googleJson(projectDb)[0]
    expect(filled).not.toBeNull()

    // Read once: a later change to the raw body is not parsed again.
    projectDb.prepare("UPDATE serp_results SET raw_search_json = '{}'").run()
    expect((await ask()).google.ownRank?.position).toBe(3)
    expect(googleJson(projectDb)[0]).toBe(filled)
  })

  test('a missing or cut-off raw search reads as no Google results, and is not read again', async () => {
    const { handlers, projectDb } = await seed({ progress: [], http: recorded })
    await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    const id =
      projectDb.prepare<unknown[], { id: string }>('SELECT id FROM serp_results').get()?.id ?? ''
    for (const raw of [null, '{"organic_results": [{"position": 1, "li']) {
      projectDb.prepare('UPDATE serp_results SET google_json = NULL, raw_search_json = ?').run(raw)
      const detail = await handlers['checks:getPrompt']({
        projectId: 'proj-1',
        pageId: 'page-1',
        promptId: 'prompt-1',
        marketId: null,
        runId: null
      })
      expect(detail.google).toEqual({ ownRank: null, hasResults: false, questions: [] })
      expect(googleJson(projectDb)[0]).toBe('{"organic":null,"questions":[]}')
      expect(googleExtrasFor(projectDb, [id]).get(id)).toEqual({ organic: null, questions: [] })
    }
  })

  test('back-fill handles many rows in one go and ignores unknown ids', async () => {
    const { handlers, projectDb } = await seed({ progress: [], http: recorded })
    await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    projectDb.prepare('UPDATE serp_results SET google_json = NULL').run()
    const id =
      projectDb.prepare<unknown[], { id: string }>('SELECT id FROM serp_results').get()?.id ?? ''
    const ids = [id, ...Array.from({ length: 900 }, (_, index) => `missing-${index}`)]
    const found = googleExtrasFor(projectDb, ids)
    expect([...found.keys()]).toEqual([id])
    expect(found.get(id)?.questions).toHaveLength(5)
  })
})

describe('own rank', () => {
  const list = [
    { position: 2, url: 'https://textbolt.com/pricing/', domain: 'textbolt.com' },
    { position: 5, url: PAGE_URL, domain: 'textbolt.com' }
  ]

  test('the best own result wins; another own page says so', () => {
    expect(ownRank([list], PAGE_URL, SITE)).toEqual({
      position: 2,
      url: 'https://textbolt.com/pricing/',
      thisPage: false
    })
  })

  test('this page wins a tie across samples, matched after normalising', () => {
    const other = [
      {
        position: 2,
        url: 'http://www.textbolt.com/blog/how-to-set-up-text-alerts-for-business',
        domain: 'textbolt.com'
      }
    ]
    expect(ownRank([list, other], PAGE_URL, SITE)).toMatchObject({ position: 2, thisPage: true })
  })

  test('subdomains count only when the project counts them; none is null', () => {
    const sub = [{ position: 1, url: 'https://help.textbolt.com/a', domain: 'help.textbolt.com' }]
    expect(ownRank([sub], PAGE_URL, SITE)).toBeNull()
    expect(ownRank([sub], PAGE_URL, { ...SITE, includeSubdomains: true })).toMatchObject({
      position: 1,
      thisPage: false
    })
    expect(ownRank([], PAGE_URL, SITE)).toBeNull()
  })
})

describe('People also ask across samples', () => {
  test('merges repeats, leaves tracked ones out, most asked first', () => {
    const questions = rankQuestions(
      [
        { organic: null, questions: ['Is it free?', 'How fast is it?', 'Does it work in the UK?'] },
        { organic: null, questions: ['how fast is it', 'Can I schedule texts?'] }
      ],
      ['Does it work in the UK'],
      3
    )
    expect(questions).toEqual(['How fast is it?', 'Is it free?', 'Can I schedule texts?'])
  })
})
