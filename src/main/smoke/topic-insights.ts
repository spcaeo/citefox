import type { TopicResultRow } from '@shared/domain'
import { wordCount } from '../pipeline/hash'
import { bareDomain, fixDraftProblem, fixDraftShapeProblem } from '../prompts/citations'
import { closeProjectDatabase, openProjectDatabase } from '../storage'
import { storedOverview } from '../topics/insight-context'
import type { SmokeHookResult, TopicSmokeHookContext } from './hook-context'
import { SmokeError, step } from './live'
import { namesBrand, TOPIC_SMOKE_PROJECT } from './topic-args'

/**
 * Topic insights in the live smoke (Docs/PROMPT-AUDIT.md, package P5). Runs at the
 * end of every `--topic` run, after "why not cited", on the run's stored results.
 * No SerpApi search; the Claude calls are the diagnoses not made yet (the one
 * behind "why not cited" is reused), one fix draft and one page brief.
 *
 * Prints the page match of each checked question, the three saved next actions,
 * every diagnosis (summary, reasons with evidence, sources cited instead, facts),
 * the fix draft and the brief's outline. Fails when a source cited instead is not
 * in that question's stored sources, when a next action names no checked
 * question, when the fix draft is outside its word range or names the brand in a
 * buyer question, or when "Explain" and "Why not cited" disagree.
 */
export async function runTopicInsightsSmoke(
  context: TopicSmokeHookContext
): Promise<SmokeHookResult> {
  const { handlers, io, push, secrets } = context
  const base = { projectId: context.projectId, topicId: context.topicId }
  const results = await handlers['topics:results']({
    ...base,
    marketId: context.marketId,
    runId: null
  })
  const rows = results.rows.filter(
    (row) => row.state !== 'no_aio' && row.state !== 'not_checked' && row.state !== 'failed'
  )
  for (const row of results.rows) {
    io.stdout(
      `match Q${row.number}: ${row.targetUrl ?? 'no page'} (${row.matchConfidence ?? '-'}) ${row.matchReason ?? ''}`
    )
  }

  await step(push, secrets, 'next-actions', () => {
    const actions = savedActions(context)
    if (actions.length !== 3) throw new SmokeError(`Saved ${actions.length} next actions, not 3.`)
    const known = new Set(results.rows.map((row) => row.promptId))
    actions.forEach((action, index) => {
      io.stdout(
        `action ${index + 1}: ${action.text} [${action.promptIds.map((id) => `Q${numberOf(results.rows, id)}`).join(', ')}]${action.verify === null ? '' : ` verify: ${action.verify}`}`
      )
      if (action.promptIds.length === 0 || action.promptIds.some((id) => !known.has(id))) {
        throw new SmokeError(`Next action ${index + 1} names no checked question.`)
      }
    })
    return Promise.resolve(`actions=${actions.length}`)
  })

  if (rows.length === 0) {
    return { ran: true, detail: 'no checked question showed an AI Overview' }
  }
  let sourcesTotal = 0
  for (const row of rows) {
    await step(push, secrets, `diagnosis-Q${row.number}`, async () => {
      const request = { ...base, promptId: row.promptId, marketId: context.marketId }
      const why = await handlers['topics:whyNotCited'](request)
      const explain = await handlers['topics:explainCitation']({ ...request, runId: null })
      const domains = referenceDomains(context, row)
      io.stdout(`diagnosis Q${row.number} (${row.state}, ${domains.size} sources): ${why.summary}`)
      why.reasons.forEach((reason, index) =>
        io.stdout(
          `  reason ${index + 1}: ${reason.text}${reason.evidence === null ? '' : ` | evidence: "${reason.evidence}"`}`
        )
      )
      for (const item of why.citedInstead) {
        io.stdout(`  cited instead: ${item.domain} — ${item.whyItWins}`)
        if (!domains.has(bareDomain(item.domain))) {
          throw new SmokeError(`${item.domain} is not one of Q${row.number}'s stored sources.`)
        }
      }
      for (const fact of explain.facts) io.stdout(`  fact: ${fact}`)
      if (!explain.text.startsWith(why.summary)) {
        throw new SmokeError('"Explain" and "Why not cited" gave different diagnoses.')
      }
      sourcesTotal += why.citedInstead.length
      return `reasons=${why.reasons.length} cited-instead=${why.citedInstead.length} evidence=${why.reasons.filter((reason) => reason.evidence !== null).length}`
    })
  }

  const target =
    [...rows].sort((a, b) => b.citedInstead.length - a.citedInstead.length)[0] ?? rows[0]
  if (target !== undefined) {
    const brands = [...TOPIC_SMOKE_PROJECT.brandNames]
    await step(push, secrets, `fix-draft-Q${target.number}`, async () => {
      const fix = await handlers['topics:draftFix']({
        ...base,
        promptId: target.promptId,
        marketId: context.marketId
      })
      io.stdout(
        `fix Q${target.number} where: ${fix.where.newPage ? 'a new page' : (fix.where.url ?? '')}`
      )
      fix.steps.forEach((line, index) => io.stdout(`  step ${index + 1}: ${line}`))
      io.stdout(`  draft: ${fix.draft.replace(/\n/gu, ' / ')}`)
      // Word ranges guide (10% tolerance, then trimmed); only a block without a body fails.
      const problem = fixDraftProblem(fix.draft)
      if (fixDraftShapeProblem(fix.draft) !== null) throw new SmokeError(problem ?? 'No body.')
      if (problem !== null) io.stdout(`  note: ${problem}`)
      const question = fix.draft.split('\n')[0] ?? ''
      if (question.endsWith('?') && namesBrand(question, brands)) {
        throw new SmokeError('The fix draft names the brand in the buyer question.')
      }
      return `steps=${fix.steps.length} words=${wordCount(fix.draft)}`
    })
    await step(push, secrets, `page-brief-Q${target.number}`, async () => {
      const brief = await handlers['topics:draftPageBrief']({
        ...base,
        promptId: target.promptId,
        marketId: context.marketId
      })
      io.stdout(`brief Q${target.number}: ${brief.summary}`)
      brief.outline.forEach((heading, index) => io.stdout(`  outline ${index + 1}: ${heading}`))
      return `outline=${brief.outline.length} words=${wordCount(brief.text)}`
    })
  }
  return { ran: true, detail: `diagnoses=${rows.length} cited-instead=${sourcesTotal}` }
}

