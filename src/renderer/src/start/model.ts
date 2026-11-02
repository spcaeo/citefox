import type { TopicResultRow } from '@shared/domain'
import type {
  SiteStartPlan,
  StartProgress,
  StartRival,
  StartRivalKind,
  StartStepItem
} from '@shared/ipc'

/** Pure copy and counts for the journey screens. */

/** After the last step or answer, the next screen opens on its own after this pause. */
export const OPEN_FOUND_AFTER_MS = 1500
export const OPEN_RESULTS_AFTER_MS = 1500

export interface StepCounts {
  /** 1-based number of the step running now (or the last one). */
  current: number
  total: number
  done: number
  retried: number
  skipped: number
}

export function stepCounts(items: readonly StartStepItem[]): StepCounts {
  const running = items.findIndex((item) => item.state === 'running')
  const finished = items.filter((item) => item.state !== 'pending' && item.state !== 'running')
  const subs = items.flatMap((item) => item.subItems)
  return {
    current: running >= 0 ? running + 1 : Math.max(1, finished.length),
    total: items.length,
    done: finished.length,
    retried: subs.filter((sub) => sub.state === 'retried').length,
    skipped: subs.filter((sub) => sub.state === 'skipped').length
  }
}

/** "Step 4 of 9 · 3 done · 1 retried · 1 skipped". */
export function stepLine(counts: StepCounts): string {
  return [
    `Step ${counts.current} of ${counts.total}`,
    `${counts.done} done`,
    counts.retried > 0 ? `${counts.retried} retried` : '',
    counts.skipped > 0 ? `${counts.skipped} skipped` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

const READING = new Set(['home', 'sitemap', 'sections', 'key_pages'])
const FINDING = new Set(['pick', 'rivals'])

/** The line under "Setting up example.com". */
export function setupSubtitle(progress: StartProgress | null): string {
  if (progress === null) return 'Reading your site. You can leave this screen; setup keeps going.'
  if (progress.phase === 'done') return 'Done. Opening what we found…'
  if (progress.phase === 'stopped') return 'Paused. Resume any time; nothing read so far is lost.'
  if (progress.phase === 'failed') return 'Setup stopped. Try again; pages read so far are kept.'
  const running = progress.items.find((item) => item.state === 'running')
  if (running === undefined || READING.has(running.id)) {
    return 'Reading your site. You can leave this screen; setup keeps going.'
  }
  if (FINDING.has(running.id)) return 'Finding the pages and rivals that matter.'
  return 'Almost there. Writing the questions your buyers ask Google.'
}

/** "3 s", or a running clock "0:05". */
export function durationText(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1000) return '<1 s'
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

export function rivalsOf(rivals: readonly StartRival[], kind: StartRivalKind): StartRival[] {
  return rivals.filter((rival) => rival.kind === kind)
}

/** The KPI line under Competitors: "Plus 3 you replace, 1 partner". */
export function rivalsNote(rivals: readonly StartRival[]): string {
  const replace = rivalsOf(rivals, 'switch_from').length
  const partners = rivalsOf(rivals, 'partner').length
  const parts = [
    replace > 0 ? `${replace} you replace` : '',
    partners > 0 ? `${partners} ${partners === 1 ? 'partner' : 'partners'}` : ''
  ].filter(Boolean)
  return parts.length === 0 ? 'From your project and site' : `Plus ${parts.join(', ')}`
}

/** "1 min 12 s". */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

/** Pages read in full, from the plan. */
export function readCount(plan: Pick<SiteStartPlan, 'pagesRead'>): number {
  return plan.pagesRead.filter((read) => read.ok).length
}

/** Target page indexes in the plan URL (`#/start/plan?t=0.1.2`). Null when absent. */
export function targetsFromHash(hash: string, pageCount: number): number[] | null {
  const query = hash.split('?')[1]
  if (!query) return null
  const raw = new URLSearchParams(query).get('t')
  if (raw === null) return null
  if (raw === '') return []
  const picked = raw
    .split('.')
    .map((part) => Number(part))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < pageCount)
  return [...new Set(picked)].sort((left, right) => left - right)
}

export function targetsHash(indexes: readonly number[]): string {
  return `#/start/plan?t=${[...indexes].sort((left, right) => left - right).join('.')}`
}

/** Live counts for "So far". */
export function soFar(rows: readonly TopicResultRow[]): {
  checked: number
  total: number
  shown: number
  cited: number
  domains: { domain: string; count: number; own: boolean }[]
} {
  const questions = rows.filter((row) => row.kind === 'question')
  const checked = questions.filter((row) => row.state !== 'not_checked')
  const shown = checked.filter((row) => row.state !== 'no_aio' && row.state !== 'failed')
  const cited = shown.filter((row) => row.citedOwnUrl !== null)
  const counts = new Map<string, number>()
  for (const row of shown) {
    for (const domain of new Set(row.citedInstead))
      counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  const domains = [
    ...(cited.length > 0 ? [{ domain: '', count: cited.length, own: true }] : []),
    ...[...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 4)
      .map(([domain, count]) => ({ domain, count, own: false }))
  ]
  return {
    checked: checked.length,
    total: questions.length,
    shown: shown.length,
    cited: cited.length,
    domains
  }
}
