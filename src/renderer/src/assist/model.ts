import type { AssistItem, AssistResult } from '@shared/ipc'
import { errorText } from '../components/errorText'

/**
 * Button text shown before `assist:describe` answers. Main's title wins once it
 * arrives; these keep the button from flashing a generic word on first paint.
 * Copy follows the mock-ups.
 */
const FALLBACK_TITLES: Readonly<Record<string, string>> = {
  'page.shorterTitle': 'Suggest a shorter title',
  'page.promises': 'Summarize what this page promises',
  'page.checkFacts': 'Check facts on the page',
  'page.verifyClaims': 'Check the claims online',
  'audience.triggers': 'Find more trigger events',
  'audience.sharpen': 'Sharpen with CiteFox AI',
  'prompts.more': 'Write more like this',
  'prompts.rephrase': 'Rephrase',
  'prompts.checkPage': 'Check against the page',
  'gaps.draftFix': 'Draft the fix',
  'results.explainChange': 'Explain this change',
  'results.topActions': 'Suggest top actions',
  'results.whyNotFirst': "Why isn't my page first?",
  'progress.nextFix': 'Suggest next fix',
  'progress.otherMarkets': 'Check if this fix worked in other markets',
  'progress.draftFix': 'Draft the fix',
  'markets.suggest': 'Suggest markets to add',
  'markets.localPrompts': 'Write local questions',
  'markets.whatsDifferent': "What's different in this market?",
  'status.explainUsage': 'Explain my usage',
  'status.explainErrors': 'Explain these errors',
  'report.summary': 'Summarize this run',
  'history.whatChanged': 'What changed',
  'template.improve': 'Improve this template',
  'communities.reply': 'Draft a helpful reply',
  'citations.pitch': 'Draft a pitch',
  'alerts.describeRule': 'Describe the rule',
  'fixes.anchorText': 'Suggest anchor text',
  'fixes.recoveryPlan': 'Write a recovery plan'
}

export function fallbackAssistTitle(assistId: string): string {
  return FALLBACK_TITLES[assistId] ?? 'Ask CiteFox AI'
}

/** "No new searches": the FR-25.4 badge. */
export const NO_NEW_SEARCHES = 'No new searches'

export const INSTRUCTION_PLACEHOLDER = 'Tell CiteFox AI what to change…'

/** Plain text for a failed assist call, without Electron's wrapper or the channel name. */
export function assistErrorText(error: unknown): string {
  return errorText(error, 'CiteFox AI could not finish this. Try again.')
}

/** What Copy puts on the clipboard for one item. */
export function itemCopyText(item: AssistItem): string {
  return item.detail ? `${item.text}\n${item.detail}` : item.text
}

/** Every item of a result as one block, for a "Copy all". */
export function resultCopyText(result: AssistResult): string {
  const parts: string[] = []
  if (result.summary) parts.push(result.summary)
  for (const item of result.items) parts.push(itemCopyText(item))
  if (result.caution) parts.push(result.caution)
  return parts.join('\n\n')
}

/** Screen-reader words for an item's +/− mark. */
export function signLabel(sign: AssistItem['sign']): string | null {
  if (sign === 'add') return 'Add this line'
  if (sign === 'remove') return 'Remove this line'
  return null
}

/** "4 suggestions" style count for the live region. */
export function resultAnnouncement(result: AssistResult): string {
  const count = result.items.length
  if (count === 0) return `${result.title}: done.`
  return `${result.title}: ${count} ${count === 1 ? 'suggestion' : 'suggestions'}.`
}

/** "2 facts to re-check before you rely on them": the suggestion card's warning row. */
export function recheckText(count: number): string {
  return `${count} ${count === 1 ? 'fact' : 'facts'} to re-check before you rely on ${count === 1 ? 'it' : 'them'}`
}
