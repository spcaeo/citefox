/**
 * Assembles `topics:results` from prompt metadata and stored outcomes. Pure, so
 * main, exports and the fixture build the same payload.
 */

import type {
  FunnelStage,
  KeywordGroupKind,
  KeywordIntent,
  PageType,
  TopicBands,
  TopicProgressPoint,
  TopicPromptKind,
  TopicResultRow,
  TopicStage
} from './domain'
import type { TopicMeta, TopicResults, TopicSavedSummary, TopicSummaryInputs } from './ipc/topics'
import {
  citedInstead,
  citedOwn,
  competitorCitedNotYou,
  deriveRowState,
  goalPoint,
  isCitedState,
  keywordUniverse,
  stageCoverage,
  stageExtremes,
  targetPoint,
  todoGroups,
  topicGoal,
  winOdds,
  type TopicOutcome
} from './topic-scoring'

/** One prompt of the topic's active set, with its target. */
export interface TopicPromptMeta {
  promptId: string
  stableKey: string
  number: number
  kind: TopicPromptKind
  text: string
  stage: TopicStage | null
  kwGroup: string | null
  kwGroupKind: KeywordGroupKind | null
  intent: KeywordIntent | null
  funnel: FunnelStage | null
  pageType: PageType | null
  targetPageId: string | null
  targetUrl: string | null
  /** The target normalized the way checks normalize cited URLs. */
  targetNormalizedUrl: string | null
  /** Other own pages that may answer it, and the same normalized. */
  alsoUrls?: readonly string[]
  alsoNormalizedUrls?: readonly string[]
  matchConfidence: number | null
  matchReason: string | null
  aiPageUrl?: string | null
  targetConfirmed: boolean
}

/** One run in the market, with each prompt's outcome keyed by stable key. */
export interface TopicRunOutcomes {
  runId: string
  /** Its finish; a running check's start. */
  finishedAt: string
  /**
   * True when the run did not check every prompt: a batch, a follow-up, a check
   * still running, or one that stopped part-way.
   */
  partial: boolean
  /**
   * `running`: the questions it scored so far. It counts for the current rows but is
   * no point on Progress and no side of a comparison until it ends. `stopped`: ended
   * part-way, kept as a partial check. Absent means finished.
   */
  state?: 'finished' | 'running' | 'stopped'
  outcomes: ReadonlyMap<string, TopicOutcome>
}

const NOT_CHECKED: TopicOutcome = {
  status: null,
  references: [],
  named: null,
  runId: null,
  checkedAt: null,
  aioSummary: null
}

export function topicRow(meta: TopicPromptMeta, outcome: TopicOutcome): TopicResultRow {
  const state = deriveRowState(outcome, meta.targetNormalizedUrl, meta.alsoNormalizedUrls ?? [])
  const own = citedOwn(outcome.references, meta.targetNormalizedUrl)
  return {
    promptId: meta.promptId,
    stableKey: meta.stableKey,
    number: meta.number,
    kind: meta.kind,
    text: meta.text,
    stage: meta.stage,
    kwGroup: meta.kwGroup,
    kwGroupKind: meta.kwGroupKind,
    intent: meta.intent,
    funnel: meta.funnel,
    pageType: meta.pageType,
    state,
    targetPageId: meta.targetPageId,
    targetUrl: meta.targetUrl,
    matchConfidence: meta.matchConfidence,
    matchReason: meta.matchReason,
    aiPageUrl: meta.aiPageUrl ?? null,
    alsoUrls: meta.alsoUrls ?? [],
    targetConfirmed: meta.targetConfirmed,
    citedOwnUrl: own?.url ?? null,
    citedInstead: citedInstead(outcome.references),
    position: own?.position ?? null,
    named: outcome.named,
    competitorCitedNotYou: competitorCitedNotYou(outcome.references),
    winOdds: winOdds({
      state,
      hasTarget: meta.targetNormalizedUrl !== null,
      matchConfidence: meta.matchConfidence,
      targetConfirmed: meta.targetConfirmed,
      references: outcome.references,
      named: outcome.named
    }),
    runId: outcome.runId,
    checkedAt: outcome.checkedAt,
    aioSummary: outcome.aioSummary
  }
}

/** The latest outcome per stable key across runs (oldest first). A pinned run reads only that run. */
export function currentOutcomes(
  runs: readonly TopicRunOutcomes[],
  pinnedRunId: string | null
): Map<string, TopicOutcome> {
  const out = new Map<string, TopicOutcome>()
  const chosen = pinnedRunId === null ? runs : runs.filter((run) => run.runId === pinnedRunId)
  for (const run of chosen) {
    for (const [key, outcome] of run.outcomes) {
      if (outcome.status !== null) out.set(key, outcome)
    }
  }
  return out
}

export function rowsFor(
  metas: readonly TopicPromptMeta[],
  outcomes: ReadonlyMap<string, TopicOutcome>
): TopicResultRow[] {
  return metas.map((meta) => topicRow(meta, outcomes.get(meta.stableKey) ?? NOT_CHECKED))
}

