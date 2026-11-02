import { openAppStorage } from '../../src/main/storage/app-storage'
import { createFixFollowUp } from '../../src/main/storage/fix-follow-ups'
import { insertIndexCheck } from '../../src/main/storage/fix-loop-records'
import { closeProjectDatabase, openProjectDatabase } from '../../src/main/storage/project-files'
import { seedEnginesProject } from './engines-seed'
import { SEED } from './screens-seed'

/**
 * The ready reports' project: the multi-engine TextBolt project (two Google checks with
 * movement, stored ChatGPT and Perplexity answers, two markets), plus two logged changes
 * so the Impact review has published pages: a rewrite of the tracked page, and a new
 * page Google has not indexed yet. No live calls.
 */
export async function seedImpactProject(userDataDir: string): Promise<void> {
  await seedEnginesProject(userDataDir)
  const storage = openAppStorage(userDataDir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  try {
    const promptIds = db
      .prepare<[string], { prompt_id: string }>(
        `SELECT DISTINCT prompt_id FROM serp_results r JOIN runs u ON u.id = r.run_id WHERE u.page_id = ?`
      )
      .all(SEED.pageId)
      .map((row) => row.prompt_id)
    createFixFollowUp(db, {
      id: 'fix-rewrite',
      pageId: SEED.pageId,
      description: 'Rewrote the intro and added a pricing table',
      goLiveAt: '2026-10-06T00:00:00.000Z',
      rule: 'after_7_days',
      promptIds,
      marketIds: [SEED.us],
      kind: 'rewrite'
    })
    createFixFollowUp(db, {
      id: 'fix-new',
      pageId: SEED.pageId,
      description: 'New page for schools',
      goLiveAt: '2026-10-16T00:00:00.000Z',
      rule: 'after_7_days',
      promptIds,
      marketIds: [SEED.us],
      kind: 'new_page',
      url: 'https://textbolt.com/textbolt-for-schools'
    })
    insertIndexCheck(db, {
      id: 'idx-new',
      pageId: SEED.pageId,
      url: 'https://textbolt.com/textbolt-for-schools',
      state: 'not_indexed',
      checkedAt: '2026-10-18T00:00:00.000Z',
      searches: 1,
      message: null
    })
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
}
