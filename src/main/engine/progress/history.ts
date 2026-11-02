import type {
  CheckRunKind,
  ContentDiff,
  HistoryContentChange,
  HistoryEvent,
  HistoryEventKind,
  PageHistory,
  TrendPoint
} from '@shared/domain'
import { pluralize } from '@shared/pluralize'
import { listStoredCheckRuns, type StoredCheckRun } from '../../storage/check-records'
import type { SqliteDatabase } from '../../storage/database'
import { listFixFollowUps } from '../../storage/fix-follow-ups'
import { listNotes } from '../../storage/notes'
import { getPage } from '../../storage/pages'
import { getStoredSnapshot } from '../../storage/snapshot-records'
import { contentChangeBetween } from '../checks/score'
import { CheckInputError, filterFor, loadResultsHistory } from '../checks/results'
import { diffSnapshots, facts } from './content-diff'
import { scoreChanges } from './score-change'

/**
 * FR-15.1, FR-15.2, FR-7.3. One page's history, newest first: checks in one
 * market (score and change), page content changes, prompt-set versions, fixes,
 * and notes. Scores are `results:history` points, so they equal Results.
 * A content change that a check read is folded into that check's entry.
 */
export interface HistoryInput {
  projectId: string
  pageId: string
  marketId: string | null
  builtAt: string
  domain: string
}

export function buildPageHistory(db: SqliteDatabase, input: HistoryInput): PageHistory {
  const page = getPage(db, input.pageId, input.projectId)
  if (page === null) throw new CheckInputError('That page is not in this project')
  const marketId = input.marketId ?? page.defaultMarketId
  const events: HistoryEvent[] = []
  const snapshots = listSnapshotStamps(db, page.id)
  const changes = contentChanges(db, snapshots)
  const folded = new Set<string>()
  if (marketId !== null) {
    events.push(...checkEvents(db, input, marketId, changes, folded))
  }
  for (const change of changes) {
    if (folded.has(change.toSnapshotId)) continue
    events.push(contentEvent(change))
  }
  events.push(...promptSetEvents(db, page.id))
  events.push(...fixEvents(db, page.id, input.builtAt))
  events.push(...noteEvents(db, page.id))
  events.sort(newestFirst)
  return { pageId: page.id, marketId: marketId ?? '', builtAt: input.builtAt, events }
}

/** FR-15.1 "Compare content". Both reads must belong to the page. */
export function compareSnapshots(
  db: SqliteDatabase,
  pageId: string,
  fromSnapshotId: string,
  toSnapshotId: string
): ContentDiff {
  const from = getStoredSnapshot(db, fromSnapshotId)
  const to = getStoredSnapshot(db, toSnapshotId)
  if (from === null || to === null || from.pageId !== pageId || to.pageId !== pageId) {
    throw new CheckInputError('Those page reads were not found')
  }
  return diffSnapshots(pageId, from, to)
}

interface SnapshotStamp {
  id: string
  fetchedAt: string
  contentHash: string
  modifiedAt: string | null
}

interface ContentChangeAt extends HistoryContentChange {
  at: string
}

function listSnapshotStamps(db: SqliteDatabase, pageId: string): SnapshotStamp[] {
  return db
    .prepare<
      unknown[],
      { id: string; fetched_at: string; content_hash: string; modified_at: string | null }
    >(
      `SELECT id, fetched_at, content_hash, modified_at FROM snapshots
       WHERE page_id = ? ORDER BY fetched_at ASC, rowid ASC`
    )
    .all(pageId)
    .map((row) => ({
      id: row.id,
      fetchedAt: row.fetched_at,
      contentHash: row.content_hash,
      modifiedAt: row.modified_at
    }))
}

/** The first read, then every read whose content hash differs from the read before it. */
function contentChanges(
  db: SqliteDatabase,
  snapshots: readonly SnapshotStamp[]
): ContentChangeAt[] {
  const changes: ContentChangeAt[] = []
  let previous: SnapshotStamp | null = null
  for (const snapshot of snapshots) {
    if (previous === null) {
      const first = getStoredSnapshot(db, snapshot.id)
      changes.push({
        at: snapshot.fetchedAt,
        summary:
          first === null
            ? 'First read of the page.'
            : `First read of the page: ${pluralize(first.wordCount, 'word')}, ${pluralize(first.faqs.length, 'FAQ')}.`,
        fromSnapshotId: null,
        toSnapshotId: snapshot.id,
        modifiedAt: snapshot.modifiedAt
      })
    } else if (previous.contentHash !== snapshot.contentHash) {
      const before = getStoredSnapshot(db, previous.id)
      const after = getStoredSnapshot(db, snapshot.id)
      changes.push({
        at: snapshot.fetchedAt,
        summary:
          before === null || after === null
            ? 'The page content changed.'
            : contentChangeBetween(facts(before), facts(after)).summary,
        fromSnapshotId: previous.id,
        toSnapshotId: snapshot.id,
        modifiedAt: snapshot.modifiedAt
      })
    }
    previous = snapshot
  }
  return changes
}

