import {
  SEARCHES_PER_PROMPT_MAX,
  SEARCHES_PER_PROMPT_MIN,
  type Market,
  type PageResults
} from '@shared/domain'
import type { MarketDraft } from '@shared/ipc'
import { formatMonthDay, signed, statusLabel } from '../../m3/model'
import type { MarketForm, MarketResults, MatrixCell, MatrixRow } from '../types'
import { TOP_DOMAINS } from '../constants'

/** "Country · default", "City: Austin, Texas · local wording". */
export function marketKindLabel(market: Market, defaultMarketId: string | null): string {
  const parts = [
    market.location
      ? market.serpapiLocation
        ? `City: ${market.serpapiLocation}`
        : `City: ${market.location} (not matched to a Google location)`
      : 'Country'
  ]
  if (market.id === defaultMarketId) parts.push('default')
  if (market.localWording) parts.push('local wording')
  return parts.join(' · ')
}

export function promptLanguageLabel(market: Market): string {
  const code = market.language
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.toUpperCase())
    .join('-')
  return market.localWording ? `${code}, local wording` : code
}

export function deviceLabel(device: Market['device']): string {
  return device === 'mobile' ? 'Mobile' : 'Desktop'
}

/** Searches one check of one market costs: prompts × samples × 1 to 2 (FR-1.6, FR-9.6). */
export function searchRange(prompts: number, samples: number, markets = 1): [number, number] {
  const units = Math.max(0, prompts) * Math.max(0, samples) * Math.max(0, markets)
  return [units * SEARCHES_PER_PROMPT_MIN, units * SEARCHES_PER_PROMPT_MAX]
}

export function rangeLabel([min, max]: readonly [number, number]): string {
  return `${min.toLocaleString('en-US')}–${max.toLocaleString('en-US')}`
}

/** "+12 since Oct 5", "No change since Oct 5", or the first-check wording. */
export function scoreChangeLabel(results: PageResults): string {
  const change = results.scoreChange.sincePrevious
  const previous = results.comparison.find((column) => column.which === 'previous')
  if (change === null || !previous?.finishedAt) return 'First check in this market'
  const since = formatMonthDay(previous.finishedAt)
  if (change === 0) return `No change since ${since}`
  return `${signed(change)} since ${since}`
}

export function scoreTone(results: PageResults): 'm3-up' | 'm3-down' | 'm3-flat' {
  const change = results.scoreChange.sincePrevious
  if (change === null || change === 0) return 'm3-flat'
  return change > 0 ? 'm3-up' : 'm3-down'
}

/** FR-9.7 grid: every prompt that any market checked, in prompt order. */
export function buildMatrix(markets: readonly MarketResults[]): MatrixRow[] {
  const byId = new Map<string, Omit<MatrixRow, 'cells' | 'differs'>>()
  for (const { results } of markets) {
    for (const row of results?.prompts ?? []) {
      if (!byId.has(row.promptId)) {
        byId.set(row.promptId, {
          promptId: row.promptId,
          position: row.promptPosition,
          label: row.label,
          text: row.text
        })
      }
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.position - b.position)
    .map((prompt) => {
      const cells: MatrixCell[] = markets.map(({ market, results }) => {
        const row = results?.prompts.find((item) => item.promptId === prompt.promptId)
        return {
          marketId: market.id,
          runId: row ? (results?.run?.runId ?? null) : null,
          status: row?.status ?? null,
          position: row?.position ?? null
        }
      })
      const checked = cells.flatMap((cell) => (cell.status === null ? [] : [cell.status]))
      return { ...prompt, cells, differs: new Set(checked).size > 1 }
    })
}

export function cellLabel(cell: MatrixCell): string {
  if (cell.status === null) return 'Not checked'
  return cell.position === null
    ? statusLabel(cell.status)
    : `${statusLabel(cell.status)} · ${cell.position}`
}

export function filterMatrix(
  rows: readonly MatrixRow[],
  query: string,
  onlyDiffer: boolean
): MatrixRow[] {
  const needle = query.trim().toLowerCase()
  return rows.filter((row) => {
    if (onlyDiffer && !row.differs) return false
    if (!needle) return true
    return (
      row.label.toLowerCase().includes(needle) ||
      row.text.toLowerCase().includes(needle) ||
      String(row.position) === needle
    )
  })
}

/** Most-cited other domains in one market, counted in AIOs like the leaderboard (FR-12.8). */
export function topDomains(results: PageResults | null): { domain: string; count: number }[] {
  if (!results) return []
  return results.leaderboard
    .filter((row) => row.badge !== 'you')
    .slice()
    .sort((a, b) => b.aioCount - a.aioCount || a.domain.localeCompare(b.domain))
    .slice(0, TOP_DOMAINS)
    .map((row) => ({ domain: row.domain, count: row.aioCount }))
}

export function draftOf(market: Market): MarketDraft {
  return {
    country: market.country,
    language: market.language,
    location: market.location,
    device: market.device,
    localWording: market.localWording
  }
}

export function draftFromForm(form: MarketForm): MarketDraft {
  const location = form.location.trim()
  return {
    country: form.country,
    language: form.language,
    location: location.length > 0 ? location : null,
    device: form.device,
    localWording: form.localWording
  }
}

/** The engine reuses a market row only when every field matches (pages:update). */
export function sameMarket(market: MarketDraft, draft: MarketDraft): boolean {
  return (
    market.country === draft.country &&
    market.language === draft.language &&
    (market.location ?? '').toLowerCase() === (draft.location ?? '').toLowerCase() &&
    market.device === draft.device &&
    market.localWording === draft.localWording
  )
}

/** After `pages:update`, the new market is the one that was not on the page before. */
export function addedMarketId(
  before: readonly Market[],
  after: readonly Market[],
  draft: MarketDraft
): string | null {
  const known = new Set(before.map((market) => market.id))
  const fresh = after.find((market) => !known.has(market.id))
  if (fresh) return fresh.id
  return after.find((market) => sameMarket(draftOf(market), draft))?.id ?? null
}
