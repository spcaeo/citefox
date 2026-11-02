import {
  fixVerdictLabel,
  type FixMarketOutcome,
  type FixVerdict,
  type LoggedFix
} from '@shared/domain'
import { changeStatusLabel, type ChangeStatus } from '@shared/fix-loop'
import { verdictLabel } from '@shared/fix-verdict'
import type { ProjectFix, ProjectFixList } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { beforeNowLong, verdictOf } from '../changes/verdict'
import type { ChartEvent, VerdictTone } from '../ui'

/**
 * Logged fixes as chart markers (ui/chart): the filled circle with the fix's number,
 * and its hover card (what changed, before → now, the verdict). A fix that main
 * measured (`measure`) says the Did it work? verdict, the same words as Changes;
 * an older list without it falls back to the follow-up outcome. Each chart passes
 * only the fixes that touch what it charts. Pure.
 */

export interface FixEventOptions {
  /** The market the chart shows: fixes outside it are left out; its outcome is read. */
  marketId?: string | null
  now: Date
  /** "/blog/att-email…" for the card's line. Default: no page named. */
  pageLabel?: (pageId: string) => string | null
  /** The Changes ledger's status, when the screen has it. */
  statusOf?: (fixId: string) => ChangeStatus | null
}

export function fixEvents(fixes: readonly LoggedFix[], options: FixEventOptions): ChartEvent[] {
  const { marketId = null, now } = options
  return fixes.flatMap((fix) => {
    if (marketId !== null && !fix.marketIds.includes(marketId)) return []
    const at = Date.parse(fix.goLiveAt)
    if (Number.isNaN(at)) return []
    const planned = at > now.getTime()
    const outcome =
      (marketId === null
        ? fix.markets[0]
        : fix.markets.find((item) => item.marketId === marketId)) ?? null
    const page = options.pageLabel?.(fix.pageId) ?? null
    const questions = pluralize(fix.promptIds.length, 'question')
    const measured = fix.measure ? measuredCard(fix, now) : null
    const verdict =
      measured ?? followUpVerdict(fix, outcome, planned, options.statusOf?.(fix.id) ?? null)
    return [
      {
        id: `fix:${fix.id}`,
        kind: 'fix' as const,
        at: fix.goLiveAt,
        title: `Fix ${fix.number} · ${firstLine(fix.description)}`,
        line: page ? `${page} · ${questions}` : questions,
        number: fix.number,
        fixId: fix.id,
        ...(measured ? {} : outcome ? beforeNow(outcome) : {}),
        ...verdict,
        planned
      }
    ]
  })
}

/** "1 of 3 → 2 of 3": targeted questions citing the page before go-live and after it. */
function beforeNow(outcome: FixMarketOutcome): { beforeNow?: string } {
  if (outcome.afterRunId === null || outcome.prompts.length === 0) return {}
  const total = outcome.prompts.length
  const before = outcome.prompts.filter((item) => item.before?.status === 'page_cited').length
  const after = outcome.prompts.filter((item) => item.after?.status === 'page_cited').length
  return { beforeNow: `${before} of ${total} → ${after} of ${total}` }
}

const VERDICT_TONE: Readonly<Record<FixVerdict, VerdictTone>> = {
  worked: 'good',
  partly: 'good',
  no_change: 'wait',
  got_worse: 'bad',
  waiting: 'wait'
}

const STATUS_TONE: Readonly<Record<ChangeStatus, VerdictTone>> = {
  cited: 'good',
  not_cited: 'wait',
  too_new: 'wait',
  lost: 'bad'
}

/** The Did it work? card: before → now, the verdict, and why it may be less certain. */
function measuredCard(
  fix: LoggedFix,
  now: Date
): { beforeNow?: string; verdict: string; verdictTone: VerdictTone } | null {
  if (!fix.measure) return null
  const view = verdictOf(fix.measure, fix.goLiveAt, now)
  const update = view.updates[0]
  const why = !view.lessCertain
    ? null
    : update
      ? `less certain: ${update.name} in this window`
      : 'less certain: similar searches moved too'
  const beforeNow = beforeNowLong(view)
  return {
    ...(beforeNow ? { beforeNow } : {}),
    verdict: why ? `${verdictLabel(view)} · ${why}` : verdictLabel(view),
    verdictTone: view.tone
  }
}

function followUpVerdict(
  fix: LoggedFix,
  outcome: FixMarketOutcome | null,
  planned: boolean,
  status: ChangeStatus | null
): { verdict?: string; verdictTone?: VerdictTone } {
  if (planned) return { verdict: 'Goes live later', verdictTone: 'wait' }
  if (outcome) {
    return {
      verdict: fixVerdictLabel(outcome.verdict, outcome.worked, outcome.compared).replace(
        /\bprompts?\b/,
        (word) => (word === 'prompt' ? 'question' : 'questions')
      ),
      verdictTone: VERDICT_TONE[outcome.verdict]
    }
  }
  if (status) return { verdict: changeStatusLabel(status), verdictTone: STATUS_TONE[status] }
  if (fix.verdict) return { verdict: fix.verdict, verdictTone: 'wait' }
  return {}
}

function firstLine(text: string, max = 48): string {
  const line = (text.split('\n')[0] ?? '').replace(/[*_`#>[\]]/g, '').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** The fixes of a project list that belong to one page or topic id (or any of several). */
export function fixesFor(
  list: Pick<ProjectFixList, 'fixes'> | null,
  subjectIds: ReadonlySet<string> | null
): LoggedFix[] {
  if (!list) return []
  return list.fixes
    .map((item: ProjectFix) => item.fix)
    .filter((fix) => subjectIds === null || subjectIds.has(fix.pageId))
}

/** A page label for the card: the subject's own label, from the project list. */
export function subjectLabels(
  list: Pick<ProjectFixList, 'subjects'> | null
): (pageId: string) => string | null {
  const labels = new Map((list?.subjects ?? []).map((subject) => [subject.id, subject.label]))
  return (pageId) => labels.get(pageId) ?? null
}

/** A topic chart's fixes: the ones logged on the topic and on its target page. */
export function topicSubjectIds(
  list: Pick<ProjectFixList, 'subjects'> | null,
  topicId: string,
  targetPage: string | null
): Set<string> {
  const ids = new Set([topicId])
  const want = targetPage ? sameAddress(targetPage) : null
  for (const subject of list?.subjects ?? []) {
    if (want !== null && subject.url && sameAddress(subject.url) === want) ids.add(subject.id)
  }
  return ids
}

function sameAddress(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/+$/, '')
}
