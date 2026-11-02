import type { OverviewCompare, OverviewQuestion, VisibilityOverview } from '@shared/ipc'
import { CITATION_CHANGE_LABELS, isCitationChange, type CitationChange } from '@shared/report/diff'
import {
  buildVerdict,
  type Verdict,
  type VerdictCount,
  type VerdictSet
} from '@shared/report/verdict'
import type { ItemDrill } from '../drill'
import { formatDay } from '../utils/dates'
import { questionsInsight } from './insights'
import { countNoun, sourceText, youLabel } from './model'

/**
 * Before vs after on the Overview: the "Compare with" control, the change filter of
 * "Questions that changed", the verdict and the questions behind each of its numbers.
 * Pure.
 */

/**
 * Route keys besides `period`: `market` (the market picker), `vs` (Compare with),
 * `change` (the questions filter), `panel=method` (How we measure).
 */
export const OVERVIEW_QUERY = ['market', 'vs', 'change', 'panel', 'engine', 'edit', 'add'] as const
export const METHOD_PANEL = 'method'

/** How the compared check reads in a sentence. Null when nothing compares. */
export function compareLabel(data: Pick<VisibilityOverview, 'compare' | 'diff'>): string | null {
  if (data.diff === null || !data.compare.available) return null
  const { mode, at } = data.compare
  if (mode === 'previous' || at === null) return 'the previous check'
  const day = formatDay(at, { year: false })
  return mode === 'run' ? `the ${day} check` : day
}

/** A short form for small print: "previous check", "Oct 5". */
export function compareShort(compare: OverviewCompare): string {
  if (compare.mode === 'previous' || compare.at === null) return 'previous check'
  return formatDay(compare.at, { year: false })
}

export interface CompareOption {
  value: string
  label: string
}

/** "Previous check", then each earlier check by day, plus a day picked by URL. */
export function compareOptions(compare: OverviewCompare): CompareOption[] {
  const options: CompareOption[] = [{ value: '', label: 'Previous check' }]
  for (const option of compare.options) {
    options.push({ value: option.value, label: `${formatDay(option.at)} check` })
  }
  const vs = compare.vs
  if (vs !== null && !compare.unknown && !options.some((option) => option.value === vs)) {
    options.push({
      value: vs,
      label:
        compare.at === null
          ? vs
          : `${formatDay(compare.at)}${compare.mode === 'run' ? ' check' : ''}`
    })
  }
  return options
}

/** The value the select shows: the URL's `vs`, or Previous check when it is unknown. */
export function compareValue(compare: OverviewCompare): string {
  return compare.vs === null || compare.unknown ? '' : compare.vs
}

/** "Changed" (gained or lost), one change, or every question. */
export type QuestionFilter = 'changed' | CitationChange | 'all'

export function questionFilterFrom(value: string | null, comparing: boolean): QuestionFilter {
  if (!comparing) return 'all'
  if (value === 'all' || isCitationChange(value)) return value
  return 'changed'
}

/**
 * The rows of one filter. "Still not cited" (`never`) keeps only searches that show an
 * AI Overview now and cite no page of yours at either check: a search with no AI Overview
 * has nothing to cite, so it is not counted as not cited (as the results bar counts it).
 */
export function filterQuestions(
  questions: readonly OverviewQuestion[],
  filter: QuestionFilter
): OverviewQuestion[] {
  if (filter === 'all') return [...questions]
  if (filter === 'changed') {
    return questions.filter((item) => item.change === 'gained' || item.change === 'lost')
  }
  if (filter === 'never') {
    return questions.filter(
      (item) => item.change === 'never' && (item.you === 'not_cited' || item.you === 'named')
    )
  }
  return questions.filter((item) => item.change === filter)
}

/** The filter words: "Still not cited" says it spans both checks, unlike the bar's "not cited". */
const FILTER_LABEL: Readonly<Record<CitationChange, string>> = {
  ...CITATION_CHANGE_LABELS,
  never: 'Still not cited'
}

