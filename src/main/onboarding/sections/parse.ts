import {
  PROJECT_RULE_MAX,
  PROJECT_RULES_MAX,
  HELPFILL_PASTE_MAX,
  MAX_SHAPE_COUNT,
  PROMPT_SHAPES,
  type PromptMix,
  type PromptShape,
  type SetupContext,
  type SetupRow,
  type SetupSectionEstimateRequest,
  type SetupSectionId,
  type SetupSectionReadRequest,
  type SetupSectionRequest,
  type SetupSectionRunRequest
} from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { isSetupSectionId } from './registry'

/**
 * Checks the section requests from the renderer: exact keys, the section and mode
 * values, and caps on every length and count. A bad request is a plain
 * `IpcRequestError`; nothing is trimmed silently except surrounding spaces.
 */

export const MAX_SETUP_ROWS = 200
const MAX_NAMES = 100
const MAX_NAME = 500
const MAX_DETAIL = 2000
const MAX_URL = 2048
const MAX_TAG = 200
const MAX_SUMMARY = 4000
const MAX_INSTRUCTION = 1000
export const MAX_EDITED_PROMPT = 30_000

type Rec = Record<string, unknown>

export function record(
  value: unknown,
  channel: string,
  keys: readonly string[],
  optional: readonly string[] = []
): Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const rec = value as Rec
  for (const key of Object.keys(rec)) if (!keys.includes(key)) throw new IpcRequestError(channel)
  for (const key of keys) {
    if (optional.includes(key)) continue
    if (!Object.prototype.hasOwnProperty.call(rec, key)) throw new IpcRequestError(channel)
  }
  return rec
}

export function text(value: unknown, channel: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new IpcRequestError(channel)
  return value
}

function nullableText(value: unknown, channel: string, max: number): string | null {
  return value === null ? null : text(value, channel, max)
}

function names(value: unknown, channel: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_NAMES) throw new IpcRequestError(channel)
  return value.map((item) => text(item, channel, MAX_NAME))
}

function section(value: unknown, channel: string): SetupSectionId {
  if (!isSetupSectionId(value)) throw new IpcRequestError(channel, 'That section is not known.')
  return value
}

export function parseRow(value: unknown, channel: string): SetupRow {
  const r = record(value, channel, ['name', 'detail', 'url', 'tag', 'tier'], ['tier'])
  const row: SetupRow = {
    name: text(r.name, channel, MAX_NAME),
    detail: text(r.detail, channel, MAX_DETAIL),
    url: nullableText(r.url, channel, MAX_URL),
    tag: nullableText(r.tag, channel, MAX_TAG)
  }
  if (Object.prototype.hasOwnProperty.call(r, 'tier')) {
    if (r.tier !== null && r.tier !== 'direct' && r.tier !== 'partial') {
      throw new IpcRequestError(channel)
    }
    row.tier = r.tier
  }
  return row
}

export function parseRows(value: unknown, channel: string): SetupRow[] {
  if (!Array.isArray(value) || value.length > MAX_SETUP_ROWS) throw new IpcRequestError(channel)
  return value.map((item) => parseRow(item, channel))
}

export function parseContext(value: unknown, channel: string): SetupContext {
  const r = record(
    value,
    channel,
    [
      'domain',
      'country',
      'language',
      'summary',
      'brands',
      'products',
      'buyers',
      'triggers',
      'competitors',
      'switchingFrom',
      'integrations',
      'topic',
      'mix'
    ],
    ['mix']
  )
  const context: SetupContext = {
    domain: text(r.domain, channel, 253).trim(),
    country: text(r.country, channel, 12).trim(),
    language: text(r.language, channel, 35).trim(),
    summary: text(r.summary, channel, MAX_SUMMARY),
    brands: names(r.brands, channel),
    products: parseRows(r.products, channel),
    buyers: parseRows(r.buyers, channel),
    triggers: names(r.triggers, channel),
    competitors: parseRows(r.competitors, channel),
    switchingFrom: names(r.switchingFrom, channel),
    integrations: names(r.integrations, channel),
    topic: text(r.topic, channel, MAX_NAME)
  }
  if (r.mix !== undefined) context.mix = mixOf(r.mix, channel)
  return context
}

function mixOf(value: unknown, channel: string): PromptMix {
  const r = record(value, channel, [...PROMPT_SHAPES])
  const out = {} as Record<PromptShape, number>
  for (const shape of PROMPT_SHAPES) {
    const count = r[shape]
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_SHAPE_COUNT
    ) {
      throw new IpcRequestError(channel)
    }
    out[shape] = count
  }
  return out
}

export function parseSectionEstimate(value: unknown): SetupSectionEstimateRequest {
  const channel = 'onboarding:sectionEstimate'
  const r = record(value, channel, ['section'])
  return { section: section(r.section, channel) }
}

function sectionRequest(value: unknown, channel: string, extra: readonly string[]): Rec {
  return record(
    value,
    channel,
    ['section', 'context', 'mode', 'instruction', 'current', 'rules', ...extra],
    ['rules']
  )
}

/** Project rules sent with a request: at most 40 short lines. Absent: none. */
export function parseRules(value: unknown, channel: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > PROJECT_RULES_MAX) throw new IpcRequestError(channel)
  return value
    .map((item) => text(item, channel, PROJECT_RULE_MAX).replace(/\s+/gu, ' ').trim())
    .filter((item) => item.length > 0)
}

function base(r: Rec, channel: string): SetupSectionRequest {
  if (r.mode !== 'more' && r.mode !== 'redo') throw new IpcRequestError(channel)
  const instruction = nullableText(r.instruction, channel, MAX_INSTRUCTION)
  return {
    section: section(r.section, channel),
    context: parseContext(r.context, channel),
    mode: r.mode,
    instruction:
      instruction === null || instruction.trim().length === 0 ? null : instruction.trim(),
    current: parseRows(r.current, channel),
    rules: parseRules(r.rules, channel)
  }
}

export function parseSectionPrompt(value: unknown): SetupSectionRequest {
  const channel = 'onboarding:sectionPrompt'
  return base(sectionRequest(value, channel, []), channel)
}

export function parseSectionRun(value: unknown): SetupSectionRunRequest {
  const channel = 'onboarding:sectionRun'
  const r = sectionRequest(value, channel, ['prompt'])
  const prompt = nullableText(r.prompt, channel, MAX_EDITED_PROMPT)
  return {
    ...base(r, channel),
    prompt: prompt === null || prompt.trim().length === 0 ? null : prompt
  }
}

export function parseSectionRead(value: unknown): SetupSectionReadRequest {
  const channel = 'onboarding:sectionRead'
  const r = record(value, channel, ['section', 'context', 'current', 'text'])
  return {
    section: section(r.section, channel),
    context: parseContext(r.context, channel),
    current: parseRows(r.current, channel),
    text: text(r.text, channel, HELPFILL_PASTE_MAX)
  }
}
