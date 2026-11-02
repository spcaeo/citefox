import type { FixPromptOutcome, LoggedFix } from '@shared/domain'
import type { FixSubject, GapSuggestion, ProjectFix } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { pageHash, topicHash } from '../shell/routes'

/** View helpers for the project-wide Fixes screen. Pure. */

/**
 * Route keys: `status` (open, checking, done) and `page` (a page or topic id). The fix
 * shown is the window-wide `fix` drawer's (`drawer=fix&fix=<id>`).
 */
export const FIXES_QUERY = ['status', 'page'] as const

/** A link from before the fix drawer (`#/fixes?fix=<id>`, no drawer): the fix it named. */
export function legacyFixId(hash: string): string | null {
  const params = new URLSearchParams(hash.split('?')[1] ?? '')
  return params.has('drawer') ? null : params.get('fix') || null
}

/** The hash without its `fix` key. */
export function withoutFixParam(hash: string): string {
  const [path = '', query = ''] = hash.split('?')
  const params = new URLSearchParams(query)
  params.delete('fix')
  const rest = params.toString()
  return rest ? `${path}?${rest}` : path
}

/**
 * Where a fix stands: `open` until its follow-up starts (planned), `checking` while the
 * follow-up check runs, `done` once the follow-up run is stored.
 */
export type FixStage = 'open' | 'checking' | 'done'

export const FIX_STAGES: readonly { id: FixStage; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'checking', label: 'Checking' },
  { id: 'done', label: 'Done' }
]

export function fixStage(fix: LoggedFix): FixStage {
  if (fix.status === 'started') return 'checking'
  if (fix.status === 'completed') return 'done'
  return 'open'
}

export function stageLabel(stage: FixStage): string {
  return FIX_STAGES.find((item) => item.id === stage)?.label ?? 'Open'
}

export type StageFilter = 'all' | FixStage

export function isStageFilter(value: string | null): value is StageFilter {
  return value === 'all' || FIX_STAGES.some((item) => item.id === value)
}

export function stageCounts(items: readonly ProjectFix[]): Record<StageFilter, number> {
  const counts: Record<StageFilter, number> = {
    all: items.length,
    open: 0,
    checking: 0,
    done: 0
  }
  for (const item of items) counts[fixStage(item.fix)] += 1
  return counts
}

/** The fixes a status and a page or topic filter show. */
export function filterFixes(
  items: readonly ProjectFix[],
  stage: StageFilter,
  subjectId: string | null
): ProjectFix[] {
  return items.filter(
    (item) =>
      (stage === 'all' || fixStage(item.fix) === stage) &&
      (subjectId === null || item.fix.pageId === subjectId)
  )
}

/** The targeted questions, in prompt order, from the fix's first market outcome. */
export function targetedQuestions(fix: LoggedFix): readonly FixPromptOutcome[] {
  return fix.markets[0]?.prompts ?? []
}

/** "Uses about 4–8 searches", or "Uses about 4 searches" when both ends match. */
export function costLine(item: Pick<ProjectFix, 'searchesMin' | 'searchesMax'>): string {
  if (item.searchesMin === item.searchesMax) {
    return `Uses about ${pluralize(item.searchesMin, 'search', 'searches')}`
  }
  return `Uses about ${item.searchesMin}–${item.searchesMax} searches`
}

/** The page's Progress tab on this fix, or the topic's Progress tab. */
export function fixDetailHash(subject: FixSubject | undefined, fix: LoggedFix): string {
  if (subject?.kind === 'topic') return topicHash(fix.pageId, { tab: 'progress' })
  return pageHash(fix.pageId, 'progress', { filter: `fix:${fix.number}` })
}

/** The suggestion's row on the page's Content gaps tab, or the topic's results. */
export function gapHash(subject: FixSubject | undefined, gap: GapSuggestion): string {
  if (subject?.kind === 'topic') return topicHash(gap.pageId)
  return pageHash(gap.pageId, 'gaps', { filter: `row:${gap.promptId}` })
}

/** A page's path for the grid ("/pricing/"), the full URL stays on the copy and open icons. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}

/** "Fix 3 · Add a price table", for confirm lines. */
export function fixName(fix: LoggedFix): string {
  const line = (fix.description.split('\n')[0] ?? '').split('**').join('').trim()
  const short = line.length > 60 ? `${line.slice(0, 59)}…` : line
  return short ? `Fix ${fix.number} · ${short}` : `Fix ${fix.number}`
}
