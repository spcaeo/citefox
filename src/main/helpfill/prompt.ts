import { REDACTED, redactString } from '../logging/redact'
import type { HelpFillContext, HelpFillKindDef, HelpFillSection } from './types'

/**
 * The prompt the user copies into their own chatbot (ChatGPT, Perplexity, Claude,
 * Gemini, Copilot): one role line, the project's context blocks, the page or topic,
 * the kind's task, the exact reply header, then the items already tracked so they
 * are not repeated. It leaves the app, so it never carries a key, an email
 * address or a file path (`scrubPrivate`).
 */

/** Tracked items listed in the prompt; the rest are counted, not listed. */
export const PROMPT_TRACKED_MAX = 150
/** Characters kept from one tracked item. */
const TRACKED_ITEM_CHARS = 220

export function buildHelpFillPrompt(
  definition: HelpFillKindDef,
  context: HelpFillContext,
  count: number,
  secrets: readonly string[] = []
): { prompt: string; columns: string[]; tracked: number } {
  const tracked = definition.tracked(context).listed
  const listed = tracked.slice(0, PROMPT_TRACKED_MAX)
  const lines: string[] = [
    definition.role(context),
    ...(definition.contextBlocks === false ? [] : withValues(context.blocks))
  ]
  if (context.target !== null) {
    const where = context.target.kind === 'topic' ? 'Topic' : 'Page'
    const url = context.target.url === null ? '' : ` (${context.target.url})`
    lines.push(`${where}: ${context.target.name}${url}.`)
  }
  const trackedLine = definition.trackedLine ?? true
  if (trackedLine) {
    lines.push(
      tracked.length === 0
        ? `Already tracked: no ${definition.noun[1]} yet.`
        : `Already tracked, don't repeat: ${tracked.length} ${definition.noun[tracked.length === 1 ? 0 : 1]}, listed below.`
    )
  }
  lines.push('', ...definition.task(context, count), '', ...replyFormat(definition.sections))
  if (trackedLine && listed.length > 0) {
    lines.push('', 'Already tracked:', ...listed.map((item) => `- ${clip(item)}`))
    if (tracked.length > listed.length) {
      lines.push(`- … and ${tracked.length - listed.length} more like these.`)
    }
  }
  return {
    prompt: scrubPrivate(lines.join('\n'), secrets),
    columns: [...(definition.sections[0]?.columns ?? [])],
    tracked: tracked.length
  }
}

/**
 * A context line whose value is missing ("What it does: not given.", "Product: not
 * set; treat the business as a whole.", "Triggers: not known.", "Partial overlap:
 * none saved.") tells an outside chatbot nothing.
 */
const NO_VALUE = /^[^:\n]+: (?:not (?:set|given|known)|none (?:given|saved|noted))(?:[.;].*)?$/u

/**
 * The context blocks, one line each, without the lines that have no value, so the
 * prompt stays short. The shared blocks keep those lines for the in-app prompts.
 */
export function withValues(blocks: readonly string[]): string[] {
  return blocks
    .flatMap((block) => block.split('\n'))
    .filter((line) => line.trim().length > 0 && !NO_VALUE.test(line.trim()))
}

/** "Reply with CSV only, this header:" or, for several sections, one CSV per `### TITLE`. */
function replyFormat(sections: readonly HelpFillSection[]): string[] {
  const single = sections.length === 1 && sections[0]?.title === null
  if (single) {
    return ['Reply with CSV only, this header:', sections[0]?.columns.join(',') ?? '']
  }
  return [
    'Reply with these sections, each one CSV with its header, and nothing else:',
    ...sections.map(
      (section) => `### ${section.title ?? section.id.toUpperCase()}\n${section.columns.join(',')}`
    )
  ]
}

/**
 * A text kind's prompt: the role line, the context blocks (unless the kind leaves them
 * out), the kind's evidence, then its task, which ends with how to reply ("Reply with
 * the section only."). No reply header and no tracked list. Scrubbed like the rows prompt.
 */
export function buildHelpFillTextPrompt(
  definition: HelpFillKindDef,
  context: HelpFillContext,
  evidence: readonly string[],
  secrets: readonly string[] = []
): { prompt: string; columns: string[]; tracked: number } {
  const lines = [
    definition.role(context),
    ...(definition.contextBlocks === false ? [] : context.blocks),
    ...evidence,
    '',
    ...definition.task(context, 1)
  ]
  return {
    prompt: scrubPrivate(tidyBlankLines(lines).join('\n'), secrets),
    columns: [],
    tracked: 0
  }
}

/** No blank line first or last, and never two in a row (an empty evidence group leaves none). */
function tidyBlankLines(lines: readonly string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    if (line.trim().length === 0 && (out.length === 0 || out.at(-1)?.trim().length === 0)) continue
    out.push(line)
  }
  while (out.length > 0 && out.at(-1)?.trim().length === 0) out.pop()
  return out
}

function clip(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length <= TRACKED_ITEM_CHARS ? flat : `${flat.slice(0, TRACKED_ITEM_CHARS - 1)}…`
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu
/** Local file paths: file URLs, home folders, macOS and Windows paths. Site paths stay. */
const FILE_PATH =
  /file:\/\/\S+|(?<![\p{L}\p{N}./])~\/\S*|(?<![\p{L}\p{N}.:/])\/(?:Users|Volumes|private\/(?:var|tmp)|var\/folders)\/\S*|(?<![\p{L}\p{N}.:/])\/home\/[^/\s]+\/\S*|\b[A-Za-z]:\\\S*/gu
/** Key-shaped tokens the redactor does not name: other `sk-` keys and long secrets. */
const KEYISH = /\bsk-[A-Za-z0-9_-]{16,}|\b(?:AKIA|ghp_|xox[abp]-)[A-Za-z0-9_-]{12,}/gu

/**
 * Takes out of text that leaves the app: API keys (the log redactor's patterns, the
 * app's known secrets, 64-hex keys), email addresses and local file paths.
 */
export function scrubPrivate(text: string, secrets: readonly string[] = []): string {
  const redacted = redactString(text, { secrets, hexKeys: true })
  return redacted
    .replace(/Bearer \[REDACTED\]/gu, '')
    .split(REDACTED)
    .join('')
    .replace(KEYISH, '')
    .replace(EMAIL, '')
    .replace(FILE_PATH, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/ +([.,;:])/gu, '$1')
    .replace(/[ \t]+$/gmu, '')
}
