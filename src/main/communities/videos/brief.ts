import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import type { VideoBrief, VideoScene } from '@shared/domain'
import { parseTemplate, renderTemplateParts } from '@shared/template-syntax'
import { claimsCause } from '../../engine/checks/report-templates'
import { competitorContext } from '../../engine/competitor-context'
import type { ValidationProblem } from '../../pipeline/errors'
import { buyerBlock, buyerFromPageProfile, productBlock } from '../../prompts/blocks'
import type { SqliteDatabase } from '../../storage/database'
import { getLatestBuyerProfile } from '../../storage/snapshot-records'
import videoBriefTemplate from '../templates/video_brief.md?raw'

/** The template kind the template editor lists for this shipped default (FR-18.4, TPL-4). */
export const VIDEO_BRIEF_KIND = 'video_brief'

/** Shipped default. The hash is SHA-256 of the body. */
export const VIDEO_BRIEF_TEMPLATE = {
  id: 'tpl-video-brief',
  kind: VIDEO_BRIEF_KIND,
  name: 'video_brief.md',
  body: videoBriefTemplate,
  hash: createHash('sha256').update(videoBriefTemplate, 'utf8').digest('hex')
} as const

/** Variables the shipped body uses. Every one must be filled; an unknown one renders blank. */
export interface VideoBriefContext {
  question: string
  related_prompts: string
  markets: string
  brand_names: string
  videos_cited: string
  page_url: string
  page_title: string
  page_h1: string
  page_sections: string
  page_text: string
  /** The page's product: name, job and buyer (Docs/PROMPT-AUDIT.md, P6). */
  product_block: string
  /** The page's buyer: who, environment and triggers. */
  buyer_block: string
}

/** `{{ product_block }}` and `{{ buyer_block }}` for the page the video links to. */
export function videoBriefBlocks(
  db: SqliteDatabase,
  pageId: string
): Pick<VideoBriefContext, 'product_block' | 'buyer_block'> {
  const buyer = getLatestBuyerProfile(db, pageId)
  return {
    product_block: productBlock(competitorContext(db, { pageId }).product),
    buyer_block:
      buyer === null ? 'Buyer: no buyer profile yet.' : buyerBlock(buyerFromPageProfile(buyer))
  }
}

/**
 * A script line with a figure, price, percentage or limit makes a claim, and so
 * does a long line. Framing lines (a greeting, a transition, the call to action)
 * are short and carry no figures.
 */
const CLAIM_FIGURE =
  /[$€£₹]\s?\d|\d\s?%|\b\d[\d,.]*\s?(?:per|a|an|\/|each)\s?(?:month|year|week|day|message|text|sms|user|seat|contact|credit|number)s?\b|\b\d[\d,.]*\s?(?:characters?|messages?|texts?|contacts?|users?|seats?|credits?)\b/iu
const FRAMING_MAX_WORDS = 30

const TIME = '^\\d{1,2}:\\d{2}$'

/** FR-18.4 brief schema, the reply Claude must match. */
export const VIDEO_BRIEF_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'hook',
    'chapters',
    'script',
    'sources',
    'description',
    'thumbnailText',
    'tags',
    'scenes'
  ],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 100 },
    hook: { type: 'string', minLength: 1, maxLength: 400 },
    chapters: {
      type: 'array',
      minItems: 2,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['at', 'name'],
        properties: {
          at: { type: 'string', pattern: TIME },
          name: { type: 'string', minLength: 1, maxLength: 80 }
        }
      }
    },
    script: {
      type: 'array',
      minItems: 1,
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['at', 'text', 'source'],
        properties: {
          at: { type: 'string', pattern: TIME },
          text: { type: 'string', minLength: 1, maxLength: 600 },
          source: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] }
        }
      }
    },
    sources: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'section', 'onPage'],
        properties: {
          n: { type: 'integer', minimum: 1 },
          section: { type: 'string', minLength: 1, maxLength: 300 },
          onPage: { type: 'boolean' }
        }
      }
    },
    description: { type: 'string', minLength: 1, maxLength: 5000 },
    thumbnailText: { type: 'string', minLength: 1, maxLength: 60 },
    tags: {
      type: 'array',
      minItems: 1,
      maxItems: 15,
      items: { type: 'string', minLength: 1, maxLength: 60 }
    },
    scenes: {
      type: 'array',
      minItems: 2,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'at', 'kind', 'note'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          at: { type: 'string', pattern: TIME },
          kind: { enum: ['card', 'screenshot', 'demo', 'slide'] },
          note: { type: 'string', minLength: 1, maxLength: 200 }
        }
      }
    }
  }
}

