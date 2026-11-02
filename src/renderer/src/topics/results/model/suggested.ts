import { ENGINE_SHORT_LABEL } from '@shared/domain'
import type {
  SuggestTopicTargetResult,
  TopicTargetSuggestion,
  TopicTargetSuggestions
} from '@shared/ipc'
import { sameTargetPage } from '@shared/target-page'

/** One row of the Suggested list: a cited page, a CiteFox AI pick, or both. */
export interface SuggestedRow {
  url: string
  title: string | null
  source: TopicTargetSuggestion['source'] | null
  cited: TopicTargetSuggestion | null
  /** 1 for CiteFox AI's best pick; null when it did not pick this page. */
  aiRank: number | null
  reason: string | null
}

/** CiteFox AI's picks first, in its order, then the other cited pages, most cited first. */
export function suggestedRows(
  cited: TopicTargetSuggestions | null,
  ai: SuggestTopicTargetResult | null
): SuggestedRow[] {
  const ranked = cited?.suggestions ?? []
  const rows: SuggestedRow[] = (ai?.picks ?? []).map((pick, index) => {
    const match = ranked.find((item) => sameTargetPage(item.url, pick.url)) ?? null
    return {
      url: pick.url,
      title: match?.title ?? pick.title,
      source: match?.source ?? null,
      cited: match,
      aiRank: index + 1,
      reason: pick.reason
    }
  })
  for (const item of ranked) {
    if (rows.some((row) => sameTargetPage(row.url, item.url))) continue
    rows.push({
      url: item.url,
      title: item.title,
      source: item.source,
      cited: item,
      aiRank: null,
      reason: null
    })
  }
  return rows
}

/** "Cited for 5 of 12 questions", then "Google 4", "ChatGPT 3", "best #1". */
export function citedChips(item: TopicTargetSuggestion, of: TopicTargetSuggestions): string[] {
  return [
    `Cited for ${item.citedPrompts} of ${of.checkedPrompts} ${of.noun}`,
    ...item.engines.map((engine) => `${ENGINE_SHORT_LABEL[engine.engine]} ${engine.prompts}`),
    ...(item.bestPosition === null ? [] : [`best #${item.bestPosition}`])
  ]
}
