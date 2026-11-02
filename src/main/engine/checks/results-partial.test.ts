import type { CheckFinishedNotice } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { getPage } from '../../storage/pages'
import { listStoredCheckRuns } from '../../storage/check-records'
import { closeSeeds, envelope, runFilter, seed } from './checks.test-helper'

afterEach(() => {
  closeSeeds()
})

/**
 * Section 7.4: a targeted follow-up (partial) run is kept out of headline totals.
 * The headline, the previous-check comparison, the score change, and the finish
 * notice use full runs only. The partial run is still readable by its run id.
 */
describe('partial follow-up runs', () => {
  test('a follow-up does not replace the headline, the page score, or the previous run', async () => {
    let cite = true
    const finished: CheckFinishedNotice[] = []
    const { handlers, projectDb } = await seed({
      progress: [],
      finished,
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
    const read = (runId: string | null): ReturnType<(typeof handlers)['results:get']> =>
      handlers['results:get']({ projectId: 'proj-1', pageId: 'page-1', marketId: null, runId })

    expect((await start(null)).status).toBe('finished')
    const baseline = await read(null)
    expect(baseline.run).toMatchObject({ kind: 'baseline', visibilityScore: 100, pageCited: 2 })

    cite = false
    expect((await start(['prompt-1'])).status).toBe('finished')
    const runs = listStoredCheckRuns(projectDb, runFilter())
    const followUp = runs.find((run) => run.partial)
    expect(followUp?.kind).toBe('follow_up')

    const headline = await read(null)
    expect(headline.run?.runId).toBe(baseline.run?.runId)
    expect(headline.run?.visibilityScore).toBe(100)
    expect(headline.scoreChange.sincePrevious).toBeNull()
    expect(getPage(projectDb, 'page-1', 'proj-1')?.score).toBe(100)
    const followNotice = finished.at(-1)
    expect(followNotice).toMatchObject({ score: 100, scoreChange: null, pageCitedChange: null })

    const partial = await read(followUp?.id ?? '')
    expect(partial.run).toMatchObject({ partial: true, promptsChecked: 1, pageCited: 0 })
    expect(partial.comparison.find((column) => column.which === 'previous')?.runId).toBe(
      baseline.run?.runId
    )

    expect((await start(null)).status).toBe('finished')
    const latest = await read(null)
    expect(latest.run).toMatchObject({ kind: 'manual', partial: false, visibilityScore: 0 })
    const previous = latest.comparison.find((column) => column.which === 'previous')
    expect(previous?.runId).toBe(baseline.run?.runId)
    expect(previous?.promptsChecked).toBe(2)
    expect(latest.scoreChange.sincePrevious).toBe(-100)
    expect(finished.at(-1)).toMatchObject({ score: 0, scoreChange: -100, pageCitedChange: -2 })
    expect(getPage(projectDb, 'page-1', 'proj-1')?.score).toBe(0)

    const pages = await handlers['scores:listPages']({ projectId: 'proj-1' })
    expect(pages.pages[0]?.change).toBe(-100)
    const projects = await handlers['scores:listProjects']()
    expect(projects.projects[0]?.change).toBe(-100)
  })

  test('the prompt detail drawer reads a partial run only when it is asked for', async () => {
    let cite = true
    const { handlers, projectDb } = await seed({
      progress: [],
      secondPrompt: true,
      http: () => envelope(cite ? 'google-ai-overview.json' : 'google-competitor.json')
    })
    await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    cite = false
    await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: ['prompt-1']
    })
    const followUp = listStoredCheckRuns(projectDb, runFilter()).find((run) => run.partial)
    const ask = (runId: string | null): ReturnType<(typeof handlers)['checks:getPrompt']> =>
      handlers['checks:getPrompt']({
        projectId: 'proj-1',
        pageId: 'page-1',
        promptId: 'prompt-1',
        marketId: null,
        runId
      })
    expect((await ask(null)).row?.status).toBe('page_cited')
    expect((await ask(followUp?.id ?? '')).row?.status).toBe('not_cited')
  })
})
