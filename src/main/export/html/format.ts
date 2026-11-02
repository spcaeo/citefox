import type { PromptCheckStatus, PromptSource } from '@shared/domain'
import { formatLongDate, formatShortDate } from '../model/format'
import { STAGE_LABELS } from '../model/overview'
import type { DomainWho, Pct, ReportMarket, ReportModel } from '../model/types'

/** Wording and number formats used by every section of the HTML report. */

export { formatLongDate, formatShortDate, STAGE_LABELS }

/** The app's result words (renderer ui/resultTones.ts), so a report reads like the screens. */
export const STATUS_LABELS: Record<PromptCheckStatus, string> = {
  page_cited: 'Target page',
  other_own_page: 'Your other page',
  brand_mentioned: 'Brand named',
  not_cited: 'Not cited',
  no_aio: 'No AI Overview',
  error: 'Check failed'
}

/** Status chip classes, the same as the app's (Mockups/Overview.dc.html). */
export const STATUS_CLASSES: Record<PromptCheckStatus, string> = {
  page_cited: 's-target',
  other_own_page: 's-own',
  brand_mentioned: 's-mention',
  not_cited: 's-none',
  no_aio: 's-noaio',
  error: 's-error'
}

export const SOURCE_LABELS: Record<PromptSource, string> = {
  title_meta_h1: 'Title, meta, H1',
  trigger_event: 'Trigger event',
  objection: 'Objection',
  detail_check: 'Detail check',
  written_by_user: 'Written by you'
}

export const WHO_LABELS: Record<DomainWho, string> = {
  you: 'You',
  competitor: 'Competitor',
  observed: 'Observed'
}

/** `35%`, or an em dash when there is no denominator. */
export function pct(value: Pct): string {
  return value === null ? '—' : `${value}%`
}

/** `1 prompt`, `3 prompts`. */
export function plural(n: number, singular: string, many = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : many}`
}

/** `19 Oct 2026`, or an em dash. */
export function shortDate(iso: string | null, timeZone: string): string {
  return iso === null ? '—' : formatShortDate(iso, timeZone)
}

/** `19 October 2026`, or an em dash. */
export function longDate(iso: string | null, timeZone: string): string {
  return iso === null ? '—' : formatLongDate(iso, timeZone)
}

/** `🇺🇸 US · EN`. */
export function marketText(market: ReportMarket): string {
  return market.flag.length > 0 ? `${market.flag} ${market.label}` : market.label
}

/** Market label by id, or the id itself when the market is not in the report. */
export function marketById(model: ReportModel, id: string): string {
  const market = model.markets.find((item) => item.id === id)
  return market === undefined ? id : marketText(market)
}

/** One decimal place, or an em dash. */
export function decimal(value: number | null): string {
  return value === null ? '—' : (Math.round(value * 10) / 10).toFixed(1)
}

/** `3,400`, or an em dash. */
export function whole(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US')
}
