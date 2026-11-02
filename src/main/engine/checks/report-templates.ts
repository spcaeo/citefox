import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import { DEFAULT_TEMPLATE_SETTINGS, type TemplateSettings } from '@shared/domain'
import { parseTemplate } from '@shared/template-syntax'
import { claimsCause } from './cause-rule'
import aioGapTemplate from './templates/aio_gap.md?raw'
import runSummaryTemplate from './templates/run_summary.md?raw'

export { claimsCause }

const ajv = new Ajv({ allErrors: true, strict: false })

/** TPL-2. An unknown variable, a missing value, or unsupported syntax fails the render. */
export class CheckTemplateError extends Error {
  constructor() {
    super('The template has an unknown variable or a syntax error.')
    this.name = 'CheckTemplateError'
  }
}

export interface CheckTemplateContext {
  page: {
    url: string
    title: string
    meta_description: string
    h1: string
    body: string
  }
  market: {
    country: string
    language: string
    location: string
    device: string
  }
  icp: string
  /** `{{ product }}`: the page's product (name, job, buyer), or a note that none is set. */
  product: string
  brand_names: string
  competitors: string
  count: string
  prompts: string
  aio: {
    prompt: string
    text: string
    references: string
    status: string
  }
  run: {
    aios_shown: string
    page_cited: string
    other_own_page: string
    named_without_link: string
    invisible: string
    previous_page_cited: string
    baseline_page_cited: string
    content_changed: string
    content_change: string
  }
  notes: string
}

export interface ShippedCheckTemplate {
  name: 'aio_gap.md' | 'run_summary.md'
  body: string
  hash: string
}

/** Section 9.1. The hash is SHA-256 of the shipped template body (TPL-4). */
export const AIO_GAP_TEMPLATE: ShippedCheckTemplate = ship('aio_gap.md', aioGapTemplate)
export const RUN_SUMMARY_TEMPLATE: ShippedCheckTemplate = ship('run_summary.md', runSummaryTemplate)

/**
 * The template a check report renders: the project's own version, else the app
 * default (both editable since FR-26), else the shipped body. `id` is stored on
 * the generation row and `hash` on the analysis (TPL-4).
 */
export interface CheckTemplateChoice {
  id: string
  body: string
  hash: string
  settings: TemplateSettings
}

export interface CheckTemplates {
  aioGap: CheckTemplateChoice
  runSummary: CheckTemplateChoice
}

export const SHIPPED_CHECK_TEMPLATES: CheckTemplates = {
  aioGap: {
    id: 'tpl-aio-gap',
    body: AIO_GAP_TEMPLATE.body,
    hash: AIO_GAP_TEMPLATE.hash,
    settings: DEFAULT_TEMPLATE_SETTINGS
  },
  runSummary: {
    id: 'tpl-run-summary',
    body: RUN_SUMMARY_TEMPLATE.body,
    hash: RUN_SUMMARY_TEMPLATE.hash,
    settings: DEFAULT_TEMPLATE_SETTINGS
  }
}

/** FR-6.6. Facts the overview states that the page does not, each with a likely source. */
export const AIO_GAP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fact', 'likelySource'],
        properties: {
          fact: { type: 'string', minLength: 1 },
          likelySource: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] }
        }
      }
    }
  }
}

/** Section 9.1 `run_summary.md`. Headline and a short body. */
export const RUN_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'body'],
  properties: {
    headline: { type: 'string', minLength: 1 },
    body: { type: 'string', minLength: 1 }
  }
}

const gapValid = ajv.compile(AIO_GAP_SCHEMA)
const summaryValid = ajv.compile(RUN_SUMMARY_SCHEMA)

/**
 * The shared template syntax (`{{ name }}` and `{# #}`), plus dotted names such as
 * `{{ page.url }}` read from the context groups. Each segment is an own key, and the
 * last one must hold a string. Values are written as text and never parsed.
 */
export function renderCheckTemplate(body: string, context: CheckTemplateContext): string {
  let parts: ReturnType<typeof parseTemplate>
  try {
    parts = parseTemplate(body)
  } catch {
    throw new CheckTemplateError()
  }
  let text = ''
  for (const part of parts) {
    text += part.kind === 'text' ? part.text : contextValue(context, part.name)
  }
  return text
}

function contextValue(context: CheckTemplateContext, name: string): string {
  let value: unknown = context
  for (const key of name.split('.')) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) {
      throw new CheckTemplateError()
    }
    value = (value as Record<string, unknown>)[key]
  }
  if (typeof value !== 'string') throw new CheckTemplateError()
  return value
}

export function gapSchemaError(value: unknown): string | null {
  if (!gapValid(value)) return 'The reply did not match the schema.'
  const facts = (value as { facts: { fact: string; likelySource: string | null }[] }).facts
  for (const fact of facts) {
    if (claimsCause(fact.fact) || (fact.likelySource !== null && claimsCause(fact.likelySource))) {
      return 'The reply claims a cause.'
    }
  }
  return null
}

export function summarySchemaError(value: unknown): string | null {
  if (!summaryValid(value)) return 'The reply did not match the schema.'
  const summary = value as { headline: string; body: string }
  if (claimsCause(summary.headline) || claimsCause(summary.body)) return 'The reply claims a cause.'
  return null
}

function ship(name: ShippedCheckTemplate['name'], body: string): ShippedCheckTemplate {
  return {
    name,
    body,
    hash: createHash('sha256').update(body, 'utf8').digest('hex')
  }
}
