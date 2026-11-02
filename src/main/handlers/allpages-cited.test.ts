import type { CitedPageRow, CheckProgress } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, envelope, seed } from '../engine/checks/checks.test-helper'
import { setPageStatus } from '../storage/pages'

const OWN = 'textbolt.com/blog/how-to-set-up-text-alerts-for-business'
const G2 = 'https://www.g2.com/categories/business-text-messaging'

afterEach(() => {
  closeSeeds()
})

/**
 * Both pages' prompts get the recorded overview (SimpleTexting, the TextBolt page,
 * Twilio) plus one review site nobody saved, so every class shows up.
 */
async function checked(): ReturnType<typeof seed> {
  const progress: CheckProgress[] = []
  const seeded = await seed({
    progress,
    secondPage: true,
    http(request) {
      const url = new URL(request.url)
      if (url.searchParams.get('engine') === 'google') return envelope('google-page-token.json')
      const recorded = envelope('google-ai-overview.json')
      const body = JSON.parse(recorded.body) as {
        ai_overview: { references: Array<Record<string, unknown>> }
      }
      body.ai_overview.references.push({
        title: 'Best Business Text Messaging Software',
        link: G2,
        source: 'G2',
        index: 3
      })
      return { status: recorded.status, body: JSON.stringify(body) }
    }
  })
  const job = await seeded.handlers['checks:start']({
    projectId: 'proj-1',
    pageIds: ['page-1', 'page-2'],
    marketIds: null,
    promptIds: null
  })
  expect(job.status).toBe('finished')
  return seeded
}

function byUrl(rows: readonly CitedPageRow[], part: string): CitedPageRow {
  const row = rows.find((item) => item.url.includes(part))
  if (row === undefined) throw new Error(`No row for ${part}`)
  return row
}

describe('allpages:citedPages', () => {
  test('lists every cited page in the latest checks with whose it is and what counts it', async () => {
    const { handlers } = await checked()
    const data = await handlers['allpages:citedPages']({ projectId: 'proj-1' })
    expect(data.ownDomain).toBe('textbolt.com')
    expect(data.checks).toBe(2)
    expect(data.questions).toBe(2)
    expect(data.checkedAt).not.toBeNull()
    expect(data.rows).toHaveLength(4)

    const own = byUrl(data.rows, OWN)
    expect(own.whose).toBe('yours')
    expect(own.competitor).toBeNull()
    // An own page carries the project's title for it, not the overview's.
    expect(own.title).toBe('Alerts')
    expect(own.domain).toBe('textbolt.com')

    const simple = byUrl(data.rows, 'simpletexting.com')
    expect(simple.whose).toBe('competitor')
    expect(simple.competitor).toBe('SimpleTexting')
    expect(simple.title).toBe('Text employees')
    const twilio = byUrl(data.rows, 'twilio.com')
    expect(twilio.whose).toBe('competitor')
    expect(twilio.domain).toBe('twilio.com')

    const g2 = byUrl(data.rows, 'g2.com')
    expect(g2.whose).toBe('other')
    expect(g2.competitor).toBeNull()

    for (const row of data.rows) {
      // Each prompt of each page cites it once: two questions, two overviews, one market.
      expect(row.questions.map((item) => item.id).sort()).toEqual([
        'page-1|prompt-1',
        'page-2|prompt-2b'
      ])
      expect(row.overviews).toHaveLength(2)
      expect(new Set(row.overviews.map((item) => item.id)).size).toBe(2)
      // Each overview names its question, which the row lists.
      for (const item of row.overviews) {
        expect(row.questions.map((question) => question.id)).toContain(item.questionId)
      }
      expect(row.marketIds).toEqual(['mkt-us'])
      // Ids are opaque: never the URL or the host.
      expect(row.id).toMatch(/^s[0-9a-f]{15}$/)
      expect(row.domainId).toMatch(/^s[0-9a-f]{15}$/)
      expect(row.id).not.toContain(row.domain)
    }
    expect(own.questions[0]).toMatchObject({
      pageKind: 'page',
      marketIds: ['mkt-us'],
      position: 2
    })
    const results = await handlers['results:get']({
      projectId: 'proj-1',
      pageId: 'page-1',
      marketId: null,
      runId: null
    })
    // The overview ids name the very check Results shows, so a question opens on it.
    expect(own.overviews.map((item) => item.runId)).toContain(results.run?.runId)
  })

  test('a removed page drops out; a saved competitor turns an other site into a competitor', async () => {
    const { handlers, projectDb } = await checked()
    setPageStatus(projectDb, 'page-2', 'removed', 'proj-1')
    await handlers['competitors:save']({
      projectId: 'proj-1',
      id: null,
      name: 'g2.com',
      domain: 'g2.com',
      aliases: [],
      tier: 'direct'
    })
    const data = await handlers['allpages:citedPages']({ projectId: 'proj-1' })
    expect(data.checks).toBe(1)
    expect(data.questions).toBe(1)
    const g2 = byUrl(data.rows, 'g2.com')
    expect(g2.whose).toBe('competitor')
    expect(g2.questions.map((item) => item.id)).toEqual(['page-1|prompt-1'])
    expect(g2.overviews).toHaveLength(1)
  })

  test('rejects a project id that is not a string', async () => {
    const { handlers } = await checked()
    await expect(
      handlers['allpages:citedPages']({ projectId: 3 } as unknown as { projectId: string })
    ).rejects.toThrow()
  })
})
