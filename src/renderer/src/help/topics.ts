import {
  parseHelpFiles,
  type HelpScreen,
  type HelpSection,
  type HelpTopic,
  type HelpTopicId
} from '@shared/help'

/**
 * The help topics (Docs/help/*.md), bundled into the renderer as text by Vite and
 * parsed once. `helpTopics()` lists them, `helpTopic(id)` finds one, and
 * `helpSections(id)` gives its `##` sections. Pure reads, no call to main.
 */
const FILES = import.meta.glob<string>('../../../../Docs/help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
})

let cache: readonly HelpTopic[] | null = null

/** Every help topic, in the shared id order. */
export function helpTopics(): readonly HelpTopic[] {
  cache ??= parseHelpFiles(FILES)
  return cache
}

/** One topic by id, or null when there is no such file. */
export function helpTopic(id: HelpTopicId | string | null | undefined): HelpTopic | null {
  if (!id) return null
  return helpTopics().find((topic) => topic.id === id) ?? null
}

/** A topic's `##` sections; empty for an unknown id. */
export function helpSections(id: HelpTopicId | string): readonly HelpSection[] {
  return helpTopic(id)?.sections ?? []
}

/** The topics for one screen, then the ones for every screen (getting started, glossary). */
export function helpTopicsFor(screen: HelpScreen): readonly HelpTopic[] {
  const all = helpTopics()
  return [
    ...all.filter((topic) => topic.screen === screen),
    ...(screen === 'all' ? [] : all.filter((topic) => topic.screen === 'all'))
  ]
}

export type { HelpScreen, HelpSection, HelpTopic, HelpTopicId }
