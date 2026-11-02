import { checkReportsRoot, statusLabel } from '../../engine/checks/report-files'
import { loadPromptDetail } from '../../engine/checks/results'
import { competitorContext } from '../../engine/competitor-context'
import { formatOutline } from '../../pipeline/template-context'
import {
  CITATION_DIAGNOSIS_RULES,
  DATA_FENCE_RULE,
  fence,
  NO_CAUSE_RULE
} from '../../prompts/blocks'
import {
  bareDomain,
  causeProblem,
  NEXT_ACTION_RULES,
  overviewWithSources,
  referencesBlock,
  tagReferences
} from '../../prompts/citations'
import { getLatestCoverage } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { listFixFollowUps } from '../../storage/fix-follow-ups'
import {
  AssistInputError,
  type AssistContext,
  type AssistDefinition,
  type AssistReply
} from '../types'
import {
  clip,
  day,
  formatPageHead,
  formatRows,
  formatRun,
  marketIdOf,
  marketLabel,
  marketOf,
  pageOf,
  resultsOf,
  type OpenedPage,
  snapshotOf
} from './gather'

/** Results screen assists. They describe changes side by side and never claim a cause. */

export function formatFixes(db: SqliteDatabase, pageId: string): string {
  const fixes = listFixFollowUps(db, pageId)
  if (fixes.length === 0) return 'No fixes logged on this page.'
  return fixes
    .map(
      (fix) =>
        `Fix ${fix.number}, live ${day(fix.goLiveAt)}: ${clip(fix.description, 300)} (prompts ${fix.promptIds.join(', ')}; ${fix.status}${fix.verdict === null ? '' : `; verdict: ${fix.verdict}`})`
    )
    .join('\n')
}

/** Open rows of the latest coverage matrix, highest priority first. */
export function formatOpenGaps(db: SqliteDatabase, pageId: string, contentHash: string): string {
  const matrix = getLatestCoverage(db, pageId, contentHash)
  if (matrix === null) return 'No coverage matrix saved yet.'
  const order = { high: 0, medium: 1, low: 2 }
  const open = matrix.rows
    .filter((row) => !row.done && row.coverage !== 'strong')
    .sort((left, right) => order[left.priority] - order[right.priority])
  if (open.length === 0) return 'Every coverage row is strong or marked done.'
  return open
    .map(
      (row) =>
        `Prompt id ${row.promptId}: ${row.coverage}, ${row.priority} priority. Main gap: ${row.mainGap} What to update: ${row.whatToUpdate}`
    )
    .join('\n')
}

/** Every summary, item text and detail of an assist reply, for the no-cause check. */
export function replyTexts(reply: AssistReply): string[] {
  return [
    reply.summary ?? '',
    ...reply.items.flatMap((item) => [item.text, item.detail ?? '']),
    reply.caution ?? ''
  ].filter((text) => text.length > 0)
}

/** The saved detail of the prompt a "why not first" request names. */
function promptDetailOf(context: AssistContext): {
  opened: OpenedPage
  marketId: string
  detail: ReturnType<typeof loadPromptDetail>
} {
  const opened = pageOf(context)
  const marketId = marketIdOf(context, opened.page)
  const detail = loadPromptDetail(opened.db, {
    projectId: opened.project.id,
    pageId: opened.page.id,
    marketId,
    runId: null,
    promptId: context.request.promptId ?? '',
    builtAt: context.host.now().toISOString(),
    domain: opened.project.domain,
    keyLabels: new Map(),
    reportsRoot: checkReportsRoot(context.host.storage.paths.root)
  })
  return { opened, marketId, detail }
}

