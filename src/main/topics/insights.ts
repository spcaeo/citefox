import { createHash, randomUUID } from 'node:crypto'
import {
  MATCH_STATE_LABEL,
  TOPIC_STAGE_LABEL,
  type MatchState,
  type TopicResultRow
} from '@shared/domain'
import {
  WRITE_WITH_URL,
  type DraftFixResult,
  type ExplainCitationResult,
  type TopicCallInfo,
  type TopicResults,
  type TopicSummaryResult,
  type WhyNotCitedResult
} from '@shared/ipc'
import { loadGenerationTemplate } from '../pipeline/templates'
import { fence } from '../prompts/blocks'
import {
  bareDomain,
  brandInQuestion,
  causeProblem,
  citationFacts,
  fixDraftShapeProblem,
  fixDraftWordsProblem,
  trimFixDraft,
  verifiedPassage,
  type TaggedReference
} from '../prompts/citations'
import { wordsAskedOnce } from '../prompts/word-range'
import { readProjectProfile } from '../storage/project-profile'
import { bullets, runTopicTemplate } from './claude'
import { TopicInputError } from './drafts'
import { brandVars, type OpenedProject, type TopicEnv } from './env'
import { overviewForPrompt, standingLine, topicMarketBlock } from './insight-context'
import { pageForFix, pageForQuestion } from './page-context'
import { readPageOrLive } from './page-live'
import { stageLine } from './steps-pages'

/**
 * Topic results explanations and "what to fix next" (Docs/PROMPT-AUDIT.md, P5).
 *
 * - "Explain this citation" and "Why aren't we cited?" show one diagnosis
 *   (`topic_citation_diagnosis`), made once per run, prompt and inputs.
 * - "Draft the fix" (`topic_fix_draft`) starts from that diagnosis.
 * - The summary (`topic_summary`) and the next actions (`topic_next_actions`) run
 *   side by side.
 *
 * Every reply is checked in code: sources by number from the stored list, evidence
 * only when it is a real passage, Q numbers that exist, word counts, and no line
 * that credits a change with a citation.
 */

export function requireRow(results: TopicResults, promptId: string): TopicResultRow {
  const row = results.rows.find((item) => item.promptId === promptId || item.stableKey === promptId)
  if (row === undefined) throw new TopicInputError('That question is not in this topic.')
  return row
}

function hasOverview(row: TopicResultRow): boolean {
  return (
    row.runId !== null &&
    row.state !== 'no_aio' &&
    row.state !== 'failed' &&
    row.state !== 'not_checked'
  )
}

// ---------------------------------------------------------------------------
// Citation diagnosis (one call behind "Explain" and "Why not cited")
// ---------------------------------------------------------------------------

type DiagnosisReply = {
  summary: string
  reasons: { text: string; evidence: string | null }[]
  citedInstead: { source: number; whyItWins: string }[]
  facts: string[]
}

/** The diagnosis as both entry points show it. */
export interface CitationDiagnosis {
  row: TopicResultRow
  summary: string
  reasons: { text: string; evidence: string | null }[]
  citedInstead: { domain: string; url: string; whyItWins: string }[]
  /** Code's facts about who is cited, then what the overview tells the buyer. */
  facts: string[]
  references: TaggedReference[]
  info: TopicCallInfo
  createdAt: string
}

/** Most diagnoses kept in memory, so Explain, Why and Draft the fix share one call. */
export const DIAGNOSIS_CACHE_SIZE = 50
const diagnoses = new Map<string, CitationDiagnosis>()

/**
 * No line credits a change with a citation. Sources cited instead are numbers;
 * code keeps only numbers in the stored list that are not the business's own
 * site, so a domain the overview does not show can never reach the screen.
 */
export function diagnosisProblem(reply: DiagnosisReply): string | null {
  return causeProblem([
    reply.summary,
    ...reply.reasons.map((reason) => reason.text),
    ...reply.citedInstead.map((item) => item.whyItWins),
    ...reply.facts
  ])
}