export function questionFilterOptions(
  questions: readonly OverviewQuestion[]
): { value: QuestionFilter; label: string; count: number }[] {
  const count = (filter: QuestionFilter): number => filterQuestions(questions, filter).length
  return [
    { value: 'changed', label: 'Changed', count: count('changed') },
    ...(['gained', 'kept', 'lost', 'never'] as const).map((change) => ({
      value: change,
      label: FILTER_LABEL[change],
      count: count(change)
    })),
    { value: 'all', label: 'All', count: questions.length }
  ]
}

export function changeText(change: CitationChange | null): string {
  return change === null ? '—' : CITATION_CHANGE_LABELS[change]
}

export function changeTone(change: CitationChange | null): 'ok' | 'bad' | 'neutral' {
  if (change === 'gained') return 'ok'
  if (change === 'lost') return 'bad'
  return 'neutral'
}

/** The verdict from the question sets, so every number equals its drawer's rows. */
export function overviewVerdict(data: VisibilityOverview): Verdict {
  const sets = data.verdictSets
  const label = compareLabel(data)
  return buildVerdict({
    brand: data.brand,
    compareLabel: label,
    tracked: sets.tracked.length,
    aio: sets.aio.length,
    cited: sets.cited.length,
    named: sets.named.length,
    notVisible: sets.not_visible.length,
    changes: label === null ? null : data.diff,
    namedBefore: label === null ? null : sets.named_before.length,
    namedAfter: label === null ? null : sets.named_after.length,
    topSite:
      data.topSite === null ? null : { name: data.topSite.name, count: sets.top_site.length },
    // "searches" when keywords are tracked too: a keyword is no question.
    noun: countNoun(data).one
  })
}

/** One plain sentence for what a verdict number counts ("What this number counts"). */
export function verdictSetDescription(data: VisibilityOverview, set: VerdictSet): string {
  const many = countNoun(data).Many
  const since = compareLabel(data) ?? 'the check before'
  const site = data.topSite?.name ?? 'the most cited other site'
  switch (set) {
    case 'tracked':
      return `Every ${countNoun(data).one} you track that has been checked.`
    case 'aio':
      return `${many} where Google showed an AI Overview at the latest check.`
    case 'cited':
      return `${many} whose latest AI Overview links to a page of ${data.domain}.`
    case 'named':
      return `${many} whose latest AI Overview names ${data.brand} in its text.`
    case 'not_visible':
      return `${many} with an AI Overview that neither links to ${data.domain} nor names ${data.brand}.`
    case 'cited_before':
      return `${many} whose AI Overview linked to ${data.domain} at ${since}.`
    case 'cited_after':
      return `${many} whose AI Overview links to ${data.domain} at the latest check.`
    case 'named_before':
      return `${many} whose AI Overview named ${data.brand} at ${since}.`
    case 'named_after':
      return `${many} whose AI Overview names ${data.brand} at the latest check.`
    case 'gained':
      return `${many} that cite ${data.domain} now and did not at ${since}.`
    case 'kept':
      return `${many} that cited ${data.domain} at ${since} and still do.`
    case 'lost':
      return `${many} that cited ${data.domain} at ${since} and no longer do.`
    case 'top_site':
      return `${many} whose latest AI Overview links to ${site}.`
  }
}

/** The questions behind one verdict number, each opening its prompt detail. */
export function verdictDrill(data: VisibilityOverview, count: VerdictCount): ItemDrill {
  return questionKeysDrill(data, {
    id: `verdict:${count.set}`,
    title: count.label,
    description: verdictSetDescription(data, count.set),
    keys: data.verdictSets[count.set]
  })
}

