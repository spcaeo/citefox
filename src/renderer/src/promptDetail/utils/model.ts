import type {
  AioReference,
  Market,
  PromptCheckDetail,
  PromptCheckRow,
  PromptCheckStatus,
  PromptSource,
  SampleCapture,
  TrendPoint
} from '@shared/domain'
import { knownPlatform, platformLabel } from '@shared/site-role'
import { SITE_TYPE_LABELS, siteTypeOf } from '@shared/site-type'
import { formatMoment } from '../../utils/dates'
import { marketLabel } from '../../shell/model'
import { coverageLabel, displayUrl, statusLabel } from '../../m3/model'
import type { CitationCounts, PromptNeighbours, PromptTimeRow, SourceKind } from '../types'
import { HISTORY_RUNS } from '../constants'
import type { VersionLink } from '../edit/model'

/** Prompt order is `promptPosition` in the latest check (FR-13.1). */
export function neighbours(rows: readonly PromptCheckRow[], promptId: string): PromptNeighbours {
  const ordered = [...rows].sort((a, b) => a.promptPosition - b.promptPosition)
  const index = ordered.findIndex((row) => row.promptId === promptId)
  if (index < 0) return { index: -1, total: ordered.length, previousId: null, nextId: null }
  return {
    index,
    total: ordered.length,
    previousId: ordered[index - 1]?.promptId ?? null,
    nextId: ordered[index + 1]?.promptId ?? null
  }
}

export function sourceKind(reference: Pick<AioReference, 'classification'>): SourceKind {
  switch (reference.classification) {
    case 'target':
      return 'this_page'
    case 'own':
      return 'own'
    case 'competitor':
      return 'competitor'
    case 'other':
      return 'other'
  }
}

/** Who a source is. A known platform names itself ("Community · Reddit r/msp"); any other site is Neutral. */
export function sourceKindLabel(
  reference: Pick<AioReference, 'classification' | 'untracked'> & { url?: string }
): string {
  switch (sourceKind(reference)) {
    case 'this_page':
      return 'This page'
    case 'own':
      return reference.untracked ? 'Own page, not tracked' : 'Own page'
    case 'competitor':
      return 'Competitor'
    case 'other': {
      const platform = reference.url === undefined ? null : knownPlatform(reference.url)
      return platform ? platformLabel(platform) : 'Neutral'
    }
  }
}

/** FR-13.2. Counts links in one reference list. `named` comes from the rolled-up row. */
export function citationCounts(
  references: readonly AioReference[],
  named: boolean | null
): CitationCounts {
  return {
    thisPage: references.filter((reference) => reference.classification === 'target').length,
    otherOwn: references.filter((reference) => reference.classification === 'own').length,
    named
  }
}

function sameReferences(a: readonly AioReference[], b: readonly AioReference[]): boolean {
  if (a.length !== b.length) return false
  return a.every((reference, index) => reference.normalizedUrl === b[index]?.normalizedUrl)
}

/**
 * The sample the rolled-up status came from: the one whose references match
 * the row (`PromptCheckRow.references` is that sample's list). Otherwise the
 * first sample with an overview, then the first sample.
 */
export function winningSampleIndex(detail: PromptCheckDetail): number {
  const { samples, row } = detail
  if (samples.length === 0) return -1
  if (row && row.references.length > 0) {
    const match = samples.findIndex((sample) => sameReferences(sample.references, row.references))
    if (match >= 0) return match
  }
  const withAio = samples.findIndex((sample) => sample.hasAio)
  return withAio >= 0 ? withAio : 0
}

export function sampleLabel(sample: SampleCapture, total: number): string {
  return total === 1 ? 'The only sample' : `Sample ${sample.sampleNo} of ${total}`
}

export function marketNameFor(markets: readonly Market[], marketId: string): string {
  const market = markets.find((item) => item.id === marketId)
  return market ? marketLabel(market) : 'Market no longer on this page'
}

