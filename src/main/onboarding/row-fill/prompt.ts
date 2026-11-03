import { siteLines } from '../sections/prompt'
import { clip } from '../sections/rows'
import type { SiteOutline } from '../../engine/site-outline'
import { scrubPrivate } from '../../helpfill/prompt'
import type { SetupRow } from '@shared/ipc'
import type { RowFillDef } from './defs'

/**
 * The prompt that writes the missing second part of one row the person added by hand.
 * One job, one JSON answer. The AI answers from general knowledge plus the site context
 * given here, and leaves the line empty rather than guess about a name it does not know.
 */

/** Most example rows shown for style. */
export const FILL_EXAMPLES_MAX = 6
const SUMMARY_MAX = 600

export interface RowFillPromptInput {
  name: string
  domain: string
  summary: string
  brands: readonly string[]
  /** Other rows of the list that already have a detail, for style. */
  examples: readonly SetupRow[]
  /** The site's known pages and menu (what earlier steps already read). Null: none known. */
  site: SiteOutline | null
}

/** The JSON the reply must follow. `page` is '' when no known page matches. */
export const ROW_FILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['line', 'page'],
  properties: {
    line: { type: 'string', maxLength: 300 },
    page: { type: 'string', maxLength: 300 }
  }
} as const

export const ROW_FILL_REPLY_RULE =
  'Reply with JSON only, no other text: {"line":"…","page":"…"}. Use "" for anything you do not know.'

export function rowFillTask(
  def: RowFillDef,
  input: RowFillPromptInput,
  secrets: readonly string[] = []
): string {
  const domain = input.domain.trim() || 'the business'
  const lines: string[] = [
    `You help set up AI-search tracking for ${domain}. The person added a ${def.noun} by hand, with its name only. Write the missing second part of that row.`
  ]
  const brands = input.brands
    .map((brand) => brand.trim())
    .filter(Boolean)
    .join('; ')
  if (brands.length > 0) lines.push(`Brand names: ${clip(brands, 300)}`)
  const summary = input.summary.replace(/\s+/gu, ' ').trim()
  if (summary.length > 0)
    lines.push(`What it does (the person confirmed this): ${clip(summary, SUMMARY_MAX)}`)
  const examples = input.examples
    .filter((row) => row.name.trim().length > 0 && row.detail.trim().length > 0)
    .slice(0, FILL_EXAMPLES_MAX)
    .map((row) => `- ${clip(row.name, 80)}: ${clip(row.detail, 120)}`)
  if (examples.length > 0) {
    lines.push(
      '',
      `Other ${def.noun}s already listed, with their line (match this style):`,
      ...examples
    )
  }
  if (def.withPage && input.site !== null) {
    const pages = siteLines(input.site, ['paths'])
    if (pages.length > 0) lines.push(...pages)
  }
  lines.push(
    '',
    `${def.subject}: "${clip(input.name, 200)}"`,
    '',
    ...def.lineRules(domain),
    `A good line looks like: "${def.example}".`,
    'Answer from what you know for sure about this kind of thing, plus the facts above. If you do not recognise the name or cannot tell what it is, leave line empty. A blank is better than a guess. Never invent features, numbers, prices, customers or places.'
  )
  if (def.withPage) {
    lines.push(
      'page = the one path from the site paths above that is this product’s own page, copied exactly. Leave it empty unless one clearly matches. Never write a path that is not in that list.'
    )
  } else {
    lines.push('page = always "".')
  }
  return scrubPrivate(lines.join('\n'), secrets)
}

/** What a run sends: the routing line, the task, the reply rule. */
export function rowFillPrompt(
  def: RowFillDef,
  input: RowFillPromptInput,
  secrets: readonly string[] = []
): string {
  return `Assist: ${def.assistId}\n${rowFillTask(def, input, secrets)}\n\n${ROW_FILL_REPLY_RULE}`
}
