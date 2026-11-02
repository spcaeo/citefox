import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { ProjectCheck } from '@shared/ipc'
import type { SqliteDatabase } from '../storage/database'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const base = { projectId: PROGRESS_SEED.projectId }
const [ONE, TWO] = PROGRESS_SEED.prompts

describe('history:delete (Check history) on a test project file', () => {
  test('removes the check and everything saved for it; other checks, usage and the job stay', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    await seed.check(PROGRESS_SEED.second)
    const before = await seed.handlers['history:listProject'](base)
    expect(before.checks).toHaveLength(4)
    const target = usCheck(before.checks, PROGRESS_SEED.second)
    const kept = before.checks.filter((check) => check.runId !== target.runId)

    // A saved Claude read of one sample and a topic summary line point at the run too.
    withDb(seed, (db) => {
      const sample = db
        .prepare<unknown[], { id: string }>('SELECT id FROM serp_results WHERE run_id = ? LIMIT 1')
        .get(target.runId)!
      db.prepare(
        'INSERT INTO overview_reads (serp_result_id, read_json, ran_at) VALUES (?, ?, ?)'
      ).run(sample.id, '{}', PROGRESS_SEED.second)
      db.prepare(
        `INSERT INTO topic_summaries (id, page_id, market_id, run_id, line, executive, actions_json, created_at)
         VALUES ('sum-1', ?, ?, ?, 'A line.', '', '[]', ?)`
      ).run(PROGRESS_SEED.pageId, PROGRESS_SEED.us, target.runId, PROGRESS_SEED.second)
    })
    const usage = await seed.handlers['keys:list']()

    const deleted = await seed.handlers['history:delete']({ ...base, runId: target.runId })
    expect(deleted.runId).toBe(target.runId)
    expect(deleted.samples).toBeGreaterThanOrEqual(3)

    const after = await seed.handlers['history:listProject'](base)
    expect(after.checks.map((check) => check.runId)).toEqual(kept.map((check) => check.runId))
    // The kept checks' numbers did not move.
    expect(after.checks).toEqual(kept)
    // Results and the page History tab no longer show it.
    const page = await seed.handlers['history:list']({
      ...base,
      pageId: PROGRESS_SEED.pageId,
      marketId: PROGRESS_SEED.us
    })
    expect(page.events.some((event) => event.check?.runId === target.runId)).toBe(false)
    const latest = await seed.handlers['results:get']({
      ...base,
      pageId: PROGRESS_SEED.pageId,
      marketId: PROGRESS_SEED.us,
      runId: null
    })
    expect(latest.run?.runId).toBe(usCheck(before.checks, PROGRESS_SEED.first).runId)
    // Searches already used are not refunded.
    expect(await seed.handlers['keys:list']()).toEqual(usage)

    withDb(seed, (db) => {
      expect(referencesTo(db, target.runId)).toEqual([])
      expect(db.pragma('foreign_key_check')).toEqual([])
      const job = db
        .prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM check_jobs WHERE id = ?')
        .get(target.jobId)
      expect(job?.n).toBe(1)
    })
  })

  test('refuses a running check, an unknown check and a malformed request', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    const [check] = (await seed.handlers['history:listProject'](base)).checks
    withDb(seed, (db) => {
      db.prepare(`UPDATE runs SET status = 'running', finished_at = NULL WHERE id = ?`).run(
        check!.runId
      )
    })
    await expect(seed.handlers['history:delete']({ ...base, runId: check!.runId })).rejects.toThrow(
      /still running/
    )
    await expect(seed.handlers['history:delete']({ ...base, runId: 'run-nope' })).rejects.toThrow(
      /not found/
    )
    await expect(seed.handlers['history:delete']({ ...base, runId: '../x' })).rejects.toThrow()
    await expect(
      seed.handlers['history:delete']({ ...base, runId: check!.runId, extra: 1 } as never)
    ).rejects.toThrow()
    // Still there.
    const after = await seed.handlers['history:listProject'](base)
    expect(after.checks.some((item) => item.runId === check!.runId)).toBe(true)
  })

  test('a fix whose follow-up check is deleted waits for its follow-up again', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    seed.setClock('2026-10-08T09:00:00.000Z')
    const fix = await seed.handlers['fixes:create']({
      ...base,
      pageId: PROGRESS_SEED.pageId,
      description: 'Added a pricing FAQ.',
      goLiveAt: '2026-10-08T00:00:00.000Z',
      rule: 'after_3_days',
      promptIds: [TWO.id],
      marketIds: [PROGRESS_SEED.us]
    })
    seed.setClock('2026-10-12T09:00:00.000Z')
    await seed.handlers['fixes:runFollowUp']({ ...base, fixId: fix.id })
    const followUp = await waitForFollowUp(seed)
    const history = await seed.handlers['history:listProject'](base)
    const run = history.checks.find((check) => check.runId === followUp)!
    expect(run).toMatchObject({ kind: 'follow_up', partial: true, promptIds: [TWO.id] })

    await seed.handlers['history:delete']({ ...base, runId: followUp })
    const list = await seed.handlers['fixes:list']({ ...base, pageId: PROGRESS_SEED.pageId })
    expect(list.fixes[0]).toMatchObject({ status: 'planned', followUpRunId: null, verdict: null })
    withDb(seed, (db) => expect(referencesTo(db, followUp)).toEqual([]))
  })

  test('the ended check lists the questions it has no result for', async () => {
    const seed = open()
    await seed.check(PROGRESS_SEED.first)
    const [check] = (await seed.handlers['history:listProject'](base)).checks
    expect(check!.failedPromptIds).toEqual([])
    withDb(seed, (db) => {
      // Question 1 failed on every sample; question 2 was never saved.
      db.prepare(`UPDATE serp_results SET status = 'error' WHERE run_id = ? AND prompt_id = ?`).run(
        check!.runId,
        ONE.id
      )
      db.prepare(
        `DELETE FROM aio_references WHERE serp_result_id IN
           (SELECT id FROM serp_results WHERE run_id = ? AND prompt_id = ?)`
      ).run(check!.runId, TWO.id)
      db.prepare(`DELETE FROM serp_results WHERE run_id = ? AND prompt_id = ?`).run(
        check!.runId,
        TWO.id
      )
    })
    const after = (await seed.handlers['history:listProject'](base)).checks.find(
      (item) => item.runId === check!.runId
    )
    expect(after!.failedPromptIds).toEqual([ONE.id, TWO.id])
  })
})

