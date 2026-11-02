import type { OwnerWhyResult } from './ipc/ownerWhy'

/**
 * "Why Google picks" for an owner fix, as text: the lines the Page edits prompt
 * reads as advice when it marks up the recommended owner page. Pure.
 */

/** The most characters of advice one page-edit request carries. */
export const OWNER_CONTEXT_MAX = 4000

/** The comparison's findings for the owner page, as plain lines, at most {@link OWNER_CONTEXT_MAX}. */
export function ownerWhyContext(result: OwnerWhyResult): string {
  const lines = [
    `Google's AI Overview cites ${result.citedUrl} instead of ${result.targetUrl} for these searches.`,
    `Recommended owner: ${result.ownerUrl}. ${result.reason}`,
    '',
    'What the answer needs to say:',
    ...result.answerNeeds.map((need) => `- ${need}`),
    '',
    'What to change on this page:',
    ...result.toChange.map((item) => `- ${item.section}: ${item.change} (${item.why})`)
  ]
  const text = lines.join('\n').trim()
  return text.length <= OWNER_CONTEXT_MAX ? text : `${text.slice(0, OWNER_CONTEXT_MAX - 1)}…`
}
