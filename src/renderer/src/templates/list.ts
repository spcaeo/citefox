import type { GenerationTemplate } from '@shared/domain'
import { shortHash } from '../pageSetup/model'
import { formatMoment } from '../utils/dates'
import { templateFile } from './copy'

export const TEMPLATE_STATUSES = ['Default', 'Edited'] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]
export type TemplateSortKey = 'run' | 'name' | 'edited'
export type SortDirection = 'asc' | 'desc'

/**
 * The editor's Default and Edited tags.
 * A null `updatedAt` is the unedited body. `isDefault` is which template a kind runs.
 */
export function statusName(template: GenerationTemplate): TemplateStatus {
  return template.updatedAt === null ? 'Default' : 'Edited'
}

export function statusCounts(
  templates: readonly GenerationTemplate[]
): Record<TemplateStatus, number> {
  return {
    Default: templates.filter((template) => template.updatedAt === null).length,
    Edited: templates.filter((template) => template.updatedAt !== null).length
  }
}

export function isFiltering(query: string, statuses: readonly TemplateStatus[]): boolean {
  return query.trim().length > 0 || statuses.length > 0
}

/** The list status line. The number is how many rows the list renders. */
export function listLabel(shown: number, total: number, filtering: boolean): string {
  if (!filtering) return total === 1 ? '1 template' : `${total} templates`
  return `Showing ${shown} of ${total} templates`
}

export function visibleTemplates(
  templates: readonly GenerationTemplate[],
  query: string,
  statuses: readonly TemplateStatus[],
  sortKey: TemplateSortKey,
  sortDir: SortDirection
): GenerationTemplate[] {
  const needle = query.trim().toLowerCase()
  const filtered = templates.filter((template) => {
    if (needle.length > 0) {
      const haystack = `${template.name} ${templateFile(template)}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    if (statuses.length > 0 && !statuses.includes(statusName(template))) return false
    return true
  })
  if (sortKey === 'run') return [...filtered]
  return [...filtered].sort((left, right) => compareTemplates(left, right, sortKey, sortDir))
}

/** When it was last edited ("Oct 12"), or "—" for a template never edited. */
export function templateWhen(template: GenerationTemplate): string {
  if (template.updatedAt === null) return '—'
  return shortStamp(template.updatedAt)
}

/** "v3": the version alone, for a grid cell. */
export function templateVersion(template: GenerationTemplate): string {
  return `v${template.version}`
}

/** Stored `version` plus the short body hash. Not derived from `updatedAt`. */
export function templateVersionLine(template: GenerationTemplate): string {
  return `v${template.version} · ${shortHash(template.templateHash)}`
}

function compareTemplates(
  left: GenerationTemplate,
  right: GenerationTemplate,
  sortKey: TemplateSortKey,
  sortDir: SortDirection
): number {
  if (sortKey === 'name') {
    const cmp = left.name.localeCompare(right.name)
    return sortDir === 'desc' ? -cmp : cmp
  }
  if (left.updatedAt === null && right.updatedAt === null) return 0
  if (left.updatedAt === null) return 1
  if (right.updatedAt === null) return -1
  const cmp = left.updatedAt < right.updatedAt ? -1 : left.updatedAt > right.updatedAt ? 1 : 0
  return sortDir === 'desc' ? -cmp : cmp
}

function shortStamp(value: string): string {
  if (Number.isNaN(new Date(value).getTime())) return value
  return formatMoment(value)
}
