import type {
  FixMarketOutcome,
  FixPromptOutcome,
  FixPromptState,
  PromptCheckRow
} from '@shared/domain'
import {
  listStoredCheckRuns,
  listStoredRunsForJob,
  type StoredCheckRun
} from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import type { FixFollowUpRecord } from '../../storage/fix-follow-ups'
import { filterFor, isFullRun, loadPageResults } from '../checks/results'
import { otherPromptsMoved, promptResult, verdictFor } from './verdict'

/**
 * FR-14.7. Reads a fix's before and after checks per market, from stored runs
 * only (no searches). Prompt states come from `loadPageResults`, so each status
 * and position is the one Results shows for that check (NFR-14).
 *
 * - Before: the last full check in the market that finished before go-live.
 * - After: the fix's follow-up run in that market when it ran, else the first
 *   finished check (full or partial) that started at or after go-live.
 * - Others: non-targeted prompts between "before" and the first full check
 *   after go-live, which is the only kind that checks them.
 */
export interface OutcomeReader {
  outcomes(fix: FixFollowUpRecord): FixMarketOutcome[]
  /** The follow-up job's runs, from the job on the fix or the job of its run. */
  followUpRuns(fix: FixFollowUpRecord): StoredCheckRun[]
}

interface PromptMeta extends FixPromptState {
  promptPosition: number
  label: string
  text: string
}

export function outcomeReader(
  db: SqliteDatabase,
  projectId: string,
  domain: string,
  builtAt: string
): OutcomeReader {
  const states = new Map<string, Map<string, PromptMeta>>()
  const runsByMarket = new Map<string, StoredCheckRun[]>()

  function marketRuns(pageId: string, marketId: string): StoredCheckRun[] {
    const key = `${pageId}\0${marketId}`
    const cached = runsByMarket.get(key)
    if (cached !== undefined) return cached
    const runs = listStoredCheckRuns(db, filterFor(projectId, pageId, marketId)).filter(
      (run) => run.status === 'finished' && run.pageId === pageId && run.marketId === marketId
    )
    runsByMarket.set(key, runs)
    return runs
  }

  function stateOf(run: StoredCheckRun): Map<string, PromptMeta> {
    const cached = states.get(run.id)
    if (cached !== undefined) return cached
    const results = loadPageResults(db, {
      projectId,
      pageId: run.pageId,
      marketId: run.marketId,
      runId: run.id,
      builtAt,
      domain,
      keyLabels: new Map()
    })
    const map = new Map(results.prompts.map((row) => [row.promptId, metaOf(row)]))
    states.set(run.id, map)
    return map
  }

  function storedPrompt(promptId: string): Omit<PromptMeta, 'status' | 'position'> {
    const row = db
      .prepare<unknown[], { position: number; label: string; text: string | null }>(
        `SELECT prompts.position, prompts.label,
                (SELECT text FROM prompt_variants WHERE prompt_id = prompts.id
                 ORDER BY market_id ASC LIMIT 1) AS text
         FROM prompts WHERE prompts.id = ?`
      )
      .get(promptId)
    return {
      promptPosition: row?.position ?? Number.MAX_SAFE_INTEGER,
      label: row?.label ?? 'Prompt no longer in the set',
      text: row?.text ?? ''
    }
  }

  function followUpRuns(fix: FixFollowUpRecord): StoredCheckRun[] {
    const jobId = fix.followUpJobId ?? jobOfRun(db, fix.followUpRunId)
    if (jobId === null) return []
    // A fix's searches may be asked by its topics too: their runs count, its own page's first.
    const runs = listStoredRunsForJob(db, projectId, jobId).filter(
      (run) => run.status === 'finished'
    )
    return [
      ...runs.filter((run) => run.pageId === fix.pageId),
      ...runs.filter((run) => run.pageId !== fix.pageId)
    ]
  }

  function outcomes(fix: FixFollowUpRecord): FixMarketOutcome[] {
    const followUps = followUpRuns(fix)
    const targeted = new Set(fix.promptIds)
    return fix.marketIds.map((marketId) => {
      const runs = marketRuns(fix.pageId, marketId)
      const before =
        runs.filter((run) => isFullRun(run) && endOf(run) < fix.goLiveAt).at(-1) ?? null
      const after =
        followUps.find((run) => run.marketId === marketId) ??
        runs.find((run) => run.startedAt >= fix.goLiveAt) ??
        null
      const firstFullAfter =
        runs.find((run) => isFullRun(run) && run.startedAt >= fix.goLiveAt) ?? null
      const beforeStates = before === null ? new Map<string, PromptMeta>() : stateOf(before)
      const afterStates = after === null ? new Map<string, PromptMeta>() : stateOf(after)
      const prompts = fix.promptIds
        .map((promptId) => promptOutcome(promptId, beforeStates, afterStates, storedPrompt))
        .sort((left, right) => left.promptPosition - right.promptPosition)
      const count = verdictFor(
        prompts.map((prompt) => prompt.result),
        after !== null
      )
      const others =
        before === null || firstFullAfter === null
          ? null
          : {
              ...otherPromptsMoved(beforeStates, stateOf(firstFullAfter), targeted),
              fromRunId: before.id,
              toRunId: firstFullAfter.id
            }
      return {
        marketId,
        beforeRunId: before?.id ?? null,
        beforeAt: before === null ? null : endOf(before),
        afterRunId: after?.id ?? null,
        afterAt: after === null ? null : endOf(after),
        afterPartial: after?.partial ?? false,
        verdict: count.verdict,
        compared: count.compared,
        worked: count.worked,
        worse: count.worse,
        prompts,
        others
      }
    })
  }

  return { outcomes, followUpRuns }
}

function promptOutcome(
  promptId: string,
  before: ReadonlyMap<string, PromptMeta>,
  after: ReadonlyMap<string, PromptMeta>,
  stored: (promptId: string) => Omit<PromptMeta, 'status' | 'position'>
): FixPromptOutcome {
  const was = before.get(promptId) ?? null
  const now = after.get(promptId) ?? null
  const meta = now ?? was ?? stored(promptId)
  return {
    promptId,
    promptPosition: meta.promptPosition,
    label: meta.label,
    text: meta.text,
    before: was === null ? null : { status: was.status, position: was.position },
    after: now === null ? null : { status: now.status, position: now.position },
    result: promptResult(was, now)
  }
}

function metaOf(row: PromptCheckRow): PromptMeta {
  return {
    status: row.status,
    position: row.position,
    promptPosition: row.promptPosition,
    label: row.label,
    text: row.text
  }
}

function endOf(run: StoredCheckRun): string {
  return run.finishedAt ?? run.startedAt
}

function jobOfRun(db: SqliteDatabase, runId: string | null): string | null {
  if (runId === null) return null
  const row = db
    .prepare<unknown[], { job_id: string }>(`SELECT job_id FROM runs WHERE id = ?`)
    .get(runId)
  return row?.job_id ?? null
}