function checkEvents(
  db: SqliteDatabase,
  input: HistoryInput,
  marketId: string,
  changes: readonly ContentChangeAt[],
  folded: Set<string>
): HistoryEvent[] {
  const runs = listStoredCheckRuns(db, filterFor(input.projectId, input.pageId, marketId)).filter(
    (run) => run.status === 'finished' && run.pageId === input.pageId && run.marketId === marketId
  )
  const points = new Map(
    loadResultsHistory(db, { ...input, marketId }).points.map((point) => [point.runId, point])
  )
  const fixByJob = followUpFixNumbers(db, input.pageId)
  const scoreChangeOf = scoreChanges(
    runs.flatMap((run) => {
      const point = points.get(run.id)
      return point === undefined
        ? []
        : [
            {
              id: run.id,
              promptSetId: run.promptSetId,
              partial: run.partial,
              score: point.visibilityScore
            }
          ]
    })
  )
  let seenCheck = false
  const events: HistoryEvent[] = []
  for (const run of runs) {
    const point = points.get(run.id)
    if (point === undefined) continue
    const scoreChange = scoreChangeOf.get(run.id) ?? null
    const contentChanged = seenCheck ? point.contentChanged : null
    seenCheck = true
    const change =
      contentChanged === true
        ? (changes.find(
            (item) => item.toSnapshotId === run.snapshotId && !folded.has(item.toSnapshotId)
          ) ?? null)
        : null
    if (change !== null) folded.add(change.toSnapshotId)
    const kinds: HistoryEventKind[] = change === null ? ['check'] : ['check', 'content']
    events.push({
      id: `check:${run.id}`,
      primary: 'check',
      kinds,
      at: run.finishedAt ?? run.startedAt,
      title: checkTitle(run.kind, fixByJob.get(run.jobId) ?? null),
      detail: checkDetail(run, point),
      check: {
        runId: run.id,
        marketId,
        kind: run.kind,
        partial: run.partial,
        promptsChecked: point.promptsChecked,
        promptsTotal: point.promptsTotal,
        score: point.visibilityScore,
        scoreChange,
        promptSetVersion: point.promptSetVersion,
        contentChanged
      },
      content: change === null ? null : withoutAt(change),
      note: null,
      fix: null,
      promptSet: null
    })
  }
  return events
}

function checkTitle(kind: CheckRunKind, fixNumber: number | null): string {
  if (kind === 'baseline') return 'Baseline check'
  if (kind === 'scheduled') return 'Scheduled check'
  if (kind === 'manual') return 'Manual check'
  return fixNumber === null ? 'Follow-up check' : `Follow-up check for Fix ${fixNumber}`
}

function checkDetail(run: StoredCheckRun, point: TrendPoint): string {
  const checked = `${point.promptsChecked} of ${pluralize(point.promptsTotal, 'prompt')}`
  if (run.partial) return `Partial check · ${checked} · left out of the trend line`
  if (run.kind === 'baseline' && point.promptSetVersion !== null) {
    return `First check with prompt set v${point.promptSetVersion} · ${checked}`
  }
  return `${checked} checked`
}

function contentEvent(change: ContentChangeAt): HistoryEvent {
  return {
    id: `content:${change.toSnapshotId}`,
    primary: 'content',
    kinds: ['content'],
    at: change.at,
    title: change.fromSnapshotId === null ? 'Page read' : 'Page content changed',
    detail: change.summary,
    check: null,
    content: withoutAt(change),
    note: null,
    fix: null,
    promptSet: null
  }
}

function promptSetEvents(db: SqliteDatabase, pageId: string): HistoryEvent[] {
  return db
    .prepare<
      unknown[],
      { id: string; version: number; saved_at: string; is_active: number; prompt_count: number }
    >(
      `SELECT prompt_sets.id, prompt_sets.version, prompt_sets.saved_at, prompt_sets.is_active,
              (SELECT COUNT(*) FROM prompts WHERE prompts.prompt_set_id = prompt_sets.id) AS prompt_count
       FROM prompt_sets WHERE prompt_sets.page_id = ?`
    )
    .all(pageId)
    .map((row) => ({
      id: `prompt_set:${row.id}`,
      primary: 'prompt_set' as const,
      kinds: ['prompt_set' as const],
      at: row.saved_at,
      title: `Question set v${row.version} saved`,
      detail: `${pluralize(row.prompt_count, 'prompt')}${row.is_active === 1 ? ' · in use now' : ''}. The next full check in each market starts a new baseline.`,
      check: null,
      content: null,
      note: null,
      fix: null,
      promptSet: {
        id: row.id,
        version: row.version,
        promptCount: row.prompt_count,
        active: row.is_active === 1
      }
    }))
}