async function diagnose(
  env: TopicEnv,
  opened: OpenedProject,
  topicId: string,
  results: TopicResults,
  promptId: string,
  channel: string
): Promise<CitationDiagnosis> {
  const row = requireRow(results, promptId)
  if (!hasOverview(row)) {
    throw new TopicInputError(
      'This question has no stored AI Overview to explain.',
      'Check the topic first.'
    )
  }
  const { db } = opened
  const overview = overviewForPrompt(db, {
    promptId: row.promptId,
    runId: row.runId,
    topicId,
    ownDomain: opened.project.domain
  })
  const page = await readPageOrLive(env.host, db, { pageId: row.targetPageId, url: row.targetUrl })
  const pageText = pageForQuestion(page, row.targetUrl, row.text)
  const brands = readProjectProfile(db)?.brandNames ?? []
  const context = {
    prompt: row.text,
    stage: stageLine(row.stage),
    market_block: topicMarketBlock(db, results.topic.marketId),
    checked_at: row.checkedAt?.slice(0, 10) ?? 'Not checked',
    status: standingLine(row, overview.references),
    page: row.targetUrl ?? 'No page yet',
    page_text: fence('page_text', pageText),
    aio_text: overview.overview,
    aio_references: overview.sources,
    ...brandVars(brands)
  }
  const template = loadGenerationTemplate(
    env.host.storage.db,
    'topic_citation_diagnosis',
    undefined,
    'templates:get',
    db
  )
  const key = createHash('sha256')
    .update(
      JSON.stringify([opened.project.id, row.runId, row.promptId, template.templateHash, context])
    )
    .digest('hex')
  const cached = diagnoses.get(key)
  if (cached !== undefined) return { ...cached, row }
  const reply = await runTopicTemplate<DiagnosisReply>({
    host: env.host,
    db,
    projectId: opened.project.id,
    pageId: topicId,
    kind: 'topic_citation_diagnosis',
    channel,
    context,
    check: diagnosisProblem
  })
  const passages = [overview.overviewText, pageText]
  const seen = new Set<number>()
  const diagnosis: CitationDiagnosis = {
    row,
    summary: reply.value.summary,
    reasons: reply.value.reasons.map((reason) => ({
      text: reason.text,
      evidence: verifiedPassage(reason.evidence, passages)
    })),
    citedInstead: reply.value.citedInstead.flatMap((item) => {
      const source = overview.references.find((reference) => reference.position === item.source)
      if (source === undefined || source.tag === 'own' || seen.has(item.source)) return []
      seen.add(item.source)
      return [{ domain: bareDomain(source.domain), url: source.url, whyItWins: item.whyItWins }]
    }),
    facts: [...citationFacts(overview.references), ...reply.value.facts].slice(0, 7),
    references: overview.references,
    info: reply.info,
    createdAt: env.host.now().toISOString()
  }
  diagnoses.set(key, diagnosis)
  while (diagnoses.size > DIAGNOSIS_CACHE_SIZE) {
    const oldest = diagnoses.keys().next().value
    if (oldest === undefined) break
    diagnoses.delete(oldest)
  }
  return diagnosis
}

/** `topics:whyNotCited`: the diagnosis, as reasons and the sources cited instead. */
export async function whyNotCited(
  env: TopicEnv,
  opened: OpenedProject,
  topicId: string,
  results: TopicResults,
  promptId: string
): Promise<WhyNotCitedResult> {
  const found = await diagnose(env, opened, topicId, results, promptId, 'topics:whyNotCited')
  return {
    promptId: found.row.promptId,
    reasons: found.reasons,
    citedInstead: found.citedInstead,
    summary: found.summary,
    info: found.info
  }
}

/** `topics:explainCitation`: the same diagnosis, as a short text and its facts. */
export async function explainCitation(
  env: TopicEnv,
  opened: OpenedProject,
  topicId: string,
  results: TopicResults,
  promptId: string
): Promise<ExplainCitationResult> {
  const found = await diagnose(env, opened, topicId, results, promptId, 'topics:explainCitation')
  const lead = found.reasons[0]?.text
  return {
    promptId: found.row.promptId,
    runId: found.row.runId,
    text: lead === undefined ? found.summary : `${found.summary} ${lead}`,
    facts: found.facts,
    createdAt: found.createdAt,
    info: found.info
  }
}

