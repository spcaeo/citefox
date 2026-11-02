import type { CoverageRecord } from '@shared/domain'
import { FAQ_DRAFT_MAX_WORDS, FAQ_DRAFT_MIN_WORDS } from '@shared/domain'
import { DATA_FENCE_RULE, fence, FIX_DRAFT_RULES } from '../../prompts/blocks'
import { brandInQuestion, causeProblem } from '../../prompts/citations'
import { getLatestCoverage } from '../../storage/content-records'
import type { SqliteDatabase } from '../../storage/database'
import { AssistInputError, type AssistDefinition, type AssistReply } from '../types'
import {
  brandNamesOf,
  findPrompt,
  formatPageBody,
  formatPageHead,
  formatPrompt,
  marketIdOf,
  pageOf,
  promptSetOf,
  snapshotOf
} from './gather'
import { replyTexts } from './results'
import { faqAnswerWords } from './rules'

/** Gaps screen assists: one prompt's fix, drafted from its coverage row. */

export function coverageRowOf(
  db: SqliteDatabase,
  pageId: string,
  contentHash: string,
  promptId: string
): CoverageRecord {
  const matrix = getLatestCoverage(db, pageId, contentHash)
  if (matrix === null) {
    throw new AssistInputError('Build the coverage matrix first.', 'Open Gaps and build it.')
  }
  const row = matrix.rows.find((item) => item.promptId === promptId)
  if (row === undefined) {
    throw new AssistInputError(
      'This prompt has no coverage row yet.',
      'Rebuild the coverage matrix on Gaps.'
    )
  }
  return row
}

export function formatCoverageRow(row: CoverageRecord): string {
  const faq =
    row.suggestedFaq === null
      ? 'none'
      : `Q: ${row.suggestedFaq.question}\nA: ${row.suggestedFaq.answer}`
  return [
    `Coverage: ${row.coverage}. Priority: ${row.priority}. Actions: ${row.actions.join(', ')}.${row.done ? ' Marked done.' : ''}`,
    `Where covered now: ${row.whereCovered.length === 0 ? 'nowhere' : row.whereCovered.join('; ')}`,
    `What's there now: ${row.currentContent}`,
    `Main gap: ${row.mainGap}`,
    `What to update: ${row.whatToUpdate}`,
    `Saved FAQ draft: ${faq}`
  ].join('\n')
}

/**
 * The check every "draft the fix" assist shares: each new FAQ answer in range, no
 * brand inside the buyer's question, and no claim that a change wins a citation.
 */
export function draftBlocksProblem(reply: AssistReply, brands: readonly string[]): string | null {
  const faqs = reply.items.filter((item) => item.tag?.trim().toLowerCase() === 'new faq')
  const short = faqs.some((item) => {
    const words = faqAnswerWords(item.text)
    return words < FAQ_DRAFT_MIN_WORDS || words > FAQ_DRAFT_MAX_WORDS
  })
  if (short) {
    return `Write each FAQ answer in ${FAQ_DRAFT_MIN_WORDS} to ${FAQ_DRAFT_MAX_WORDS} words, after the question line.`
  }
  return (
    brandInQuestion(
      faqs.map((item) => item.text.split('\n')[0] ?? ''),
      brands
    ) ?? causeProblem(replyTexts(reply))
  )
}

export const GAP_ASSISTS: readonly AssistDefinition[] = [
  {
    id: 'gaps.draftFix',
    title: 'Draft the fix',
    expectedSeconds: 12,
    acceptsInstruction: true,
    needsProject: true,
    needs: ['pageId', 'promptId'],
    minItems: 1,
    maxItems: 4,
    task: `Draft the fix for the prompt under "Prompt", from its coverage row and the page.
Give one item per block to paste into the page:
- tag "update": the existing section or FAQ to change. text is the new wording to paste. detail names the section exactly as it is written on the page and says what changed.
- tag "new FAQ": text is the question on the first line, as this buyer would ask it, then the answer of ${FAQ_DRAFT_MIN_WORDS} to ${FAQ_DRAFT_MAX_WORDS} words on the next line, in the page's voice. detail says where on the page it goes.
Close the main gap of the coverage row; use facts the page states.
${FIX_DRAFT_RULES}
${DATA_FENCE_RULE}`,
    gather(context) {
      const opened = pageOf(context)
      const snapshot = snapshotOf(opened.db, opened.page.id)
      const set = promptSetOf(opened.db, opened.page.id)
      const prompt = findPrompt(set, context.request.promptId)
      const row = coverageRowOf(opened.db, opened.page.id, snapshot.contentHash, prompt.id)
      return [
        `Prompt: ${formatPrompt(prompt, marketIdOf(context, opened.page))}`,
        '',
        'Coverage row:',
        formatCoverageRow(row),
        '',
        formatPageHead(opened.page, snapshot),
        '',
        fence('page_text', formatPageBody(snapshot))
      ].join('\n')
    },
    check: (reply, context) => draftBlocksProblem(reply, brandNamesOf(pageOf(context).db))
  }
]
