import { INTERVAL_DAYS, type IntervalDays, type PageStatus, type SampleCount } from '@shared/domain'
import type { PageDetail, UpdatePageRequest } from '@shared/ipc'

/** Check intervals a page can take (FR-1.4: Add page offers 14 or 30; import adds 60 and 90). */
export const INTERVAL_CHOICES: readonly IntervalDays[] = INTERVAL_DAYS

/** Samples per question (FR-1.5). */
export const SAMPLE_CHOICES: readonly SampleCount[] = [1, 2, 3, 4, 5]

/** Sections the header chips open the drawer at (`ps.section`). */
export const PAGE_SETTINGS_SECTIONS = ['identity', 'schedule', 'markets', 'status'] as const
export type PageSettingsSection = (typeof PAGE_SETTINGS_SECTIONS)[number]

export function isPageSettingsSection(value: string | undefined): value is PageSettingsSection {
  return PAGE_SETTINGS_SECTIONS.some((section) => section === value)
}

/** What the form edits. */
export interface PageSettingsForm {
  label: string
  url: string
  intervalDays: IntervalDays
  samples: SampleCount
  defaultMarketId: string
}

export function formFromPage(page: PageDetail): PageSettingsForm {
  return {
    label: page.label ?? '',
    url: page.url ?? '',
    intervalDays: page.intervalDays,
    samples: page.samples,
    defaultMarketId: page.defaultMarketId ?? page.markets[0]?.id ?? ''
  }
}

/** Why the URL cannot be saved, or null. A topic has no URL to check. */
export function urlProblem(url: string, isTopic: boolean): string | null {
  if (isTopic) return null
  const trimmed = url.trim()
  if (trimmed.length === 0) return 'Enter the page address.'
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'Enter a full address that starts with https://'
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'Enter a full address that starts with https://'
  }
  return null
}

export function labelProblem(label: string): string | null {
  return label.trim().length > 80 ? 'Keep the label to 80 characters.' : null
}

/** Only the fields that changed, as a `pages:update` request (null when nothing changed). */
export function changesFor(
  page: PageDetail,
  form: PageSettingsForm,
  projectId: string
): UpdatePageRequest | null {
  const before = formFromPage(page)
  const request: UpdatePageRequest = { projectId, pageId: page.id }
  let changed = false
  const label = form.label.trim()
  if (label !== before.label.trim()) {
    request.label = label.length === 0 ? null : label
    changed = true
  }
  const url = form.url.trim()
  if (page.kind !== 'topic' && url !== before.url) {
    request.url = url
    changed = true
  }
  if (form.intervalDays !== before.intervalDays) {
    request.intervalDays = form.intervalDays
    changed = true
  }
  if (form.samples !== before.samples) {
    request.samples = form.samples
    changed = true
  }
  if (form.defaultMarketId !== before.defaultMarketId && form.defaultMarketId !== '') {
    request.defaultMarketId = form.defaultMarketId
    changed = true
  }
  return changed ? request : null
}

/**
 * Searches one full check uses: questions × samples × markets, up to twice that
 * when an overview needs its second call (section 6.1).
 */
export function searchesPerCheck(
  questions: number,
  samples: number,
  markets: number
): { min: number; max: number } {
  const min = Math.max(0, questions) * samples * markets
  return { min, max: min * 2 }
}

export function searchesLine(range: { min: number; max: number }, intervalDays: number): string {
  if (range.min === 0) return 'No questions to check yet.'
  const perMonth = Math.round((range.min * 30) / intervalDays)
  const span =
    range.min === range.max
      ? `${range.min.toLocaleString('en-US')}`
      : `${range.min.toLocaleString('en-US')}–${range.max.toLocaleString('en-US')}`
  return `About ${span} searches per check · about ${perMonth.toLocaleString('en-US')}+ a month`
}

/** The status a removed page goes back to on Undo, or null when it cannot. */
export function restorableStatus(status: PageStatus): 'setting_up' | 'tracked' | 'paused' | null {
  return status === 'setting_up' || status === 'tracked' || status === 'paused' ? status : null
}
