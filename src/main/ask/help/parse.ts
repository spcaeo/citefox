/**
 * One help file (`Docs/help/<id>.md`) read into a topic and its sections. The
 * file starts with front matter (`id`, `title`, `screen`, `keywords`,
 * `summary`) and a body of short `##` / `###` sections. Each section is what
 * Ask CiteFox ranks and quotes, so a long topic only sends the part that
 * answers the question. Markdown is flattened to plain text: links keep their
 * words, emphasis and code marks go.
 */

export interface HelpSection {
  topicId: string
  topicTitle: string
  /** The topic's `screen` (a GuideScreen or section id), or null. */
  screen: string | null
  /** The section heading; the topic's lead text uses the topic title. */
  heading: string
  text: string
  /** The topic's keywords, ranked with every section of it. */
  keywords: readonly string[]
}

export interface HelpTopic {
  id: string
  title: string
  screen: string | null
  keywords: readonly string[]
  summary: string
  sections: readonly HelpSection[]
}

/** File names that are topic ids: lowercase words joined by dashes. */
export const HELP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Longest section text kept; the rest of a long section is cut at a sentence. */
const SECTION_MAX = 1200

/** Longest field read from front matter. */
const FIELD_MAX = 300

export function parseHelpFile(id: string, raw: string): HelpTopic | null {
  if (!HELP_ID.test(id) || id.length > 60) return null
  const { meta, body } = splitFrontMatter(raw.replace(/\r\n?/g, '\n'))
  const title = field(meta.title) || firstHeading(body) || id
  const screen = field(meta.screen) || null
  const keywords = keywordList(meta.keywords)
  const summary = field(meta.summary)
  const sections: HelpSection[] = []
  const add = (heading: string, lines: readonly string[]): void => {
    const text = clip(flatten(lines.join('\n')))
    if (text.length === 0) return
    sections.push({ topicId: id, topicTitle: title, screen, heading, text, keywords })
  }
  let heading = title
  let lines: string[] = summary ? [summary] : []
  for (const line of body.split('\n')) {
    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) {
      const level = match[1]?.length ?? 1
      // The H1 is the title; it opens the lead section, it is not one of its own.
      if (level === 1 && sections.length === 0 && heading === title) continue
      add(heading, lines)
      heading = flatten(match[2] ?? '') || title
      lines = []
      continue
    }
    lines.push(line)
  }
  add(heading, lines)
  return { id, title, screen, keywords, summary, sections }
}

interface FrontMatter {
  [key: string]: string | string[] | undefined
}

function splitFrontMatter(raw: string): { meta: FrontMatter; body: string } {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: raw }
  const meta: FrontMatter = {}
  let listKey: string | null = null
  for (const line of raw.slice(4, end).split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && listKey !== null) {
      const list = meta[listKey]
      const value = unquote(item[1] ?? '')
      meta[listKey] = Array.isArray(list) ? [...list, value] : [value]
      continue
    }
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!pair) continue
    const key = (pair[1] ?? '').toLowerCase()
    const value = (pair[2] ?? '').trim()
    listKey = value === '' ? key : null
    meta[key] = value === '' ? [] : unquote(value)
  }
  const rest = raw.slice(end + 4)
  return { meta, body: rest.startsWith('\n') ? rest.slice(1) : rest }
}

function field(value: string | string[] | undefined): string {
  if (value === undefined) return ''
  const text = Array.isArray(value) ? value.join(', ') : value
  return flatten(text).slice(0, FIELD_MAX)
}

function keywordList(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  const items = Array.isArray(value)
    ? value
    : value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(unquote)
  return items
    .map((item) => flatten(item).toLowerCase())
    .filter((item) => item.length > 0)
    .slice(0, 40)
}

function unquote(value: string): string {
  const text = value.trim()
  return /^(['"]).*\1$/.test(text) ? text.slice(1, -1) : text
}

function firstHeading(body: string): string {
  const match = /^#\s+(.+)$/m.exec(body)
  return match ? flatten(match[1] ?? '') : ''
}

/** Markdown to plain text: links keep their words; marks, images and HTML go. */
export function flatten(markdown: string): string {
  return (
    markdown
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/(\*\*|__|\*|_|`)/g, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/^\s*\d+\.\s+/gm, '• ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, ' ')
      .trim()
  )
}

function clip(text: string): string {
  if (text.length <= SECTION_MAX) return text
  const cut = text.slice(0, SECTION_MAX)
  const stop = cut.lastIndexOf('. ')
  return stop > SECTION_MAX / 2 ? cut.slice(0, stop + 1) : `${cut.slice(0, SECTION_MAX - 1)}…`
}