// ---------------------------------------------------------------------------
// Fix draft (on demand, after the diagnosis)
// ---------------------------------------------------------------------------

type FixReply = { where: 'target' | 'new'; steps: string[]; draft: string }

/** A first line and a body, no cause claims, no brand inside a buyer's question. */
export function fixShapeProblem(reply: FixReply, brands: readonly string[]): string | null {
  return (
    fixDraftShapeProblem(reply.draft) ??
    causeProblem([...reply.steps, reply.draft]) ??
    brandInQuestion([faqQuestion(reply.draft)], brands)
  )
}

/** Every check: the shape first, then the word count (with its 10% tolerance). */
export function fixProblem(reply: FixReply, brands: readonly string[]): string | null {
  return fixShapeProblem(reply, brands) ?? fixDraftWordsProblem(reply.draft)
}

/** The draft's FAQ question: its first line when that ends in "?", else nothing. Steps may quote page headings that name the brand. */
function faqQuestion(draft: string): string {
  const first = draft.split('\n')[0]?.trim() ?? ''
  return first.endsWith('?') ? first : ''
}

/** The diagnosis as the fix draft reads it. */
export function diagnosisText(found: CitationDiagnosis): string {
  const lines = [
    `Summary: ${found.summary}`,
    'Reasons, most likely first:',
    ...found.reasons.map(
      (reason, index) =>
        `${index + 1}. ${reason.text}${reason.evidence === null ? '' : ` (evidence: "${reason.evidence}")`}`
    ),
    found.citedInstead.length === 0 ? 'Sources cited instead: none.' : 'Sources cited instead:',
    ...found.citedInstead.map((item) => `- ${item.domain}: ${item.whyItWins}`),
    'What the overview tells the buyer:',
    ...found.facts.map((fact) => `- ${fact}`)
  ]
  return lines.join('\n')
}

/** `topics:draftFix`: the diagnosis (reused when made already), then the fix draft. */
export async function draftFix(
  env: TopicEnv,
  opened: OpenedProject,
  topicId: string,
  results: TopicResults,
  promptId: string
): Promise<DraftFixResult> {
  const row = requireRow(results, promptId)
  const started = Date.now()
  const found = hasOverview(row)
    ? await diagnose(env, opened, topicId, results, promptId, 'topics:draftFix')
    : null
  const { db } = opened
  const brands = readProjectProfile(db)?.brandNames ?? []
  const page = await readPageOrLive(env.host, db, { pageId: row.targetPageId, url: row.targetUrl })
  const reply = await runTopicTemplate<FixReply>({
    host: env.host,
    db,
    projectId: opened.project.id,
    pageId: topicId,
    kind: 'topic_fix_draft',
    channel: 'topics:draftFix',
    context: {
      prompt: row.text,
      stage: stageLine(row.stage),
      market_block: topicMarketBlock(db, results.topic.marketId),
      page: row.targetUrl ?? 'No page yet',
      page_text: fence('page_text', pageForFix(page, row.targetUrl)),
      diagnosis:
        found === null
          ? `${standingLine(row, [])} There is no overview to compare with; write the block that answers the question directly.`
          : diagnosisText(found),
      ...brandVars(brands)
    },
    // The word count is named once; a draft still too long after that is trimmed.
    check: wordsAskedOnce(
      (value: FixReply) => fixShapeProblem(value, brands),
      (value) => fixDraftWordsProblem(value.draft)
    )
  })
  const draft = trimFixDraft(reply.value.draft)
  const newPage = reply.value.where === 'new' || row.targetUrl === null
  const text = [
    `Question: ${row.text}`,
    `Where: ${newPage ? 'a new page' : (row.targetUrl ?? '')}`,
    '',
    ...reply.value.steps.map((step, index) => `${index + 1}. ${step}`),
    '',
    draft
  ].join('\n')
  return {
    promptId: row.promptId,
    where: {
      pageId: newPage ? null : row.targetPageId,
      url: newPage ? null : row.targetUrl,
      newPage
    },
    steps: reply.value.steps,
    draft,
    text,
    writeWithUrl: WRITE_WITH_URL,
    info: { ...reply.info, durationMs: Math.max(0, Date.now() - started) }
  }
}

