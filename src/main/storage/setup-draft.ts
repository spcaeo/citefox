import { isEngineId, type EngineId } from '@shared/domain'
import {
  DEFAULT_PROMPT_MIX,
  isSetupStep,
  MAX_SHAPE_COUNT,
  PROJECT_RULE_MAX,
  PROJECT_RULES_MAX,
  PROMPT_SHAPES,
  SETUP_LISTS,
  type PromptMix,
  type SetupDraft,
  type SetupItem,
  type SetupListId,
  type SetupSectionId,
  type SetupSiteDraft,
  type SetupStep
} from '@shared/ipc'

/**
 * Onboarding v2's part of the draft (`setupView`, `setup`): checked for shape, enum
 * values, and caps on lengths and counts, the same way as the v1 fields. Throws
 * {@link SetupDraftError}; `onboarding-draft.ts` turns it into its own error.
 */

export class SetupDraftError extends Error {
  constructor() {
    super('Invalid setup draft')
    this.name = 'SetupDraftError'
  }
}

const MAX_SITE_TEXT = 500
const MAX_ITEMS = 100
const MAX_ID = 80
const MAX_NAME = 500
const MAX_DETAIL = 2000
const MAX_URL = 2048
const MAX_TAG = 200
const MAX_SUMMARY = 4000
const MAX_TOPIC = 500
const MAX_PROMPT = 30_000
const MAX_ENGINES = 20

const SITE_FIELDS = [
  'domain',
  'projectName',
  'userName',
  'country',
  'countryCode',
  'language',
  'languageCode',
  'location'
] as const

const ITEM_FIELDS = [
  'id',
  'name',
  'detail',
  'url',
  'tag',
  'tier',
  'origin',
  'kept',
  'edited',
  'fresh'
]

const SECTION_IDS: readonly SetupSectionId[] = [...SETUP_LISTS, 'summary', 'topic']

export function parseSetupView(value: unknown): 'welcome' | SetupStep {
  if (value === 'welcome') return value
  if (typeof value === 'string' && isSetupStep(value)) return value
  throw new SetupDraftError()
}

export function parseSetupDraft(value: unknown): SetupDraft {
  const r = plain(value)
  onlyKeys(
    r,
    [
      'site',
      'readWay',
      'readDone',
      'summary',
      'summaryOrigin',
      'lists',
      'topic',
      'topicOrigin',
      'prompts',
      'search',
      'mix',
      'questionsMix',
      'rules'
    ],
    // Drafts saved before step 8 (the prompt mix) or project rules existed.
    ['mix', 'questionsMix', 'rules']
  )
  if (
    r.readWay !== null &&
    r.readWay !== 'claude' &&
    r.readWay !== 'chatgpt' &&
    r.readWay !== 'manual'
  ) {
    throw new SetupDraftError()
  }
  return {
    site: readSite(r.site),
    readWay: r.readWay,
    readDone: bool(r.readDone),
    summary: textOf(r.summary, MAX_SUMMARY),
    summaryOrigin: origin(r.summaryOrigin),
    lists: readLists(r.lists),
    topic: textOf(r.topic, MAX_TOPIC),
    topicOrigin: origin(r.topicOrigin),
    prompts: readPrompts(r.prompts),
    search: readSearch(r.search),
    mix: r.mix === undefined ? DEFAULT_PROMPT_MIX : readMix(r.mix),
    questionsMix:
      r.questionsMix === undefined || r.questionsMix === null ? null : readMix(r.questionsMix),
    ...(r.rules === undefined ? {} : { rules: readRules(r.rules) })
  }
}

/** Redo words kept as project rules: at most 40 short lines. */
function readRules(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > PROJECT_RULES_MAX) throw new SetupDraftError()
  return value.map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > PROJECT_RULE_MAX) {
      throw new SetupDraftError()
    }
    return item
  })
}

function readMix(value: unknown): PromptMix {
  const r = plain(value)
  onlyKeys(r, PROMPT_SHAPES)
  const out = {} as Record<(typeof PROMPT_SHAPES)[number], number>
  for (const shape of PROMPT_SHAPES) {
    const count = r[shape]
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_SHAPE_COUNT
    ) {
      throw new SetupDraftError()
    }
    out[shape] = count
  }
  return out
}

