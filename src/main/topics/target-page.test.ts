import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, envelope, seed } from '../engine/checks/checks.test-helper'

afterEach(closeSeeds)

/**
 * A topic's target page (migration 047) through the real handlers and check engine:
 * recorded SerpApi fixtures, no network, no Claude. The fixture's overview cites
 * textbolt.com/blog/how-to-set-up-text-alerts-for-business/ (the seeded own domain).
 */
const CITED = 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business'
const BASE = { projectId: 'proj-1' }

async function seeded(): ReturnType<typeof seed> {
  return seed({
    progress: [],
    http(request) {
      return new URL(request.url).searchParams.get('engine') === 'google_ai_overview'
        ? envelope('google-ai-overview.json')
        : envelope('google-page-token.json')
    }
  })
}

type Handlers = Awaited<ReturnType<typeof seed>>['handlers']

async function startTopic(handlers: Handlers, productId?: string): Promise<string> {
  const draft = await handlers['topics:createDraft']({ ...BASE, path: 'questions', name: 'Crew' })
  if (productId !== undefined)
    await handlers['topics:updateDraft']({
      ...BASE,
      draftId: draft.id,
      patch: { product: { mode: 'pick', productId } }
    })
  await handlers['topics:importQuestions']({
    ...BASE,
    draftId: draft.id,
    text: 'How do I send an urgent text to my whole field crew from Outlook?'
  })
  const started = await handlers['topics:start']({ ...BASE, draftId: draft.id, plan: 'all_now' })
  const jobId = started.jobId ?? ''
  let job = await handlers['checks:get']({ jobId })
  for (let attempt = 0; attempt < 200 && (job === null || job.status === 'running'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    job = await handlers['checks:get']({ jobId })
  }
  expect(job?.status).toBe('finished')
  return started.topicId
}

async function promptStatus(handlers: Handlers, topicId: string): Promise<string | undefined> {
  const results = await handlers['results:get']({
    ...BASE,
    pageId: topicId,
    marketId: null,
    runId: null
  })
  return results.prompts[0]?.status
}

describe('a topic target page', () => {
  test('is set, counted as the target on the next check, and cleared', async () => {
    const { handlers } = await seeded()
    const topicId = await startTopic(handlers)
    // No target page: any own page cited for a topic is the cited page.
    expect(await promptStatus(handlers, topicId)).toBe('page_cited')
    const before = await handlers['topics:results']({
      ...BASE,
      topicId,
      marketId: null,
      runId: null
    })
    expect(before.topic.targetPage).toBeNull()
    expect(before.rows[0]?.state).toBe('right_page')

    await expect(
      handlers['topics:update']({ ...BASE, topicId, targetPage: 'https://simpletexting.com/x' })
    ).rejects.toThrow(/Use a page on textbolt\.com/)
    await handlers['topics:update']({
      ...BASE,
      topicId,
      targetPage: '/blog/how-to-set-up-text-alerts-for-business/'
    })
    const after = await handlers['topics:results']({
      ...BASE,
      topicId,
      marketId: null,
      runId: null
    })
    expect(after.topic.targetPage).toBe(CITED)
    // The saved result reads against the new target at once: no new search needed.
    expect(after.rows[0]?.targetUrl).toBe(CITED)
    expect(after.rows[0]?.state).toBe('right_page')

    const job = await handlers['checks:start']({
      ...BASE,
      pageIds: [topicId],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    expect(await promptStatus(handlers, topicId)).toBe('page_cited')

    await handlers['topics:update']({ ...BASE, topicId, targetPage: null })
    const cleared = await handlers['topics:results']({
      ...BASE,
      topicId,
      marketId: null,
      runId: null
    })
    expect(cleared.topic.targetPage).toBeNull()
    expect(cleared.rows[0]?.state).toBe('right_page')
  })

  test("starts as the topic's product page when the product has one", async () => {
    const { handlers } = await seeded()
    await handlers['products:save']({
      ...BASE,
      products: [
        {
          id: 'prod-alerts',
          name: 'Text alerts',
          job: 'text alerts for crews',
          buyer: 'Field teams',
          evidencePath: '/blog/how-to-set-up-text-alerts-for-business/'
        },
        { id: 'prod-home', name: 'Home', job: 'everything', buyer: 'Anyone', evidencePath: '/' }
      ],
      competitors: []
    })
    const withProduct = await startTopic(handlers, 'prod-alerts')
    const results = await handlers['topics:results']({
      ...BASE,
      topicId: withProduct,
      marketId: null,
      runId: null
    })
    expect(results.topic.targetPage).toBe(CITED)
    // The first check already counts the product page as the target.
    expect(await promptStatus(handlers, withProduct)).toBe('page_cited')

    const homeOnly = await startTopic(handlers, 'prod-home')
    const home = await handlers['topics:results']({
      ...BASE,
      topicId: homeOnly,
      marketId: null,
      runId: null
    })
    expect(home.topic.targetPage).toBeNull()
  })
})
