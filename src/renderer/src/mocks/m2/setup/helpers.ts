import type {
  BuyerProfile,
  BuyerPrompt,
  CoverageMatrix,
  CoverageRecord,
  Market,
  PageReadMethod,
  PromptVariant
} from '@shared/domain'
import type { PageReadResult, StartPageReadRequest } from '@shared/ipc'
import {
  ALERTS_BRAND_MESSAGE,
  GAPS_TEMPLATE_HASH,
  GAPS_TEMPLATE_ID,
  GAPS_TEMPLATE_NAME,
  PROFILE_TEMPLATE_HASH,
  PROFILE_TEMPLATE_ID,
  PROFILE_TEMPLATE_NAME,
  PROMPT_SEEDS,
  PROMPTS_TEMPLATE_HASH,
  PROMPTS_TEMPLATE_ID,
  PROMPTS_TEMPLATE_NAME
} from '../textboltPage'
import type { PromptState } from './types'

export function clone<T>(value: T): T {
  return structuredClone(value)
}

export function channelError(channel: string, message: string): Error {
  return new Error(`${channel}: ${message}`)
}

export function emptyPrompts(): PromptState {
  return {
    promptSetId: null,
    version: null,
    savedAt: null,
    templateId: null,
    templateName: null,
    templateHash: null,
    templateUpdatedAt: null,
    dirty: false,
    saved: [],
    working: [],
    brandMessage: null
  }
}

export function seedPrompts(markets: readonly Market[]): PromptState {
  return {
    promptSetId: 'set-alerts',
    version: 2,
    savedAt: '2026-10-19T10:12:00.000Z',
    templateId: PROMPTS_TEMPLATE_ID,
    templateName: PROMPTS_TEMPLATE_NAME,
    templateHash: PROMPTS_TEMPLATE_HASH,
    templateUpdatedAt: null,
    dirty: false,
    saved: PROMPT_SEEDS.map((seed) => promptFromSeed(seed, markets)),
    working: PROMPT_SEEDS.map((seed) => promptFromSeed(seed, markets)),
    brandMessage: ALERTS_BRAND_MESSAGE
  }
}

function promptFromSeed(
  seed: (typeof PROMPT_SEEDS)[number],
  markets: readonly Market[]
): BuyerPrompt {
  const targets = markets.length > 0 ? markets : [{ id: 'us', language: 'en' }]
  const variants: PromptVariant[] = targets.map((market) => ({
    marketId: market.id,
    language: market.language.split('-')[0] ?? market.language,
    text: textForMarket(seed, market.id, market.language),
    originalText: null
  }))
  return {
    id: seed.id,
    position: seed.position,
    label: seed.label,
    source: seed.source,
    intentStage: seed.intentStage,
    mappedElement: seed.mappedElement,
    enabled: true,
    variants
  }
}

function textForMarket(
  seed: (typeof PROMPT_SEEDS)[number],
  marketId: string,
  language: string
): string {
  if (marketId === 'austin') return seed.austin
  if (language.split('-')[0] === 'es') return seed.es
  return seed.en
}

export function methodFor(reader: StartPageReadRequest['reader']): PageReadMethod {
  if (reader === 'jina') return 'jina'
  if (reader === 'file') return 'file'
  return 'direct'
}

export function hashText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  return hex.repeat(8).slice(0, 64)
}

export function variantsFor(markets: readonly Market[], text: string): PromptVariant[] {
  const targets = markets.length > 0 ? markets : [{ id: 'default', language: 'en' } as Market]
  return targets.map((market) => ({
    marketId: market.id,
    language: market.language.split('-')[0] ?? 'en',
    text,
    originalText: null
  }))
}

export function generatedPrompts(count: number, markets: readonly Market[]): BuyerPrompt[] {
  const prompts: BuyerPrompt[] = []
  for (let index = 0; index < count; index += 1) {
    const seed = PROMPT_SEEDS[index]
    if (seed) {
      prompts.push(promptFromSeed(seed, markets))
      continue
    }
    const position = index + 1
    prompts.push({
      id: `extra-${position}`,
      position,
      label: `Prompt ${position}`,
      source: 'written_by_user',
      intentStage: 'unset',
      mappedElement: '',
      enabled: true,
      variants: variantsFor(markets, '')
    })
  }
  return prompts
}

export function blankProfile(pageId: string): BuyerProfile {
  return {
    id: 'icp',
    pageId,
    snapshotId: '',
    templateId: PROFILE_TEMPLATE_ID,
    templateName: PROFILE_TEMPLATE_NAME,
    templateHash: PROFILE_TEMPLATE_HASH,
    templateUpdatedAt: null,
    createdAt: '2026-10-19T10:08:00.000Z',
    promptsStale: false,
    who: 'The buyer described by this page.',
    environment: 'The tools the page says they already use.',
    segments: [],
    triggers: [],
    values: [],
    poorFit: []
  }
}

export function blankGaps(
  pageId: string,
  read: PageReadResult,
  prompts: readonly BuyerPrompt[]
): CoverageMatrix {
  const contentHash = read.contentHash
  if (typeof contentHash !== 'string' || contentHash.length === 0) {
    throw channelError('gaps:generate', 'Read the page before the coverage matrix.')
  }
  const rows: CoverageRecord[] = prompts.map((prompt) => ({
    id: `gap-${prompt.id}`,
    runId: `run-${pageId}`,
    pageId,
    promptId: prompt.id,
    coverage: 'none',
    whereCovered: [],
    currentContent: 'Nothing on the page answers this prompt yet.',
    whatToUpdate: 'Add a section or an FAQ that answers it.',
    mainGap: 'Not covered.',
    priority: 'medium',
    actions: ['new_faq'] as const,
    suggestedFaq: null,
    done: false
  }))
  return {
    runId: `run-${pageId}`,
    pageId,
    recordedAt: '2026-10-19T10:20:00.000Z',
    templateId: GAPS_TEMPLATE_ID,
    templateName: GAPS_TEMPLATE_NAME,
    templateHash: GAPS_TEMPLATE_HASH,
    templateUpdatedAt: null,
    contentHash,
    reused: false,
    stale: false,
    rows,
    findings: []
  }
}

export function withStale(matrix: CoverageMatrix, read: PageReadResult | null): CoverageMatrix {
  const hash = read?.contentHash
  const stale = typeof hash === 'string' && hash.length > 0 && hash !== matrix.contentHash
  return clone({ ...matrix, stale })
}