function savedActions(
  context: TopicSmokeHookContext
): { text: string; promptIds: string[]; verify: string | null }[] {
  const db = openProjectDatabase(context.storage.paths.projectsDirectory, TOPIC_SMOKE_PROJECT.slug)
  try {
    const row = db
      .prepare<unknown[], { actions_json: string }>(
        'SELECT actions_json FROM topic_summaries WHERE page_id = ? ORDER BY created_at DESC LIMIT 1'
      )
      .get(context.topicId)
    if (row === undefined) return []
    const parsed = JSON.parse(row.actions_json) as unknown
    return Array.isArray(parsed)
      ? (parsed as { text: string; promptIds: string[]; verify: string | null }[])
      : []
  } finally {
    closeProjectDatabase(db)
  }
}

function referenceDomains(context: TopicSmokeHookContext, row: TopicResultRow): Set<string> {
  const db = openProjectDatabase(context.storage.paths.projectsDirectory, TOPIC_SMOKE_PROJECT.slug)
  try {
    return new Set(
      storedOverview(db, row.promptId, row.runId).references.map((ref) => bareDomain(ref.domain))
    )
  } finally {
    closeProjectDatabase(db)
  }
}

function numberOf(rows: readonly TopicResultRow[], promptId: string): string {
  return String(rows.find((row) => row.promptId === promptId)?.number ?? '?')
}