// ---------------------------------------------------------------------------
// Summary and next actions (two calls, side by side)
// ---------------------------------------------------------------------------

/** The results block of `topic_summary.md` and `topic_next_actions.md`. Exported for tests. */
export function resultsText(results: TopicResults): string {
  const q = results.goals.questions
  const k = results.goals.keywords
  const byNumber = new Map(results.rows.map((row) => [row.promptId, `Q${row.number}`]))
  const names = (ids: readonly string[]): string =>
    ids.map((id) => byNumber.get(id) ?? id).join(', ') || 'none'
  const lines = [
    `Buyer questions: ${q.cited} of ${q.withAio} with an overview cited (${q.rate ?? 0}%), target ${q.band.lo}–${q.band.hi}%, ${q.toReachBand} more needed to reach the band; ${q.noAio} showed no overview; ${q.failed} searches failed.`,
    k.prompts > 0
      ? `Keywords (measured apart): ${k.cited} of ${k.withAio} cited (${k.rate ?? 0}%), target ${k.band.lo}–${k.band.hi}%, brand named in ${k.named}.`
      : '',
    `By stage: ${results.byStage.map((stage) => `${TOPIC_STAGE_LABEL[stage.stage]} ${stage.cited} of ${stage.withAio}`).join('; ')}`,
    `To-do: ${results.todo.map((group) => `${group.label} ${group.count}`).join('; ')}`,
    // With no earlier check there is no date to start "Since <date>:" from; say
    // so plainly, matching the template's "First check:" rule.
    results.summaryInputs.sinceAt === null
      ? 'First check: there is no earlier check to compare with, so nothing is newly or no longer cited.'
      : `Since ${results.summaryInputs.sinceAt.slice(0, 10)}: newly cited ${names(results.summaryInputs.gained)}; no longer cited ${names(results.summaryInputs.lost)}.`,
    `Likeliest next: ${names(results.summaryInputs.next)}`
  ]
  return lines.filter(Boolean).join('\n')
}

/** To-do order for the next actions: closest to a citation first. */
const STATE_ORDER: Readonly<Record<MatchState, number>> = {
  not_cited: 0,
  other_page: 1,
  no_page: 2,
  right_page: 3,
  no_aio: 4
}

/** Most question lines the next actions read. */
export const NEXT_ACTION_ROWS = 40

/** `{{ matches }}`: questions still to win, closest first. Exported for tests. */
export function matchesText(results: TopicResults): string {
  const rows = results.rows
    .filter((row) => row.kind === 'question' && row.state !== 'right_page')
    .filter((row) => row.state !== 'not_checked' && row.state !== 'failed')
    .sort(
      (a, b) =>
        STATE_ORDER[a.state as MatchState] - STATE_ORDER[b.state as MatchState] ||
        (b.winOdds?.score ?? 0) - (a.winOdds?.score ?? 0) ||
        a.number - b.number
    )
    .slice(0, NEXT_ACTION_ROWS)
  if (rows.length === 0) return 'None: every checked question is cited by the right page.'
  return rows
    .map((row) => {
      const target =
        row.targetUrl === null
          ? 'no page yet'
          : `${pathOf(row.targetUrl)}${row.matchConfidence === null ? '' : ` (${row.matchConfidence})`}`
      const instead =
        row.citedInstead.length === 0 ? 'no other source' : row.citedInstead.join(', ')
      return [
        `Q${row.number}`,
        row.stage === null ? 'no stage' : TOPIC_STAGE_LABEL[row.stage],
        MATCH_STATE_LABEL[row.state as MatchState],
        target,
        row.state === 'no_aio' ? 'no overview' : `cited instead: ${instead}`,
        row.text
      ].join(' · ')
    })
    .join('\n')
}

