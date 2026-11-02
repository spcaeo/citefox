import { TOPIC_STAGES, type TopicPromptKind } from '@shared/domain'
import type { DrillScope, TopicDrill, TopicDrillRow } from '../../../drill'
import { GOOGLE_WORDS, type ResultWords } from '../../../ui/resultWords'
import { MATCH_STATE_LABEL, TOPIC_STAGE_LABEL } from '../constants'
import type { MatchState, TopicResultRow, TopicResults } from '../types'
import { formatDate } from './format'
import { hasAio, isCited, promptLabel, rowsById, topDomains, urlPath } from './scoring'

/** The drawer scope for a topic: its rows open Prompt detail on the topic's page row. */
export function topicScope(results: TopicResults, brand = ''): DrillScope {
  const { topic } = results
  const market = topic.markets.find((item) => item.id === topic.marketId)
  return {
    pageId: topic.id,
    marketId: topic.marketId,
    runId: null,
    marketLabel: market?.label ?? '',
    checkDateLabel: topic.checkedAt ? formatDate(topic.checkedAt) : '',
    brand: topic.brand?.name ?? brand,
    domain: topic.domain ?? ''
  }
}

export function toDrillRow(row: TopicResultRow): TopicDrillRow {
  return {
    promptId: row.promptId,
    label: promptLabel(row),
    text: row.text,
    stage: row.stage ? TOPIC_STAGE_LABEL[row.stage] : '',
    matchState: row.state,
    page: urlPath(isCited(row) ? row.citedOwnUrl : row.targetUrl),
    position: row.position,
    citedDomains: row.citedInstead,
    aio: hasAio(row),
    named: row.named,
    aioSummary: row.aioSummary,
    winOdds: row.state === 'right_page' ? null : (row.winOdds?.score ?? null),
    reason: row.winOdds?.reason ?? null
  }
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** "Most are Problem and Decide." when one or two stages hold most rows. */
function stageLead(rows: readonly TopicResultRow[]): string | null {
  const counts = TOPIC_STAGES.map((stage) => ({
    stage,
    count: rows.filter((row) => row.stage === stage).length
  }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
  if (counts.length < 2) return null
  const top = counts.slice(0, 2)
  const share = top.reduce((sum, item) => sum + item.count, 0)
  if (share * 2 <= rows.length) return null
  return `Most are ${joinAnd(top.map((item) => TOPIC_STAGE_LABEL[item.stage]))}.`
}

/** One line from saved data: where the rows sit and who is cited beside or instead of you. */
export function drillInsight(rows: readonly TopicResultRow[]): string | null {
  if (rows.length === 0) return null
  const lead = stageLead(rows)
  const withAio = rows.filter(hasAio)
  const cited = withAio.length > 0 && withAio.every(isCited)
  const top = topDomains(withAio, 1)[0]
  const domainLine =
    top && top.count >= 2
      ? `${top.domain} is cited ${cited ? 'next to you' : 'instead'} in ${top.count}.`
      : null
  const line = [lead, domainLine].filter(Boolean).join(' ')
  return line.length > 0 ? line : null
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Four tiles that add the rows up, so the drawer explains its own number. */
export function drillTiles(
  rows: readonly TopicResultRow[],
  view: TopicDrill['view'],
  words: ResultWords = GOOGLE_WORDS
): { label: string; value: string }[] {
  const stagesIn = new Set(rows.flatMap((row) => (row.stage ? [row.stage] : []))).size
  const stages = { label: 'Stages', value: `${stagesIn} of ${TOPIC_STAGES.length}` }
  if (view === 'cited') {
    const avg = average(rows.flatMap((row) => (row.position === null ? [] : [row.position])))
    return [
      {
        label: 'Right page',
        value: String(rows.filter((row) => row.state === 'right_page').length)
      },
      {
        label: 'Other own page',
        value: String(rows.filter((row) => row.state === 'other_page').length)
      },
      { label: 'Avg position', value: avg === null ? '—' : avg.toFixed(1) },
      stages
    ]
  }
  const aio = rows.filter(hasAio)
  return [
    { label: 'Cited', value: String(aio.filter(isCited).length) },
    { label: 'Not cited', value: String(aio.filter((row) => !isCited(row)).length) },
    { label: words.none, value: String(rows.length - aio.length) },
    stages
  ]
}

export interface TopicDrillSpec {
  id: string
  title: string
  description: string
  rows: readonly TopicResultRow[]
  /** Default: `cited` when every row is cited, else `todo`. */
  view?: TopicDrill['view']
}

/** A topic drawer request. Its count is `rows.length`, so it always equals the number clicked. */
export function topicDrill(
  results: TopicResults,
  spec: TopicDrillSpec,
  words: ResultWords = GOOGLE_WORDS
): TopicDrill {
  const kinds = new Set(spec.rows.map((row) => row.kind))
  const noun: readonly [string, string] =
    kinds.size === 1 && kinds.has('keyword') ? ['keyword', 'keywords'] : ['question', 'questions']
  const view = spec.view ?? (spec.rows.length > 0 && spec.rows.every(isCited) ? 'cited' : 'todo')
  return {
    kind: 'topic',
    id: spec.id,
    title: spec.title,
    description: spec.description,
    scope: topicScope(results),
    topicId: results.topic.id,
    projectId: '',
    noun,
    view,
    rows: spec.rows.map(toDrillRow),
    tiles: drillTiles(spec.rows, view, words),
    insight: drillInsight(spec.rows)
  }
}

/**
 * Builds the drills of one topic screen. `projectId` is set on every request so
 * the drawer's Claude actions and row links name the project.
 */
export interface TopicDrills {
  make: (spec: TopicDrillSpec) => TopicDrill
  cited: (kind: TopicPromptKind) => TopicDrill
  aio: (kind: TopicPromptKind) => TopicDrill
  all: (kind: TopicPromptKind) => TopicDrill
  named: (kind: TopicPromptKind) => TopicDrill
  noAio: (kind: TopicPromptKind) => TopicDrill
  failed: (kind: TopicPromptKind) => TopicDrill
  state: (state: MatchState, kind?: TopicPromptKind) => TopicDrill
  ids: (id: string, title: string, description: string, ids: readonly string[]) => TopicDrill
}

export function topicDrills(
  results: TopicResults,
  projectId: string,
  brand = '',
  words: ResultWords = GOOGLE_WORDS
): TopicDrills {
  const make = (spec: TopicDrillSpec): TopicDrill => ({
    ...topicDrill(results, spec, words),
    scope: topicScope(results, brand),
    projectId
  })
  const byIds = (ids: readonly string[]): TopicResultRow[] => rowsById(results.rows, ids)
  const ofKind = (kind: 'question' | 'keyword'): TopicResultRow[] =>
    results.rows.filter((row) => row.kind === kind)
  const noun = (kind: 'question' | 'keyword'): string =>
    kind === 'question' ? 'questions' : 'keywords'
  const title = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)
  // Google's answer is an AI Overview; an answer engine's is its answer.
  const answer = words.engine ? `${words.engine}'s answer` : 'AI Overview'
  const stateLabel = (state: MatchState): string =>
    state === 'no_aio' ? words.none : MATCH_STATE_LABEL[state]

  return {
    make,
    cited: (kind: 'question' | 'keyword') =>
      make({
        id: `topic:${kind}:cited`,
        title: `Cited ${noun(kind)}`,
        description: `${title(noun(kind))} whose ${answer} cites one of your pages.`,
        rows: ofKind(kind).filter(isCited),
        view: 'cited'
      }),
    aio: (kind: 'question' | 'keyword') =>
      make({
        id: `topic:${kind}:aio`,
        title: words.engine
          ? `${title(noun(kind))} ${words.withAnswer}`
          : `${title(noun(kind))} with an AI Overview`,
        description: 'The goal is cited ÷ these.',
        rows: ofKind(kind).filter(hasAio)
      }),
    all: (kind: 'question' | 'keyword') =>
      make({
        id: `topic:${kind}:all`,
        title: `All ${noun(kind)}`,
        description: `Every ${kind} in this topic, in this market.`,
        rows: ofKind(kind)
      }),
    named: (kind: 'question' | 'keyword') =>
      make({
        id: `topic:${kind}:named`,
        title: 'Brand named',
        description: words.engine
          ? `${words.engine} answers that name your brand in their text.`
          : 'Overviews that name your brand in their text.',
        rows: ofKind(kind).filter((row) => row.named === true)
      }),
    noAio: (kind: 'question' | 'keyword') =>
      make({
        id: `topic:${kind}:no_aio`,
        title: words.none,
        description: words.engine
          ? `Searches ${words.engine} did not answer. Left out of the goal.`
          : 'Searches that showed no overview. Left out of the goal.',
        rows: ofKind(kind).filter((row) => row.state === 'no_aio')
      }),
    failed: (kind: 'question' | 'keyword') =>
      make({
        id: `topic:${kind}:failed`,
        title: 'Failed searches',
        description:
          'Searches that failed after retries. Left out of the goal; checked again next time.',
        rows: ofKind(kind).filter((row) => row.state === 'failed')
      }),
    state: (state: MatchState, kind: 'question' | 'keyword' = 'question') =>
      make({
        id: `state:${state}`,
        title: stateLabel(state),
        description: `${title(noun(kind))} whose latest result is “${stateLabel(state).toLowerCase()}”.`,
        rows: ofKind(kind).filter((row) => row.state === state)
      }),
    ids: (id: string, drillTitle: string, description: string, ids: readonly string[]) =>
      make({ id, title: drillTitle, description, rows: byIds(ids) })
  }
}