export const RESULT_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'results.explainChange',
    title: 'Explain what changed',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 1,
    maxItems: 8,
    task: `Explain in plain words what changed between the previous check and the latest check in this market.
Say which prompts gained or lost a citation of this page, which moved position, and which other sites are now cited above it.
Put the page's content change and any fix that went live between the two checks side by side with the citation change, with their dates. ${NO_CAUSE_RULE} Google's overviews also change on their own.
summary is two or three sentences. One item per change: text is the change, detail gives the prompt and the numbers, tag is gained, lost, moved, or content.`,
    gather(context) {
      const opened = pageOf(context)
      const marketId = marketIdOf(context, opened.page)
      const results = resultsOf(context, opened, marketId)
      if (results.comparison[1].runId === null) {
        throw new AssistInputError(
          'There is only one check in this market.',
          'Run another check, then compare.'
        )
      }
      return [
        `Market: ${marketLabel(marketOf(opened.db, marketId))}`,
        formatRun(results),
        '',
        'Prompts:',
        formatRows(results),
        '',
        'Fixes logged:',
        formatFixes(opened.db, opened.page.id)
      ].join('\n')
    }
    // No claimsCause check here: this reply must put fixes and citation changes side
    // by side ("cited before the fix and after it"), which the sentence check flags.
  },
  {
    id: 'results.topActions',
    title: 'Top actions',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId'],
    minItems: 3,
    maxItems: 5,
    task: `Pick the top three to five actions for this page from the saved results and the open coverage gaps.
${NEXT_ACTION_RULES}
- On this page, rank first the prompts that lost this page's citation since the last check, then overviews that cite a competitor or another of the business's pages instead of this page, then high-priority coverage gaps.
One item per action, best first: text is the action as one instruction that names the section of this page ("Add an FAQ under 'Pricing' that answers …"), detail says which prompts it covers and what the overview shows now, tag is the prompt number it starts with, such as "Prompt 4".`,
    gather(context) {
      const opened = pageOf(context)
      const marketId = marketIdOf(context, opened.page)
      const results = resultsOf(context, opened, marketId)
      const leaders = results.leaderboard
        .slice(0, 6)
        .map((row) => `${row.domain} (${row.badge}): in ${row.aioCount} overviews`)
        .join('\n')
      const stored = results.topActions
        .map((action) => `${action.rank}. ${action.text} — ${action.reason}`)
        .join('\n')
      return [
        `Market: ${marketLabel(marketOf(opened.db, marketId))}`,
        formatRun(results),
        '',
        'Prompts:',
        formatRows(results),
        '',
        'Open coverage gaps:',
        formatOpenGaps(opened.db, opened.page.id, results.run?.contentHash ?? ''),
        '',
        'Sites cited most:',
        leaders || 'none',
        '',
        'Actions CiteFox already listed:',
        stored || 'none',
        '',
        'Fixes logged:',
        formatFixes(opened.db, opened.page.id)
      ].join('\n')
    },
    check: (reply) => causeProblem(replyTexts(reply))
  },
  {
    id: 'results.whyNotFirst',
    title: 'Why not cited first',
    expectedSeconds: 8,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId', 'promptId'],
    minItems: 1,
    maxItems: 6,
    task: `Explain why this page is not the first source the saved AI Overview cites for the prompt under "Prompt", and who it cites instead.
${CITATION_DIAGNOSIS_RULES}
- Name sources by their number and domain from "Sources cited, in order". A passage followed by [n] in the overview text is backed by source n.
- Check "Where the page covers it" and the outline before you say the page lacks something.
- ${DATA_FENCE_RULE}
One item per reason, most likely first: text is the reason in one sentence, detail is the passage copied from the overview or the page heading it rests on (null when there is none), tag is the domain of the source the reason is about, copied from the list, or "page" when it is about this page itself.
summary is two sentences: who the overview leans on and for what, then where this page stands now.`,
    gather(context) {
      const { opened, marketId, detail } = promptDetailOf(context)
      const row = detail.row
      if (row === null) {
        throw new AssistInputError(
          'This prompt has no result in the latest check.',
          'Press Check now, then try again.'
        )
      }
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const sample = detail.samples.find((item) => item.aioText !== null) ?? null
      const tagged = tagReferences(
        row.references,
        competitorContext(opened.db, { pageId: opened.page.id }),
        opened.project.domain
      )
      const read = overviewWithSources(
        sample?.rawAioJson ?? null,
        sample?.aioText ?? null,
        row.references
      )
      const gaps =
        detail.aioGap === null
          ? 'Not saved for this prompt.'
          : detail.aioGap
              .map(
                (fact) =>
                  `- ${fact.fact}${fact.likelySource === null ? '' : ` (likely from ${fact.likelySource})`}`
              )
              .join('\n')
      return [
        `Market: ${marketLabel(marketOf(opened.db, marketId))}`,
        `Prompt ${row.promptPosition}: ${row.text}`,
        `Status: ${statusLabel(row.status)}${row.position === null ? '' : ` at #${row.position}`}.`,
        `Where the page covers it: ${detail.whereCovered.join('; ') || 'not saved'}`,
        '',
        'Sources cited, in order (n. domain · title · own site, direct or partial competitor, or other · url):',
        referencesBlock(tagged, read.snippets),
        '',
        'Overview text ([n] names the sources Google showed for a passage):',
        fence('overview', read.text.length > 0 ? read.text : 'Not saved.'),
        '',
        'Facts the overview states that the page does not:',
        gaps,
        '',
        formatPageHead(opened.page, snapshot),
        'Outline:',
        formatOutline(snapshot.outline)
      ].join('\n')
    },
    check(reply, context) {
      const domains = new Set(
        (promptDetailOf(context).detail.row?.references ?? []).map((ref) => bareDomain(ref.domain))
      )
      const bad = reply.items.find((item) => {
        const tag = item.tag?.trim().toLowerCase() ?? ''
        return tag !== 'page' && !domains.has(bareDomain(tag))
      })
      if (bad !== undefined) {
        return `Tag "${bad.tag ?? ''}" is not a source in the list; use a source's domain or "page".`
      }
      return causeProblem(replyTexts(reply))
    }
  }
]