/** The overview questions with these keys, in that order, each opening its prompt detail. */
export function questionKeysDrill(
  data: VisibilityOverview,
  input: {
    id: string
    title: string
    description?: string
    keys: readonly string[]
    /** The "What stands out" line. Unset: read from the rows; null: none. */
    insight?: string | null
  }
): ItemDrill {
  const byKey = new Map(data.questions.map((item) => [item.key, item]))
  const noun = countNoun(data)
  const found = input.keys
    .map((key) => byKey.get(key))
    .filter((item): item is OverviewQuestion => item !== undefined)
  const items = found.map((item) => ({
    id: item.key,
    primary: item.text,
    secondary: sourceText(item.source),
    target: {
      kind: 'prompt' as const,
      pageId: item.pageId,
      promptId: item.promptId,
      marketId: item.marketId,
      runId: item.runId
    },
    cells: { you: youLabel(item), change: changeText(item.change) }
  }))
  return {
    kind: 'items',
    id: input.id,
    title: input.title,
    // Never an empty "What this number counts".
    description: input.description ?? `${noun.Many} behind this number, from the latest checks.`,
    insight: input.insight === undefined ? questionsInsight(found, noun) : input.insight,
    noun: [noun.one, noun.many],
    primaryLabel: noun.one === 'search' ? 'Search' : 'Question',
    columns: [
      { id: 'you', label: 'Now', width: 'minmax(96px, 0.5fr)' },
      { id: 'change', label: 'Change', width: 'minmax(80px, 0.4fr)' }
    ],
    items,
    scope: {
      pageId: null,
      marketId: data.marketId,
      runId: null,
      marketLabel: '',
      checkDateLabel: '',
      brand: data.brand,
      domain: data.domain
    }
  }
}

/** The KPI tiles that drill into a verdict set (their numbers are the same counts). */
export const KPI_SETS = {
  aio: 'where an AI Overview shows',
  cited: 'where you’re cited',
  named: 'where you’re named'
} as const

export type KpiSet = keyof typeof KPI_SETS

/** The searches behind a KPI tile: the verdict set it counts, under its own drill id. */
export function kpiDrill(data: VisibilityOverview, set: KpiSet): ItemDrill {
  const label = `${countNoun(data).Many} ${KPI_SETS[set]}`
  const drill = verdictDrill(data, { set, n: data.verdictSets[set].length, label })
  return { ...drill, id: `kpi:${set}` }
}

/** Every tracked question or keyword, checked or not: the rows behind "Questions tracked". */
export function trackedDrill(data: VisibilityOverview): ItemDrill {
  const latest = new Map(data.questions.map((item) => [item.key, item]))
  const keywords = data.tracked.some((item) => item.keyword)
  return {
    kind: 'items',
    id: 'kpi:tracked',
    title: keywords ? 'Searches tracked' : 'Questions tracked',
    description: keywords
      ? 'Every question and keyword of your tracked pages and topics, checked or not.'
      : 'Every question of your tracked pages and topics, checked or not.',
    noun: keywords ? ['search', 'searches'] : ['question', 'questions'],
    primaryLabel: keywords ? 'Search' : 'Question',
    ...(keywords
      ? {
          summary: [
            { label: 'Questions', group: 'question' },
            { label: 'Keywords', group: 'keyword' }
          ]
        }
      : {}),
    columns: [
      { id: 'kind', label: 'Kind', width: 'minmax(80px, 0.4fr)' },
      { id: 'you', label: 'Now', width: 'minmax(96px, 0.5fr)' }
    ],
    items: data.tracked.map((item) => {
      const checked = latest.get(item.key)
      return {
        id: item.key,
        primary: item.text,
        secondary: sourceText(item.source),
        target: checked
          ? {
              kind: 'prompt' as const,
              pageId: checked.pageId,
              promptId: checked.promptId,
              marketId: checked.marketId,
              runId: checked.runId
            }
          : { kind: 'prompt' as const, pageId: item.pageId, promptId: item.promptId },
        cells: {
          kind: item.keyword ? 'Keyword' : 'Question',
          you: checked ? youLabel(checked) : 'Not checked yet'
        },
        group: item.keyword ? 'keyword' : 'question'
      }
    }),
    scope: {
      pageId: null,
      marketId: data.marketId,
      runId: null,
      marketLabel: '',
      checkDateLabel: '',
      brand: data.brand,
      domain: data.domain
    }
  }
}

/** A KPI's earlier value for its small line: "was 3", "was 3 on Oct 5". */
export function wasText(before: number | null, compare: OverviewCompare, unit = ''): string | null {
  if (before === null) return null
  const tail =
    compare.mode === 'previous' || compare.at === null ? '' : ` on ${compareShort(compare)}`
  return `was ${before.toLocaleString('en-US')}${unit}${tail}`
}
