import { SEARCHES_PER_PROMPT_MAX, SEARCHES_PER_PROMPT_MIN, type PageStatus } from '@shared/domain'
import type { PageDetail, PinnedPage } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { PageChrome } from './chrome'

/** A topic has no URL (`url` null); its `title` is the topic name. */
export function pageLabel(page: {
  label: string | null
  title: string | null
  url: string | null
}): string {
  return page.label ?? page.title ?? page.url ?? 'Topic'
}

/**
 * The page's heading (its h1): the title, else the short label. The top bar's
 * breadcrumb uses the same words, so a page labelled "Alerts" never reads as the
 * Alerts screen.
 */
export function pageHeading(page: {
  label: string | null
  title: string | null
  url: string | null
}): string {
  return page.title ?? pageLabel(page)
}

export function displayUrl(url: string | null): string {
  if (url === null) return ''
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.host}${path}`
  } catch {
    return url
  }
}

export function pageStatusLabel(status: PageStatus): string {
  switch (status) {
    case 'tracked':
      return 'Tracked'
    case 'setting_up':
      return 'Setting up'
    case 'paused':
      return 'Paused'
    case 'not_tracked':
      return 'Not tracked'
    case 'removed':
      return 'Removed'
  }
}

export function setupStepLabel(step: PageDetail['setupStep']): string | null {
  switch (step) {
    case 'read':
      return 'Read page'
    case 'profile':
      return 'Buyer profile'
    case 'prompts':
      return 'Questions'
    case 'check':
      return 'First check'
    case null:
      return null
  }
}

export function promptSetTag(version: number | null, promptCount: number): string | null {
  if (version === null) return null
  const prompts = promptCount === 1 ? '1 question' : `${promptCount} questions`
  return `Question set v${version} · ${prompts}`
}

export function trayRunningLabel(running: boolean): string {
  return running ? 'Running in the tray' : 'Not running in the tray'
}

export function trayDueLabel(count: number): string {
  return `${pluralize(count, 'page')} due today`
}

export function showingPages(shown: number, total: number): string {
  if (shown === total) return `Showing ${pluralize(shown, 'page')}`
  return `Showing ${shown.toLocaleString('en-US')} of ${pluralize(total, 'page')}`
}

/** FR-1.6. Prompts × markets × samples × 1–2 searches. */
/** A figure that has not loaded, or that has no value yet. */
export const NO_VALUE = '—'

export const PAGE_SEARCH_PREVIEW = 8

export function checkSearchEstimate(prompts: number, markets: number, samples: number): string {
  const units = Math.max(0, prompts) * Math.max(0, markets) * Math.max(0, samples)
  const min = units * SEARCHES_PER_PROMPT_MIN
  const max = units * SEARCHES_PER_PROMPT_MAX
  const sampleBit = samples > 1 ? ` and ${samples} samples` : ''
  return `With ${pluralize(prompts, 'question')} in ${pluralize(markets, 'market')}${sampleBit}: ${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')} searches.`
}

/**
 * FR-1.6 monthly reading of the same range. Every day is about 30 checks, 7 days about
 * four, 14 days about two; 30 days and longer count as one.
 */
export function monthlyCheckEstimate(
  prompts: number,
  markets: number,
  samples: number,
  intervalDays: number
): string {
  const units = Math.max(0, prompts) * Math.max(0, markets) * Math.max(0, samples)
  const checks = intervalDays > 0 ? Math.max(1, Math.floor(30 / intervalDays)) : 1
  const min = units * SEARCHES_PER_PROMPT_MIN * checks
  const max = units * SEARCHES_PER_PROMPT_MAX * checks
  const cadence = checks === 1 ? 'about 1 check' : `about ${checks} checks`
  const every = intervalDays === 1 ? 'Every day' : `Every ${intervalDays} days`
  return `${every} that is ${cadence} a month: ${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')} searches a month for this page.`
}

/** Sidebar preview is shorter than the grid. Null when every match is already listed. */
export function pageSearchPreviewLabel(total: number): string | null {
  if (total <= PAGE_SEARCH_PREVIEW) return null
  return `Showing ${PAGE_SEARCH_PREVIEW.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`
}

export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function pageChromeFromDetail(page: PageDetail): PageChrome {
  return {
    label: pageLabel(page),
    title: pageHeading(page),
    displayUrl: displayUrl(page.url),
    href: page.url ?? '',
    markets: page.markets,
    intervalDays: page.intervalDays,
    samples: page.samples,
    promptSetVersion: page.promptSetVersion,
    promptCount: page.promptCount
  }
}

export function pageChromeFromPinned(page: PinnedPage): PageChrome {
  return {
    label: pageLabel(page),
    title: pageHeading(page),
    displayUrl: displayUrl(page.url),
    href: page.url,
    markets: page.markets,
    intervalDays: page.intervalDays,
    samples: page.samples,
    promptSetVersion: page.promptSetVersion,
    promptCount: page.promptCount
  }
}
