import type { AssistantHelpLink, AssistantNextStep } from '@shared/ipc'
import { helpTopicForScreen, sectionForHelpScreen } from '@shared/help-topics'
import { loadHelpTopics } from './library'
import type { HelpSection, HelpTopic } from './parse'
import { rankSections } from './rank'

/**
 * Help sections for one Ask CiteFox question: ranked locally, numbered H1…
 * for the prompt, and turned back into "Read more" links and one next step
 * from the refs the answer cites.
 */

/** Sections sent with a question. */
export const HELP_SECTION_LIMIT = 3

/** A section below this share of the best score is noise, not a second answer. */
const KEEP_RATIO = 0.35

/** The best section must score this to turn a plain "explain" into a help answer. */
export const STRONG_HELP_SCORE = 2

export interface HelpHit {
  ref: string
  section: HelpSection
  score: number
}

/** "How do I…", "Why is…", "What should I…", "Where is…", "What does X mean"… */
export function isHowQuestion(question: string): boolean {
  const text = question.trim().toLowerCase().replace(/[’]/g, "'")
  return /^(how|why|where|when|what should|what can|what does|what do|what is|what's|what are|what happens|is there|can i|can citefox|do i|does citefox|should i|help)\b/.test(
    text
  )
}

export function findHelp(
  question: string,
  options: { screen: string; limit?: number; topics?: readonly HelpTopic[] }
): HelpHit[] {
  const topics = options.topics ?? loadHelpTopics()
  const sections = topics.flatMap((topic) => topic.sections)
  const ranked = rankSections(question, sections, {
    preferTopic: helpTopicForScreen(options.screen),
    limit: (options.limit ?? HELP_SECTION_LIMIT) * 2
  })
  const best = ranked[0]?.score ?? 0
  return ranked
    .filter((item) => item.score >= best * KEEP_RATIO)
    .slice(0, options.limit ?? HELP_SECTION_LIMIT)
    .map((item, index) => ({ ref: `H${index + 1}`, section: item.section, score: item.score }))
}

/** The sections as prompt lines: "H1 · Glossary › Right page", then the text. */
export function helpPromptText(hits: readonly HelpHit[]): string {
  if (hits.length === 0) return 'none'
  return hits
    .map((hit) => {
      const where =
        hit.section.heading === hit.section.topicTitle
          ? hit.section.topicTitle
          : `${hit.section.topicTitle} › ${hit.section.heading}`
      return `${hit.ref} · ${where} (topic id ${hit.section.topicId})\n${hit.section.text}`
    })
    .join('\n\n')
}

/**
 * The topics behind the H refs an answer cites, once each, in the order cited.
 * A help answer that cites none still links its best section's topic.
 */
export function helpLinksFor(
  hits: readonly HelpHit[],
  refs: readonly string[],
  fallbackToBest: boolean
): AssistantHelpLink[] {
  const cited = refs
    .map((ref) => hits.find((hit) => hit.ref === ref))
    .filter((hit): hit is HelpHit => hit !== undefined)
  const used = cited.length > 0 ? cited : fallbackToBest && hits[0] ? [hits[0]] : []
  const out: AssistantHelpLink[] = []
  for (const hit of used) {
    if (out.some((link) => link.id === hit.section.topicId)) continue
    out.push({ id: hit.section.topicId, title: hit.section.topicTitle })
  }
  return out.slice(0, 3)
}

/**
 * One next step: the screen the first linked topic is about, when that is not
 * where the question was asked. "Open Questions".
 */
export function nextStepFor(
  links: readonly AssistantHelpLink[],
  hits: readonly HelpHit[],
  currentScreen: string
): AssistantNextStep | null {
  const here = sectionForHelpScreen(currentScreen.split('.')[0] ?? currentScreen)?.section ?? null
  for (const link of links) {
    const screen = hits.find((hit) => hit.section.topicId === link.id)?.section.screen ?? null
    const target = sectionForHelpScreen(screen)
    if (target === null || target.section === here) continue
    return { section: target.section, label: `Open ${target.heading}` }
  }
  return null
}