/** `{{ gaps }}`: per stage, what is cited and which questions have no page. Exported for tests. */
export function gapsText(results: TopicResults): string {
  const lines = results.byStage
    .filter((stage) => stage.prompts > 0)
    .map((stage) => {
      const noPage = results.rows
        .filter(
          (row) => row.stage === stage.stage && row.kind === 'question' && row.state === 'no_page'
        )
        .map((row) => `Q${row.number}`)
      return `${TOPIC_STAGE_LABEL[stage.stage]}: ${stage.cited} of ${stage.withAio} with an overview cited, ${stage.noAio} without an overview${noPage.length === 0 ? '' : `; no page yet for ${noPage.join(', ')}`}.`
    })
  return lines.length === 0 ? 'None found.' : lines.join('\n')
}

type ActionsReply = {
  nextActions: { text: string; promptNumbers: number[]; verify: string | null }[]
}

/** Q numbers that are questions of this topic; no cause claims. */
export function actionsProblem(reply: ActionsReply, numbers: ReadonlySet<number>): string | null {
  // Code drops a number that is not a question of this topic; an action left with none fails.
  const index = reply.nextActions.findIndex(
    (action) => !action.promptNumbers.some((n) => numbers.has(n))
  )
  if (index >= 0) {
    return `Action ${index + 1} names no question from the list; use its Q numbers.`
  }
  return causeProblem(reply.nextActions.map((action) => action.text))
}

/** `topics:topicSummary`: the summary and the next 3 actions, written side by side; saved. */
export async function topicSummary(
  env: TopicEnv,
  opened: OpenedProject,
  topicId: string,
  results: TopicResults
): Promise<TopicSummaryResult> {
  const brands = readProjectProfile(opened.db)?.brandNames ?? []
  const market =
    results.topic.markets.find((item) => item.id === results.topic.marketId)?.label ??
    results.topic.marketId
  const base = {
    host: env.host,
    db: opened.db,
    projectId: opened.project.id,
    pageId: topicId
  }
  const shared = {
    topic: results.topic.name,
    market,
    results: resultsText(results),
    ...brandVars(brands)
  }
  const byNumber = new Map(
    results.rows.filter((row) => row.kind === 'question').map((row) => [row.number, row.promptId])
  )
  const numbers = new Set(byNumber.keys())
  const started = Date.now()
  const [summary, actions] = await Promise.all([
    runTopicTemplate<{ line: string; executive: string }>({
      ...base,
      kind: 'topic_summary',
      channel: 'topics:topicSummary',
      context: {
        ...shared,
        edits: bullets(results.summaryInputs.edits.map((edit) => `${edit.date}: ${edit.text}`))
      },
      check: (value) => causeProblem([value.line, value.executive])
    }),
    runTopicTemplate<ActionsReply>({
      ...base,
      kind: 'topic_next_actions',
      channel: 'topics:topicSummary',
      context: { ...shared, matches: matchesText(results), gaps: gapsText(results) },
      check: (value) => actionsProblem(value, numbers)
    })
  ])
  const createdAt = env.host.now().toISOString()
  const runId = results.progress.at(-1)?.runId ?? null
  const nextActions = actions.value.nextActions.map((action) => ({
    text: action.text,
    promptIds: action.promptNumbers
      .map((n) => byNumber.get(n))
      .filter((id): id is string => id !== undefined),
    verify: action.verify
  }))
  opened.db
    .prepare(
      `INSERT INTO topic_summaries (id, page_id, market_id, run_id, line, executive, actions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      `tsum-${randomUUID()}`,
      topicId,
      results.topic.marketId,
      runId,
      summary.value.line.slice(0, 600),
      summary.value.executive.slice(0, 3000),
      JSON.stringify(nextActions),
      createdAt
    )
  return {
    line: summary.value.line,
    executive: summary.value.executive,
    nextActions,
    saved: { text: summary.value.line, createdAt, runId },
    info: { ...summary.info, durationMs: Math.max(0, Date.now() - started) }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pathOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}` || '/'
  } catch {
    return url
  }
}
