import { afterEach, describe, expect, test } from 'vitest'
import { addPageMarket } from '../../storage/pages'
import { insertMarket } from '../../storage/project-profile'
import { closeSeeds, envelope, NOW, seed } from './checks.test-helper'

afterEach(() => {
  closeSeeds()
})

/** `checks:notCited`: Check now's "Only questions not cited last time". */
describe('checks:notCited', () => {
  test('lists the questions the last check did not cite, follow-ups included', async () => {
    let cite = true
    const { handlers } = await seed({
      progress: [],
      secondPrompt: true,
      http: () => envelope(cite ? 'google-ai-overview.json' : 'google-competitor.json')
    })
    const start = (promptIds: string[] | null): ReturnType<(typeof handlers)['checks:start']> =>
      handlers['checks:start']({
        projectId: 'proj-1',
        pageIds: ['page-1'],
        marketIds: null,
        promptIds
      })
    const notCited = (
      marketIds: string[] | null = null
    ): ReturnType<(typeof handlers)['checks:notCited']> =>
      handlers['checks:notCited']({ projectId: 'proj-1', pageIds: ['page-1'], marketIds })

    // Before any check the page is listed as not checked, with nothing to re-check.
    expect(await notCited()).toEqual({
      pages: [{ pageId: 'page-1', promptIds: [], markets: [], checked: false }]
    })

    expect((await start(null)).status).toBe('finished')
    expect(await notCited()).toEqual({
      pages: [{ pageId: 'page-1', promptIds: [], markets: [], checked: true }]
    })

    cite = false
    expect((await start(null)).status).toBe('finished')
    expect((await notCited()).pages[0]).toEqual({
      pageId: 'page-1',
      promptIds: ['prompt-1', 'prompt-2'],
      markets: [{ marketId: 'mkt-us', promptIds: ['prompt-1', 'prompt-2'] }],
      checked: true
    })

    // A follow-up of one question that now cites the page takes it off the list.
    cite = true
    expect((await start(['prompt-1'])).status).toBe('finished')
    expect((await notCited()).pages[0]?.promptIds).toEqual(['prompt-2'])

    // A market the page does not have: nothing checked there.
    expect((await notCited(['mkt-elsewhere'])).pages[0]).toEqual({
      pageId: 'page-1',
      promptIds: [],
      markets: [],
      checked: false
    })
    expect((await notCited(['mkt-us'])).pages[0]?.promptIds).toEqual(['prompt-2'])
  })

  test('lists each market on its own, so a question cited in one market is not re-checked there', async () => {
    // US cites prompt-1 only; GB cites prompt-2 only.
    const citedIn: Record<string, string> = {
      us: 'How do I alert the crew?',
      uk: 'How do I reach the night shift?'
    }
    const { handlers, projectDb } = await seed({
      progress: [],
      secondPrompt: true,
      http(request) {
        const url = new URL(request.url)
        const cited = citedIn[url.searchParams.get('gl') ?? ''] === url.searchParams.get('q')
        return envelope(cited ? 'google-ai-overview.json' : 'google-competitor.json')
      }
    })
    insertMarket(projectDb, {
      id: 'mkt-gb',
      country: 'GB',
      language: 'en',
      location: null,
      device: 'desktop',
      localWording: false,
      serpapiLocation: null
    })
    addPageMarket(projectDb, {
      pageId: 'page-1',
      marketId: 'mkt-gb',
      addedAt: NOW,
      baselineRunId: null
    })
    const start = (
      marketIds: string[] | null,
      promptIds: string[] | null
    ): ReturnType<(typeof handlers)['checks:start']> =>
      handlers['checks:start']({ projectId: 'proj-1', pageIds: ['page-1'], marketIds, promptIds })
    const notCited = (
      marketIds: string[] | null
    ): ReturnType<(typeof handlers)['checks:notCited']> =>
      handlers['checks:notCited']({ projectId: 'proj-1', pageIds: ['page-1'], marketIds })

    expect((await start(null, null)).status).toBe('finished')
    expect((await notCited(null)).pages[0]).toEqual({
      pageId: 'page-1',
      promptIds: ['prompt-1', 'prompt-2'],
      markets: [
        { marketId: 'mkt-us', promptIds: ['prompt-2'] },
        { marketId: 'mkt-gb', promptIds: ['prompt-1'] }
      ],
      checked: true
    })
    // The chosen market only: the other market's misses stay out.
    expect((await notCited(['mkt-gb'])).pages[0]).toEqual({
      pageId: 'page-1',
      promptIds: ['prompt-1'],
      markets: [{ marketId: 'mkt-gb', promptIds: ['prompt-1'] }],
      checked: true
    })

    // A follow-up in GB that gets prompt-1 cited there leaves the US miss alone.
    citedIn.uk = 'How do I alert the crew?'
    expect((await start(['mkt-gb'], ['prompt-1'])).status).toBe('finished')
    expect((await notCited(null)).pages[0]?.markets).toEqual([
      { marketId: 'mkt-us', promptIds: ['prompt-2'] }
    ])
    expect((await notCited(['mkt-gb'])).pages[0]).toEqual({
      pageId: 'page-1',
      promptIds: [],
      markets: [],
      checked: true
    })
  })

  test('skips unknown pages and rejects malformed requests', async () => {
    const { handlers } = await seed({
      progress: [],
      http: () => envelope('google-ai-overview.json')
    })
    expect(
      await handlers['checks:notCited']({
        projectId: 'proj-1',
        pageIds: ['page-1', 'page-gone', 'page-1'],
        marketIds: null
      })
    ).toEqual({ pages: [{ pageId: 'page-1', promptIds: [], markets: [], checked: false }] })
    await expect(
      handlers['checks:notCited']({
        projectId: 'proj-1',
        pageIds: 'page-1',
        marketIds: null
      } as never)
    ).rejects.toThrow()
    await expect(
      handlers['checks:notCited']({
        projectId: 'proj-1',
        pageIds: ['page-1'],
        marketIds: null,
        extra: true
      } as never)
    ).rejects.toThrow()
    await expect(
      handlers['checks:notCited']({
        projectId: 'proj-1',
        pageIds: Array.from({ length: 5001 }, (_, index) => `page-${index}`),
        marketIds: null
      })
    ).rejects.toThrow()
  })
})
