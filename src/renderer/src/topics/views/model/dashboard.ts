import type { TopicSummary } from '@shared/domain'
import type { QuestionRow, TopicFolder } from '@shared/ipc'
import {
  addTotals,
  emptyCounts,
  needsWork,
  percent,
  resultOfStatus,
  shownResults,
  totalsOfCounts
} from './results'
import type { GridCell, SearchResult, Totals } from './types'

/**
 * The Topics dashboard: folders › topics, each with its searches, results bar, target
 * cited %, needs work and last check. Folder rows add up their topics; the footer adds
 * up the folders. New topics, and topics of a deleted folder, sit in "No folder".
 */

export const NO_FOLDER = 'No folder'

/** Topic statuses the dashboard lists. Removed topics wait for Undo off-screen. */
const LISTED: ReadonlySet<TopicSummary['status']> = new Set(['tracked', 'paused', 'setting_up'])

export interface DashTopic {
  id: string
  name: string
  status: TopicSummary['status']
  folderId: string | null
  totals: Totals
  /** Latest finished check of the topic in any market. Null before the first. */
  checkedAt: string | null
  /** The questions band's lower edge: the "goal" in Furthest behind. */
  goal: number
  /** Target page cited % now minus on each search's previous check. Null without both. */
  changePts: number | null
  /** Distinct pages to fix for the searches that need work (a target page, or a new one). */
  pageFixes: number
}

export interface DashFolder {
  /** Null is "No folder". */
  id: string | null
  name: string
  topics: readonly DashTopic[]
  totals: Totals
  checkedAt: string | null
}

export interface DashKpis {
  targetPct: number | null
  targetCited: number
  withAio: number
  needsWork: number
  /** The page fixes Fixes shows: each topic's distinct pages to fix, added up. */
  pageFixes: number
  furthestBehind: DashTopic | null
  mostImproved: DashTopic | null
}

export interface Dashboard {
  folders: readonly DashFolder[]
  topics: readonly DashTopic[]
  totals: Totals
  kpis: DashKpis
}

function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

/** Target page cited ÷ searches with an AI Overview on each search's previous check. */
function previousTargetPct(rows: readonly QuestionRow[]): number | null {
  let withAio = 0
  let target = 0
  for (const row of rows) {
    const before = row.previous
    if (before?.overview !== true) continue
    withAio += 1
    // Older results carry no status: then "cited" is the closest they have.
    const hit = before.status === undefined ? before.cited === true : before.status === 'page_cited'
    if (hit) target += 1
  }
  return percent(target, withAio)
}

/**
 * A topic's searches as the views count them: one result each, and the headline (target
 * page cited ÷ searches with an AI Overview). The Topics list, Tree, Grid and KPIs all
 * read a topic's number from here, so they agree with the sidebar and the topic page.
 */
export function rowTotals(rows: readonly QuestionRow[]): Totals {
  const counts = emptyCounts()
  for (const row of rows) counts[resultOfStatus(row.status)] += 1
  return totalsOfCounts(counts)
}

function topicLine(
  topic: TopicSummary,
  rows: readonly QuestionRow[],
  folderId: string | null
): DashTopic {
  const pages = new Set<string>()
  for (const row of rows) {
    if (needsWork(resultOfStatus(row.status))) pages.add(row.targetUrl ?? 'new')
  }
  const totals = rowTotals(rows)
  const now = totals.targetPct
  const before = previousTargetPct(rows)
  return {
    id: topic.id,
    name: topic.name,
    status: topic.status,
    folderId,
    totals,
    checkedAt: topic.checkedAt,
    goal: topic.bands.questions.lo,
    changePts: now === null || before === null ? null : now - before,
    pageFixes: pages.size
  }
}

export function dashboard(
  topics: readonly TopicSummary[],
  folders: readonly TopicFolder[],
  rows: readonly QuestionRow[]
): Dashboard {
  const placement = new Map<string, string>()
  for (const folder of folders) for (const id of folder.topicIds) placement.set(id, folder.id)
  const bySource = new Map<string, QuestionRow[]>()
  for (const row of rows) {
    const list = bySource.get(row.sourceId)
    if (list) list.push(row)
    else bySource.set(row.sourceId, [row])
  }
  const lines = topics
    .filter((topic) => LISTED.has(topic.status))
    .map((topic) => topicLine(topic, bySource.get(topic.id) ?? [], placement.get(topic.id) ?? null))

  const folderRow = (id: string | null, name: string): DashFolder => {
    const mine = lines.filter((line) => line.folderId === id)
    return {
      id,
      name,
      topics: mine,
      totals: addTotals(mine.map((line) => line.totals)),
      checkedAt: mine.reduce<string | null>((at, line) => latest(at, line.checkedAt), null)
    }
  }
  const made = folders.map((folder) => folderRow(folder.id, folder.name))
  const loose = folderRow(null, NO_FOLDER)
  // Empty folders stay, so a folder just made can take topics; No folder shows when used.
  const all = loose.topics.length > 0 || made.length === 0 ? [...made, loose] : made
  const totals = addTotals(lines.map((line) => line.totals))

  const scored = lines.filter((line) => line.totals.targetPct !== null)
  const furthestBehind =
    scored.reduce<DashTopic | null>(
      (worst, line) =>
        worst === null || (line.totals.targetPct ?? 0) < (worst.totals.targetPct ?? 0)
          ? line
          : worst,
      null
    ) ?? null
  const mostImproved = lines.reduce<DashTopic | null>(
    (best, line) =>
      line.changePts !== null &&
      line.changePts > 0 &&
      (best === null || line.changePts > (best.changePts ?? 0))
        ? line
        : best,
    null
  )
  return {
    folders: all,
    topics: lines,
    totals,
    kpis: {
      targetPct: totals.targetPct,
      targetCited: totals.counts.target,
      withAio: totals.withAio,
      needsWork: totals.needsWork,
      pageFixes: lines.reduce((sum, line) => sum + line.pageFixes, 0),
      furthestBehind,
      mostImproved
    }
  }
}

/** Folder × result counts, plus the All row. Cells drill into a folder's topics. */
export interface FolderGridRow {
  id: string | null
  label: string
  totals: Totals
  cells: readonly GridCell[]
}

export function folderGrid(board: Dashboard): {
  rows: readonly FolderGridRow[]
  all: FolderGridRow
  results: readonly SearchResult[]
} {
  const results = shownResults(board.totals.counts)
  const row = (id: string | null, label: string, totals: Totals): FolderGridRow => ({
    id,
    label,
    totals,
    cells: results.map((result) => ({ result, count: totals.counts[result], filter: { result } }))
  })
  return {
    rows: board.folders.map((folder) => row(folder.id, folder.name, folder.totals)),
    all: row(null, 'All', board.totals),
    results
  }
}
