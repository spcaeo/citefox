import type { SetupSectionId } from '@shared/ipc'
import type { UsualRange } from '../ui'

/**
 * How long each setup wait usually takes, in seconds, in one place. The busy
 * lines show them ("usually 5–10 s") and say "Taking longer than usual…" at
 * twice the top end. Rough figures from real runs; adjust here only.
 */
export const USUAL_SECONDS = {
  /** Step 2: Claude Code's test reply. */
  claudeReply: [5, 10],
  /** Step 7: adding and testing a cloro or SerpApi key. */
  keyTest: [1, 3],
  /** A section card's ✦ Find more, Redo, Run again or ChatGPT read. */
  sectionRun: [10, 30],
  /** Competitors, which Claude looks up with web search. */
  competitorsSearch: [30, 90],
  /** Step 8: the first topic, written on arrival. */
  firstTopic: [5, 15],
  /** Step 8: the topic's buyer questions. */
  firstQuestions: [15, 40]
} as const satisfies Record<string, UsualRange>

/** A section's ✦ run: competitors search the web, so they take longer. */
export function usualForSection(section: SetupSectionId, reading = false): UsualRange {
  if (section === 'competitors' && !reading) return USUAL_SECONDS.competitorsSearch
  return USUAL_SECONDS.sectionRun
}
