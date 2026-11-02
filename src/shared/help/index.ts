/**
 * Help topics (Docs/help/*.md): one plain-English file per screen or idea, for a
 * marketer. Each file starts with front matter (`id`, `title`, `screen`,
 * `keywords`, `summary`), then short `##` sections. The renderer loads the files
 * (src/renderer/src/help/topics.ts); Ask CiteFox can parse the same text with
 * {@link parseHelpTopic}. Pure: no file system, no DOM. Front matter stays compatible
 * with main's parser (src/main/ask/help/parse.ts).
 */
import { HELP_TOPIC_TITLES, isHelpTopicId, type HelpTopicId } from '../help-topics'

/**
 * Every help topic id: the file names without `.md`. The one list is
 * `@shared/help-topics` (shared with Ask CiteFox in main); this is it as an array.
 */
export const HELP_TOPIC_IDS = Object.keys(HELP_TOPIC_TITLES) as readonly HelpTopicId[]

export { HELP_TOPIC_TITLES, isHelpTopicId, type HelpTopicId }

/**
 * The screen a topic belongs to: a Guide screen id (src/renderer/src/guide/types.ts
 * `GuideScreen`), or `all` for topics that fit everywhere (getting started, glossary).
 */
export const HELP_SCREENS = [
  'summary',
  'topic',
  'prompt',
  'topics',
  'questions',
  'competitors',
  'citations',
  'fixes',
  'history',
  'reports',
  'alerts',
  'settings',
  'pages',
  'all'
] as const

export type HelpScreen = (typeof HELP_SCREENS)[number]

/** One `##` section of a topic. */
export interface HelpSection {
  /** The heading text, without `##`. */
  heading: string
  /** A stable anchor: the heading in lower case with dashes ("common-questions"). */
  slug: string
  /** The section's markdown, without its heading. */
  body: string
}

export interface HelpTopic {
  id: string
  title: string
  screen: HelpScreen
  keywords: readonly string[]
  /** One line: what the topic is about. */
  summary: string
  /** The markdown after the front matter. */
  body: string
  sections: readonly HelpSection[]
  /** The `###` questions under "Common questions", as people ask them. */
  questions: readonly string[]
}

function isHelpScreen(value: string): value is HelpScreen {
  return (HELP_SCREENS as readonly string[]).includes(value)
}

/** "Common questions" is "common-questions". */
export function slugOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/** Front matter values: `key: value` lines; `keywords` is a comma list, brackets optional. */
function frontMatter(raw: string): { fields: Record<string, string>; body: string } | null {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---', 4)
  if (end < 0) return null
  const fields: Record<string, string> = {}
  for (const line of text.slice(4, end).split('\n')) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    const value = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (key) fields[key] = value
  }
  const after = text.slice(end + 4)
  return { fields, body: after.replace(/^[^\n]*\n/, '').trim() }
}

/** The `##` sections of a topic's markdown, in order. Text before the first `##` is left out. */
export function splitSections(body: string): HelpSection[] {
  const out: HelpSection[] = []
  let current: { heading: string; lines: string[] } | null = null
  const flush = (): void => {
    if (current === null) return
    out.push({
      heading: current.heading,
      slug: slugOf(current.heading),
      body: current.lines.join('\n').trim()
    })
  }
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^##\s+(.+?)\s*#*\s*$/.exec(line)
    if (match && !line.startsWith('###')) {
      flush()
      current = { heading: match[1] ?? '', lines: [] }
    } else if (current !== null) {
      current.lines.push(line)
    }
  }
  flush()
  return out
}

/** The `###` headings inside the "Common questions" section. */
function questionsOf(sections: readonly HelpSection[]): string[] {
  const common = sections.find((section) => section.slug === 'common-questions')
  if (!common) return []
  return common.body
    .split('\n')
    .map((line) => /^###\s+(.+?)\s*$/.exec(line)?.[1] ?? null)
    .filter((line): line is string => line !== null)
}

/**
 * One help topic from its file text. Null when the front matter is missing or
 * incomplete (`id`, `title`, `screen` and `summary` are required), or when `id`
 * differs from `expectedId` (the file name) when one is given.
 */
export function parseHelpTopic(raw: string, expectedId?: string): HelpTopic | null {
  const parsed = frontMatter(raw)
  if (parsed === null) return null
  const { fields, body } = parsed
  const id = fields['id'] ?? ''
  const title = fields['title'] ?? ''
  const screen = fields['screen'] ?? ''
  const summary = fields['summary'] ?? ''
  if (!id || !title || !summary || !isHelpScreen(screen)) return null
  if (expectedId !== undefined && id !== expectedId) return null
  const keywords = (fields['keywords'] ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
  const sections = splitSections(body)
  return { id, title, screen, keywords, summary, body, sections, questions: questionsOf(sections) }
}

/** The file name a help path ends in, without `.md` ("/x/Docs/help/glossary.md" is "glossary"). */
export function helpIdFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  return name.replace(/\.md$/i, '')
}

/** Topics parsed from `{ path: text }`, in {@link HELP_TOPIC_IDS} order, then any others by id. */
export function parseHelpFiles(files: Readonly<Record<string, string>>): HelpTopic[] {
  const topics: HelpTopic[] = []
  for (const [path, raw] of Object.entries(files)) {
    const topic = parseHelpTopic(raw, helpIdFromPath(path))
    if (topic) topics.push(topic)
  }
  const order = (id: string): number => {
    const at = (HELP_TOPIC_IDS as readonly string[]).indexOf(id)
    return at < 0 ? HELP_TOPIC_IDS.length : at
  }
  return topics.sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id))
}