function fixEvents(db: SqliteDatabase, pageId: string, builtAt: string): HistoryEvent[] {
  const positions = promptPositions(db, pageId)
  return listFixFollowUps(db, pageId).map((fix) => {
    const numbers = fix.promptIds
      .map((id) => positions.get(id))
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b)
    const planned = fix.goLiveAt > builtAt
    const state =
      fix.verdict ??
      (planned
        ? 'Goes live then'
        : fix.followUpRunId === null
          ? 'Follow-up check planned'
          : 'Follow-up checked')
    return {
      id: `fix:${fix.id}`,
      primary: 'fix' as const,
      kinds: ['fix' as const],
      at: fix.goLiveAt,
      title: `Fix ${fix.number} · ${firstLine(fix.description)}`,
      detail: `${targets(numbers)} · ${state}`,
      check: null,
      content: null,
      note: null,
      fix: {
        id: fix.id,
        number: fix.number,
        verdict: fix.verdict,
        planned,
        promptPositions: numbers
      },
      promptSet: null
    }
  })
}

function noteEvents(db: SqliteDatabase, pageId: string): HistoryEvent[] {
  return listNotes(db, pageId).map((note) => ({
    id: `note:${note.id}`,
    primary: 'note' as const,
    kinds: ['note' as const],
    at: localNoon(note.date, note.createdAt),
    title: 'Note',
    detail: null,
    check: null,
    content: null,
    note: { id: note.id, date: note.date, text: note.text },
    fix: null,
    promptSet: null
  }))
}

/** Job id of each fix's follow-up, to name "Follow-up check for Fix N". */
function followUpFixNumbers(db: SqliteDatabase, pageId: string): Map<string, number> {
  const jobs = new Map<string, number>()
  for (const fix of listFixFollowUps(db, pageId)) {
    if (fix.followUpJobId !== null) jobs.set(fix.followUpJobId, fix.number)
    if (fix.followUpRunId !== null) {
      const row = db
        .prepare<unknown[], { job_id: string }>(`SELECT job_id FROM runs WHERE id = ?`)
        .get(fix.followUpRunId)
      if (row !== undefined) jobs.set(row.job_id, fix.number)
    }
  }
  return jobs
}

function promptPositions(db: SqliteDatabase, pageId: string): Map<string, number> {
  const rows = db
    .prepare<unknown[], { id: string; position: number }>(
      `SELECT prompts.id, prompts.position FROM prompts
       JOIN prompt_sets ON prompt_sets.id = prompts.prompt_set_id
       WHERE prompt_sets.page_id = ?`
    )
    .all(pageId)
  return new Map(rows.map((row) => [row.id, row.position]))
}

function targets(numbers: readonly number[]): string {
  if (numbers.length === 0) return 'Targets prompts no longer in the set'
  if (numbers.length === 1) return `Targets prompt ${numbers[0]}`
  const head = numbers.slice(0, -1).join(', ')
  return `Targets prompts ${head} and ${numbers[numbers.length - 1]}`
}

function firstLine(text: string): string {
  const line = text.split('\n')[0]?.trim() ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/** A note's day at noon local time, so it sorts among that day's checks. */
function localNoon(date: string, fallback: string): string {
  const at = new Date(`${date}T12:00:00`)
  return Number.isNaN(at.getTime()) ? fallback : at.toISOString()
}

function withoutAt(change: ContentChangeAt): HistoryContentChange {
  return {
    summary: change.summary,
    fromSnapshotId: change.fromSnapshotId,
    toSnapshotId: change.toSnapshotId,
    modifiedAt: change.modifiedAt
  }
}

const KIND_ORDER: Readonly<Record<HistoryEventKind, number>> = {
  check: 0,
  content: 1,
  fix: 2,
  note: 3,
  prompt_set: 4
}

function newestFirst(left: HistoryEvent, right: HistoryEvent): number {
  if (left.at !== right.at) return left.at < right.at ? 1 : -1
  const kind = KIND_ORDER[left.primary] - KIND_ORDER[right.primary]
  if (kind !== 0) return kind
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}