export function marketKind(market: Market, defaultMarketId: string | null): string {
  const parts: string[] = []
  if (market.id === defaultMarketId) parts.push('default')
  if (market.location) parts.push('city')
  return parts.length > 0 ? `(${parts.join(', ')})` : ''
}

/**
 * "This prompt over time" from `results:history` points and one
 * `checks:getPrompt` per run. Only the newest {@link HISTORY_RUNS} runs.
 */
export function overTimeRows(
  points: readonly TrendPoint[],
  details: ReadonlyMap<string, PromptCheckDetail>,
  /** Prompt-set version → the same prompt in it (`prompts:versions`). */
  links: ReadonlyMap<number, VersionLink> = new Map()
): PromptTimeRow[] {
  const shown = recentPoints(points)
  return shown.map((point, index) => {
    const row = details.get(point.runId)?.row ?? null
    const link = point.promptSetVersion === null ? undefined : links.get(point.promptSetVersion)
    return {
      runId: point.runId,
      finishedAt: point.finishedAt,
      status: row?.status ?? null,
      position: row?.position ?? null,
      partial: point.partial,
      first: index === 0 && shown.length === points.length,
      contentChanged: point.contentChanged,
      promptId: row ? (link?.promptId ?? row.promptId) : null,
      earlierWording: row ? (link?.earlierWording ?? null) : null,
      ownPages: ownPagesOf(details.get(point.runId) ?? null)
    }
  })
}

/** Your pages cited in one check, each once at its best position, best first. */
function ownPagesOf(
  detail: PromptCheckDetail | null
): { url: string; position: number; target: boolean }[] {
  const best = new Map<string, { url: string; position: number; target: boolean }>()
  for (const sample of detail?.samples ?? []) {
    for (const ref of sample.references) {
      if (ref.classification !== 'target' && ref.classification !== 'own') continue
      const seen = best.get(ref.normalizedUrl)
      if (seen === undefined || ref.position < seen.position) {
        best.set(ref.normalizedUrl, {
          url: ref.url,
          position: ref.position,
          target: ref.classification === 'target' || (seen?.target ?? false)
        })
      }
    }
  }
  return [...best.values()].sort((a, b) => a.position - b.position)
}

export function recentPoints(points: readonly TrendPoint[]): TrendPoint[] {
  return points.slice(Math.max(0, points.length - HISTORY_RUNS))
}

export function contentLabel(row: PromptTimeRow): string {
  if (row.first) return 'Baseline'
  return row.contentChanged ? 'Content changed' : 'Unchanged'
}

export function positionLabel(position: number | null): string {
  return position === null ? '' : `Position ${position}`
}

export interface FixBriefInput {
  pageUrl: string
  marketName: string
  detail: PromptCheckDetail
  sample: SampleCapture | null
}

/**
 * Plain-text brief built only from stored data: the prompt, the result, the
 * sources, the stored gap facts, and the page coverage. Nothing is invented.
 */
