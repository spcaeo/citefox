import { formatMoment } from '../utils/dates'
import {
  GENERATION_TEMPLATE_KINDS,
  PLAYGROUND_COMPARE_LIMIT,
  templateKindInfo,
  TEMPLATE_NAME_MAX_LENGTH,
  type GenerationTemplate,
  type GenerationTemplateKind
} from '@shared/domain'
import {
  TEMPLATE_ERROR_MESSAGES,
  type PlaygroundOverrides,
  type PlaygroundRunRequest,
  type TemplateUsage
} from '@shared/ipc'

export const TEMPLATE_KIND_ORDER = [
  'buyer_profile',
  'buyer_prompts',
  'coverage',
  'answer_shape'
] as const

/**
 * Kinds the playground can run. Answer shape reads stored overviews, not a live page;
 * the content gaps need the page's prompts and a stored matrix (Docs/PROMPT-AUDIT.md, P1).
 */
export const PLAYGROUND_KIND_ORDER = ['buyer_profile', 'buyer_prompts'] as const

export function isPlaygroundKind(
  kind: GenerationTemplateKind
): kind is (typeof PLAYGROUND_KIND_ORDER)[number] {
  return (PLAYGROUND_KIND_ORDER as readonly string[]).includes(kind)
}

export const KIND_LABEL: Readonly<Record<GenerationTemplateKind, string>> = byKind(
  (kind) => templateKindInfo(kind).label
)

export function templatesOfKind(
  templates: readonly GenerationTemplate[],
  kind: GenerationTemplateKind,
  deleted: boolean
): GenerationTemplate[] {
  return templates.filter(
    (template) => template.kind === kind && (template.deletedAt !== null) === deleted
  )
}

export function templateCountLabel(count: number): string {
  return count === 1 ? '1 template' : `${count} templates`
}

export function deletedCountLabel(count: number): string {
  return `Deleted (${count})`
}

export function usageTotal(usage: TemplateUsage): number {
  return usage.buyerProfiles + usage.promptSets + usage.coverageMatrices
}

/** The three usage numbers are the listed items. Their sum is the artifact count. */
export function usageCountsMatch(usage: TemplateUsage): boolean {
  return usageTotal(usage) === usage.buyerProfiles + usage.promptSets + usage.coverageMatrices
}

const USAGE_NOUN: Readonly<Record<GenerationTemplateKind, readonly [string, string]>> = byKind(
  (kind) => templateKindInfo(kind).usageNoun
)

/** A record over every kind, so a kind added to the contract is covered without a change here. */
function byKind<T>(value: (kind: GenerationTemplateKind) => T): Record<GenerationTemplateKind, T> {
  return Object.fromEntries(GENERATION_TEMPLATE_KINDS.map((kind) => [kind, value(kind)])) as Record<
    GenerationTemplateKind,
    T
  >
}

export function usageCountForKind(kind: GenerationTemplateKind, usage: TemplateUsage): number {
  if (kind === 'buyer_profile') return usage.buyerProfiles
  if (kind === 'buyer_prompts') return usage.promptSets
  if (kind === 'coverage' || kind === 'coverage_matrix') return usage.coverageMatrices
  return 0
}

/** One count, for this template's kind only. */
export function usageLine(kind: GenerationTemplateKind, usage: TemplateUsage): string {
  const count = usageCountForKind(kind, usage)
  const nouns = USAGE_NOUN[kind]
  const noun = count === 1 ? nouns[0] : nouns[1]
  return `${count} ${noun} · ${formatLastUsed(usage.lastUsedAt)}`
}

export function formatLastUsed(value: string | null): string {
  if (value === null) return 'Not used yet'
  if (Number.isNaN(new Date(value).getTime())) return value
  return `Last used ${formatMoment(value)}`
}

export function deleteBlockedReason(template: GenerationTemplate): string | null {
  if (template.isShipped) return TEMPLATE_ERROR_MESSAGES.shipped_readonly
  if (template.isDefault) return TEMPLATE_ERROR_MESSAGES.default_in_use
  if (template.deletedAt !== null) return TEMPLATE_ERROR_MESSAGES.deleted
  return null
}

export function suggestedDuplicateName(name: string): string {
  const copy = `Copy of ${name.trim()}`.trim()
  return copy.slice(0, TEMPLATE_NAME_MAX_LENGTH)
}

export function compareBlockReason(count: number): string | null {
  if (count < 1) return 'Pick 1 to 3 templates of one kind.'
  if (count > PLAYGROUND_COMPARE_LIMIT) return TEMPLATE_ERROR_MESSAGES.compare_limit
  return null
}

export function toggleCompareId(
  current: readonly string[],
  id: string
): { ids: readonly string[]; error: string | null } {
  if (current.includes(id)) return { ids: current.filter((item) => item !== id), error: null }
  if (current.length >= PLAYGROUND_COMPARE_LIMIT) {
    return { ids: current, error: TEMPLATE_ERROR_MESSAGES.compare_limit }
  }
  return { ids: [...current, id], error: null }
}

/** One template. `templateIds` is omitted so an empty list is not sent. */
export function singleRunRequest(input: {
  url: string
  templateId: string
  overrides: PlaygroundOverrides | null
}): PlaygroundRunRequest {
  return {
    url: input.url,
    templateId: input.templateId,
    overrides: input.overrides
  }
}

export function compareRunRequest(input: {
  url: string
  templateIds: readonly string[]
  overrides: PlaygroundOverrides | null
}): PlaygroundRunRequest {
  return {
    url: input.url,
    templateIds: input.templateIds,
    overrides: input.overrides
  }
}

/** An empty pick omits `templateId` so the app-wide default applies. */
export function pageGenerationRequest(
  projectId: string,
  pageId: string,
  templateId: string
): { projectId: string; pageId: string; templateId?: string } {
  if (templateId.trim().length === 0) return { projectId, pageId }
  return { projectId, pageId, templateId }
}