const ajv = new Ajv({ allErrors: true, strict: false })
const valid = ajv.compile(VIDEO_BRIEF_SCHEMA)

interface RawBrief {
  title: string
  hook: string
  chapters: { at: string; name: string }[]
  script: { at: string; text: string; source: number | null }[]
  sources: { n: number; section: string; onPage: boolean }[]
  description: string
  thumbnailText: string
  tags: string[]
  scenes: { name: string; at: string; kind: VideoScene['kind']; note: string }[]
}

/** Renders the shipped body (or a user's edited body) with the brief context. */
export function renderVideoBriefPrompt(body: string, context: VideoBriefContext): string {
  return renderTemplateParts(parseTemplate(body), { ...context })
}

/**
 * Domain check after the schema. Every script line points at a listed source, a
 * line that makes a claim has one, source numbers are unique, a source marked on
 * the page names one of the page's sections (when they are given), the description
 * links the page, and nothing claims the video will cause a citation (section 7.3).
 */
export function videoBriefProblem(
  value: unknown,
  pageUrl: string,
  sections?: readonly string[]
): ValidationProblem | null {
  if (!valid(value))
    return { code: 'schema_validation', message: 'The reply did not match the schema.' }
  const brief = value as RawBrief
  const numbers = new Set<number>()
  for (const source of brief.sources) {
    if (numbers.has(source.n)) return problem('Two sources share a number.')
    numbers.add(source.n)
  }
  for (const line of brief.script) {
    if (line.source !== null && !numbers.has(line.source)) {
      return problem(
        `Script line at ${line.at} points to source ${line.source}, which is not listed.`
      )
    }
    if (line.source === null && makesClaim(line.text)) {
      return problem(
        `Script line at ${line.at} makes a claim with no source. Give it the page section it comes from.`
      )
    }
  }
  if (sections !== undefined) {
    const listed = new Set(sections.map((section) => fold(section)))
    const missing = brief.sources.find(
      (source) =>
        source.onPage &&
        !listed.has(fold(source.section)) &&
        !listed.has(fold(sectionName(source.section)))
    )
    if (missing !== undefined) {
      return problem(
        `Source ${missing.n} is marked on the page, but "${missing.section}" is not one of the page's sections. Copy a section exactly, or set onPage to false.`
      )
    }
  }
  if (!brief.description.includes(stripScheme(pageUrl))) {
    return problem('The description must link the page.')
  }
  if ([brief.title, brief.hook, brief.description].some((text) => claimsCause(text))) {
    return problem('The brief claims the video causes a change.')
  }
  return null
}

/**
 * The stored brief. A source marked on the page whose section is not a heading,
 * FAQ question, or sentence on the page is flagged `onPage: false`, so a claim
 * that is not on the page never passes as sourced (FR-18.4).
 */
export function finalizeVideoBrief(
  value: unknown,
  page: { sections: readonly string[]; text: string },
  writtenAt: string,
  templateHash: string
): VideoBrief {
  const brief = value as RawBrief
  const haystack = fold([...page.sections, page.text].join('\n'))
  return {
    title: brief.title.trim(),
    hook: brief.hook.trim(),
    chapters: brief.chapters.map((chapter) => ({ at: chapter.at, name: chapter.name.trim() })),
    script: brief.script.map((line) => ({
      at: line.at,
      text: line.text.trim(),
      source: line.source
    })),
    sources: brief.sources
      .map((source) => ({
        n: source.n,
        section: source.section.trim(),
        onPage: source.onPage && haystack.includes(fold(sectionName(source.section)))
      }))
      .sort((a, b) => a.n - b.n),
    description: brief.description.trim(),
    thumbnailText: brief.thumbnailText.trim(),
    tags: [...new Set(brief.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
    scenes: brief.scenes.map((scene, index) => ({
      n: index + 1,
      name: scene.name.trim(),
      at: scene.at,
      kind: scene.kind,
      note: scene.note.trim()
    })),
    writtenAt,
    templateHash
  }
}

function makesClaim(text: string): boolean {
  return CLAIM_FIGURE.test(text) || text.trim().split(/\s+/u).length > FRAMING_MAX_WORDS
}

/** "Step 3 · Connect your tools" names "Connect your tools"; the part after the last dot is checked. */
function sectionName(section: string): string {
  const parts = section.split(/\s+·\s+/)
  return (parts.at(-1) ?? section).trim()
}

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[“”"'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '')
}

function problem(message: string): ValidationProblem {
  return { code: 'schema_validation', message }
}