export function fixBrief(input: FixBriefInput): string {
  const { detail, sample } = input
  const row = detail.row
  const lines: string[] = []
  const title = row ? `Question ${row.promptPosition} · ${row.label}` : 'Question'
  lines.push(`Fix brief: ${plain(title)} (${input.marketName})`)
  lines.push(`Page: ${input.pageUrl}`)
  if (row) {
    lines.push(`Question: ${plain(row.text)}`)
    const position = row.position === null ? '' : ` · position ${row.position}`
    lines.push(
      `Checked ${formatMoment(row.checkedAt)}: ${statusLabel(row.status)}${position}` +
        (row.frequency.samples > 1
          ? ` (${row.frequency.matching} of ${row.frequency.samples} samples)`
          : '')
    )
  }
  const references = sample?.references ?? row?.references ?? []
  if (references.length > 0) {
    lines.push('', 'Sources Google listed:')
    for (const reference of references) {
      lines.push(`${reference.position}. ${displayUrl(reference.url)} (${briefKind(reference)})`)
    }
  }
  if (detail.aioGap && detail.aioGap.length > 0) {
    lines.push('', `What the overview says that the page doesn't:`)
    for (const gap of detail.aioGap) {
      lines.push(`- ${plain(gap.fact)}${gap.likelySource ? ` (from ${gap.likelySource})` : ''}`)
    }
  }
  if (row?.coverage) lines.push('', `Page coverage: ${coverageLabel(row.coverage)}`)
  if (detail.whereCovered.length > 0) {
    lines.push('Where the page covers it:')
    for (const place of detail.whereCovered) lines.push(`- ${plain(place)}`)
  }
  if (row?.action) lines.push('', `What to update: ${plain(row.action)}`)
  if (sample?.aioText) {
    lines.push('', 'AI Overview text as Google showed it:')
    for (const line of sample.aioText.split('\n')) lines.push(`> ${line}`)
  }
  return lines.join('\n')
}

/** This page or an own page as the check stored it; any other source by its type of site. */
function briefKind(reference: AioReference): string {
  const kind = sourceKind(reference)
  if (kind === 'this_page' || kind === 'own') return sourceKindLabel(reference)
  return SITE_TYPE_LABELS[
    siteTypeOf({
      url: reference.url,
      own: false,
      competitor: kind === 'competitor',
      sourceType: reference.sourceType
    })
  ]
}

/** Prompt text can carry `**` emphasis. The brief is plain text. */
function plain(text: string): string {
  return text.split('**').join('')
}

export function promptSourceLabel(source: PromptSource): string {
  switch (source) {
    case 'title_meta_h1':
      return 'from the title, meta and H1'
    case 'trigger_event':
      return 'from a trigger event'
    case 'objection':
      return 'from an objection'
    case 'detail_check':
      return 'from a detail check'
    case 'written_by_user':
      return 'written by you'
  }
}

/** What a status means and what it scores (SRS §7.2), for the status popover. */
export function statusMeaning(status: PromptCheckStatus): { meaning: string; points: string } {
  switch (status) {
    case 'page_cited':
      return { meaning: 'The AI Overview links this page.', points: 'Scores 3 of 3 points' }
    case 'other_own_page':
      return {
        meaning: 'The AI Overview cites your site, but not the target page.',
        points: 'Scores 1 of 3 points'
      }
    case 'brand_mentioned':
      return {
        meaning: 'The AI Overview names your brand in its text but links none of your pages.',
        points: 'Scores 1 of 3 points'
      }
    case 'not_cited':
      return {
        meaning: 'The AI Overview neither links your site nor names your brand.',
        points: 'Scores 0 of 3 points'
      }
    case 'no_aio':
      return {
        meaning: 'Google showed no AI Overview for this question.',
        points: 'Left out of the score'
      }
    case 'error':
      return { meaning: 'The search for this question failed.', points: 'Left out of the score' }
  }
}

/** Moves to a card on the screen: scrolls its heading into view and focuses it. */
export function goToCard(headingId: string): void {
  const heading = document.getElementById(headingId)
  if (!heading) return
  heading.scrollIntoView?.({ block: 'start' })
  heading.focus()
}

/** The DOM id of a source line, so gap facts can point at it. */
export function sourceAnchor(position: number): string {
  return `pd-src-${position}`
}

/** The source a gap fact's "likely from" names, matched by domain, title or URL. */
export function sourceFor(
  references: readonly AioReference[],
  likely: string
): AioReference | null {
  const needle = likely.trim().toLowerCase()
  if (!needle) return null
  return (
    references.find(
      (ref) =>
        ref.domain.toLowerCase() === needle ||
        needle.includes(ref.domain.toLowerCase()) ||
        (ref.title ?? '').toLowerCase().includes(needle) ||
        ref.url.toLowerCase().includes(needle)
    ) ?? null
  )
}