function open(): ProgressSeed {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-history-delete-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  return seed
}

function usCheck(checks: readonly ProjectCheck[], startedAt: string): ProjectCheck {
  const found = checks.find(
    (check) =>
      check.marketId === PROGRESS_SEED.us && check.startedAt.slice(0, 10) === startedAt.slice(0, 10)
  )
  if (found === undefined) throw new Error(`No US check at ${startedAt}`)
  return found
}

function withDb(seed: ProgressSeed, run: (db: SqliteDatabase) => void): void {
  const db = openProjectDatabase(seed.storage.paths.projectsDirectory, 'textbolt')
  try {
    run(db)
  } finally {
    closeProjectDatabase(db)
  }
}

/**
 * Every row in the project file that still points at the run: any column named
 * `run_id` or ending in `_run_id`, the run row itself, and any `serp_result_id`
 * whose sample was gone with it.
 */
function referencesTo(db: SqliteDatabase, runId: string): string[] {
  const found: string[] = []
  const tables = db
    .prepare<unknown[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    .all()
  for (const { name } of tables) {
    const columns = db.prepare<unknown[], { name: string }>(`PRAGMA table_info("${name}")`).all()
    for (const column of columns) {
      const runColumn =
        (column.name === 'run_id' || column.name.endsWith('_run_id')) && name !== 'coverage_rows'
      if (runColumn && name !== 'coverage_findings') {
        const row = db
          .prepare<unknown[], { n: number }>(
            `SELECT COUNT(*) AS n FROM "${name}" WHERE "${column.name}" = ?`
          )
          .get(runId)
        if ((row?.n ?? 0) > 0) found.push(`${name}.${column.name}`)
      }
      if (column.name === 'serp_result_id') {
        const row = db
          .prepare<unknown[], { n: number }>(
            `SELECT COUNT(*) AS n FROM "${name}"
             WHERE "${column.name}" IS NOT NULL
               AND "${column.name}" NOT IN (SELECT id FROM serp_results)`
          )
          .get()
        if ((row?.n ?? 0) > 0) found.push(`${name}.${column.name}`)
      }
    }
  }
  const run = db
    .prepare<unknown[], { n: number }>('SELECT COUNT(*) AS n FROM runs WHERE id = ?')
    .get(runId)
  if ((run?.n ?? 0) > 0) found.push('runs.id')
  return found
}

async function waitForFollowUp(seed: ProgressSeed): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const list = await seed.handlers['fixes:list']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId
    })
    const runId = list.fixes[0]?.followUpRunId ?? null
    if (runId !== null) return runId
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('The follow-up did not finish')
}
