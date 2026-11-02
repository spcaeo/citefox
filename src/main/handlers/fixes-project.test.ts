import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { CoverageRecord } from '@shared/domain'
import { contentHash } from '../pipeline/hash'
import { insertCoverage } from '../storage/content-records'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const [ONE, TWO, THREE] = PROGRESS_SEED.prompts
const base = { projectId: PROGRESS_SEED.projectId }

async function checked(): Promise<ProgressSeed> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-fixes-project-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  await seed.check(PROGRESS_SEED.first)
  return seed
}

function withDb(
  seed: ProgressSeed,
  run: (db: ReturnType<typeof openProjectDatabase>) => void
): void {
  const db = openProjectDatabase(seed.storage.paths.projectsDirectory, 'textbolt')
  try {
    run(db)
  } finally {
    closeProjectDatabase(db)
  }
}

function gapRow(promptId: string, patch: Partial<CoverageRecord>): CoverageRecord {
  return {
    id: `row-${promptId}`,
    runId: 'cov-1',
    pageId: PROGRESS_SEED.pageId,
    promptId,
    coverage: 'weak',
    whereCovered: [],
    currentContent: 'Nothing on scheduling.',
    whatToUpdate: 'Add a scheduling FAQ.',
    mainGap: 'No scheduling answer.',
    priority: 'medium',
    actions: ['new_faq'],
    suggestedFaq: null,
    done: false,
    ...patch
  }
}

describe('fixes:listProject on a real project file', () => {
  test('lists every fix with its follow-up cost, and the open content gaps', async () => {
    const seed = await checked()
    const empty = await seed.handlers['fixes:listProject'](base)
    expect(empty).toMatchObject({ projectId: 'proj-1', subjects: [], fixes: [], suggestions: [] })
    expect(empty.markets.map((market) => market.id)).toEqual(['mkt-us', 'mkt-uk'])

    seed.setClock('2026-10-08T09:00:00.000Z')
    const created = await seed.handlers['fixes:create']({
      ...base,
      pageId: PROGRESS_SEED.pageId,
      description: 'Added a pricing FAQ.',
      goLiveAt: '2026-10-08T00:00:00.000Z',
      rule: 'after_3_days',
      promptIds: [TWO.id, THREE.id],
      marketIds: [PROGRESS_SEED.us, PROGRESS_SEED.uk]
    })
    withDb(seed, (db) => {
      insertCoverage(db, {
        runId: 'cov-1',
        pageId: PROGRESS_SEED.pageId,
        recordedAt: '2026-10-06T12:00:00.000Z',
        templateId: 'tpl-coverage',
        templateName: 'CiteFox default',
        templateHash: contentHash('coverage'),
        templateUpdatedAt: null,
        contentHash: contentHash('body'),
        reused: false,
        stale: false,
        rows: [
          // Marked done on Content gaps, so not a suggestion any more.
          gapRow(ONE.id, { done: true, priority: 'high' }),
          gapRow(TWO.id, { priority: 'medium' }),
          gapRow(THREE.id, { priority: 'high', coverage: 'none' })
        ],
        findings: []
      })
    })

    const list = await seed.handlers['fixes:listProject'](base)
    expect(list.subjects).toEqual([
      {
        id: PROGRESS_SEED.pageId,
        kind: 'page',
        label: expect.any(String),
        url: 'https://textbolt.com/blog/how-to-set-up-text-alerts-for-business/'
      }
    ])
    expect(list.fixes).toHaveLength(1)
    const [item] = list.fixes
    // The same fix `fixes:list` returns for the page.
    const page = await seed.handlers['fixes:list']({ ...base, pageId: PROGRESS_SEED.pageId })
    expect(item?.fix).toEqual(page.fixes[0])
    expect(item?.fix.id).toBe(created.id)
    // Two prompts × two markets × one sample, up to twice that.
    expect(item).toMatchObject({ searchesMin: 4, searchesMax: 8 })
    // Open gaps only (not strong, not done), high priority first, with the question.
    expect(list.suggestions.map((gap) => [gap.promptId, gap.priority])).toEqual([
      [THREE.id, 'high'],
      [TWO.id, 'medium']
    ])
    expect(list.suggestions[0]).toMatchObject({
      id: `row-${THREE.id}`,
      pageId: PROGRESS_SEED.pageId,
      promptLabel: THREE.label,
      promptText: THREE.text,
      coverage: 'none',
      actions: ['new_faq'],
      whatToUpdate: 'Add a scheduling FAQ.'
    })

    await seed.handlers['fixes:delete']({ ...base, fixId: created.id })
    expect((await seed.handlers['fixes:listProject'](base)).fixes).toEqual([])
    await expect(seed.handlers['fixes:listProject']({ projectId: 'nope' })).rejects.toThrow(
      'That project was not found'
    )
  })
})