/** Goal % per check, oldest first. Partial runs are kept and flagged. */
export function progressSeries(
  metas: readonly TopicPromptMeta[],
  runs: readonly TopicRunOutcomes[]
): TopicProgressPoint[] {
  return runs.map((run) => {
    const rows = metas.map((meta) =>
      topicRow(meta, run.outcomes.get(meta.stableKey) ?? NOT_CHECKED)
    )
    return {
      runId: run.runId,
      finishedAt: run.finishedAt,
      partial: run.partial,
      questions: goalPoint(rows, 'question'),
      keywords: goalPoint(rows, 'keyword'),
      target: targetPoint(rows)
    }
  })
}

export interface AssembleTopicResultsInput {
  topic: TopicMeta
  bands: TopicBands
  metas: readonly TopicPromptMeta[]
  /** Finished runs in the market, oldest first. */
  runs: readonly TopicRunOutcomes[]
  pinnedRunId: string | null
  savedSummary: TopicSavedSummary | null
  edits?: readonly { date: string; text: string }[]
  builtAt: string
}

export function assembleTopicResults(input: AssembleTopicResultsInput): TopicResults {
  const outcomes = currentOutcomes(input.runs, input.pinnedRunId)
  const rows = rowsFor(input.metas, outcomes)
  const goals = {
    questions: topicGoal(rows, 'question', input.bands.questions),
    keywords: topicGoal(rows, 'keyword', input.bands.keywords)
  }
  const byStage = stageCoverage(rows)
  const extremes = stageExtremes(byStage)
  // A running check is no point on Progress and no side of a comparison: those wait for
  // its end, so a half-done check never reads as questions lost.
  const checking = input.runs.some((run) => run.state === 'running')
  const progress = progressSeries(
    input.metas,
    input.runs.filter((run) => run.state !== 'running')
  )
  const full = progress.filter((point) => !point.partial)
  const lastFull = full.at(-1) ?? null
  const previousFull = full.length >= 2 ? (full[full.length - 2] ?? null) : null
  const sinceRun =
    previousFull === null ? null : input.runs.find((run) => run.runId === previousFull.runId)
  const sinceRows =
    checking || sinceRun === undefined || sinceRun === null
      ? null
      : rowsFor(input.metas, new Map([...sinceRun.outcomes].filter(([, o]) => o.status !== null)))
  const gained: string[] = []
  const lost: string[] = []
  if (sinceRows !== null) {
    const before = new Map(sinceRows.map((row) => [row.stableKey, row.state]))
    for (const row of rows) {
      const was = before.get(row.stableKey)
      if (was === undefined || was === 'not_checked') continue
      if (isCitedState(row.state) && !isCitedState(was)) gained.push(row.promptId)
      if (!isCitedState(row.state) && isCitedState(was) && row.state !== 'not_checked') {
        lost.push(row.promptId)
      }
    }
  }
  const todo = todoGroups(rows)
  const next = todo
    .filter((group) => group.state !== 'right_page')
    .flatMap((group) => group.promptIds.map((id) => rows.find((row) => row.promptId === id)))
    .filter((row): row is TopicResultRow => row !== undefined && row.winOdds !== null)
    .sort((a, b) => (b.winOdds?.score ?? 0) - (a.winOdds?.score ?? 0))
    .slice(0, 3)
    .map((row) => row.promptId)
  const change = (
    kind: 'questions' | 'keywords'
  ): { change: number | null; sinceAt: string | null } => {
    const now = lastFull?.[kind] ?? null
    const was = previousFull?.[kind] ?? null
    if (checking || now === null || was === null || previousFull === null)
      return { change: null, sinceAt: null }
    return { change: now.cited - was.cited, sinceAt: previousFull.finishedAt }
  }
  const questionsTrend = change('questions')
  const keywordsTrend = change('keywords')
  const summaryInputs: TopicSummaryInputs = {
    sinceRunId: previousFull?.runId ?? null,
    sinceAt: previousFull?.finishedAt ?? null,
    questionsCitedChange: questionsTrend.change,
    keywordsCitedChange: keywordsTrend.change,
    gained,
    lost,
    weakestStage:
      extremes.weakest === null
        ? null
        : {
            stage: extremes.weakest.stage,
            cited: extremes.weakest.cited,
            withAio: extremes.weakest.withAio
          },
    strongestStage:
      extremes.strongest === null
        ? null
        : {
            stage: extremes.strongest.stage,
            cited: extremes.strongest.cited,
            withAio: extremes.strongest.withAio
          },
    next,
    edits: input.edits ?? []
  }
  return {
    topic: input.topic,
    goals,
    questionsTrend,
    keywordsTrend,
    rows,
    todo,
    byStage,
    keywords: keywordUniverse(rows),
    progress,
    competitorCitedNotYou: rows
      .filter((row) => row.competitorCitedNotYou)
      .map((row) => row.promptId),
    summaryInputs,
    savedSummary: input.savedSummary,
    builtAt: input.builtAt
  }
}