function readSite(value: unknown): SetupSiteDraft {
  const r = plain(value)
  onlyKeys(r, SITE_FIELDS)
  const out = {} as Record<(typeof SITE_FIELDS)[number], string>
  for (const key of SITE_FIELDS) out[key] = textOf(r[key], MAX_SITE_TEXT)
  return out
}

function readLists(value: unknown): Record<SetupListId, readonly SetupItem[]> {
  const r = plain(value)
  // Drafts saved before step 8 have no examples.
  onlyKeys(r, SETUP_LISTS, ['examples'])
  const out = {} as Record<SetupListId, readonly SetupItem[]>
  for (const list of SETUP_LISTS) {
    const items = r[list] ?? (list === 'examples' ? [] : undefined)
    if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new SetupDraftError()
    const ids = new Set<string>()
    out[list] = items.map((item) => {
      const parsed = readItem(item)
      if (ids.has(parsed.id)) throw new SetupDraftError()
      ids.add(parsed.id)
      return parsed
    })
  }
  return out
}

function readItem(value: unknown): SetupItem {
  const r = plain(value)
  for (const key of Object.keys(r)) if (!ITEM_FIELDS.includes(key)) throw new SetupDraftError()
  for (const key of ITEM_FIELDS) {
    if (key !== 'tier' && !Object.prototype.hasOwnProperty.call(r, key)) throw new SetupDraftError()
  }
  const id = textOf(r.id, MAX_ID)
  if (id.length === 0) throw new SetupDraftError()
  const item: SetupItem = {
    id,
    name: textOf(r.name, MAX_NAME),
    detail: textOf(r.detail, MAX_DETAIL),
    url: r.url === null ? null : textOf(r.url, MAX_URL),
    tag: r.tag === null ? null : textOf(r.tag, MAX_TAG),
    origin: origin(r.origin),
    kept: bool(r.kept),
    edited: bool(r.edited),
    fresh: bool(r.fresh)
  }
  if (Object.prototype.hasOwnProperty.call(r, 'tier')) {
    if (r.tier !== null && r.tier !== 'direct' && r.tier !== 'partial') throw new SetupDraftError()
    item.tier = r.tier
  }
  return item
}

function readPrompts(value: unknown): Partial<Record<SetupSectionId, string>> {
  const r = plain(value)
  const out: Partial<Record<SetupSectionId, string>> = {}
  for (const [key, prompt] of Object.entries(r)) {
    if (!SECTION_IDS.includes(key as SetupSectionId)) throw new SetupDraftError()
    out[key as SetupSectionId] = textOf(prompt, MAX_PROMPT)
  }
  return out
}

function readSearch(value: unknown): SetupDraft['search'] {
  const r = plain(value)
  onlyKeys(r, ['provider', 'engines', 'everyDays'])
  if (r.provider !== 'cloro' && r.provider !== 'serpapi') throw new SetupDraftError()
  if (!Array.isArray(r.engines) || r.engines.length > MAX_ENGINES) throw new SetupDraftError()
  const engines: EngineId[] = []
  for (const engine of r.engines) {
    if (typeof engine !== 'string' || !isEngineId(engine)) throw new SetupDraftError()
    if (!engines.includes(engine)) engines.push(engine)
  }
  // 0 is "on demand only" (no scheduled checks).
  const everyDays = r.everyDays
  if (
    typeof everyDays !== 'number' ||
    !Number.isInteger(everyDays) ||
    everyDays < 0 ||
    everyDays > 365
  ) {
    throw new SetupDraftError()
  }
  return { provider: r.provider, engines, everyDays }
}

function origin(value: unknown): 'ai' | 'user' {
  if (value === 'ai' || value === 'user') return value
  throw new SetupDraftError()
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new SetupDraftError()
  return value
}

function textOf(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new SetupDraftError()
  return value
}

function plain(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SetupDraftError()
  }
  return value as Record<string, unknown>
}

/** Every key in `allowed`, none other; the `optional` ones may be missing. */
function onlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[] = []
): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new SetupDraftError()
  for (const key of allowed) {
    if (optional.includes(key)) continue
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new SetupDraftError()
  }
}
