import type {
  SentimentCheckPoint,
  SentimentClaim,
  SentimentOverview,
  SentimentView
} from '@shared/domain'
import { formatNet } from '@shared/sentiment-metrics'
import type { DrillItem, DrillScope, DrillTarget, ItemDrill } from '../drill'
import { formatMoment } from '../utils/dates'
import { SOURCE_KIND_LABEL, TONE_LABEL } from './constants'
import type { SourceFilter } from './types'
import { hostOf, mdLink, mdText, shortUrl } from './utils/markdown'
import { pointCounts, pointNet } from './utils/model'

/** What a drill is called. `id` is the NFR-14 id the opener carries. */
export interface DrillCopy {
  id: string
  title: string
  /** Plain sentence under the title. */
  description?: string
  /** Such as "Oct 5, 2026" when the rows are not from the latest check. */
  checkDateLabel?: string
  /** True when the rows ignore the "Overviews from" picker (the trend). */
  everySource?: boolean
}

/**
 * Builds the Sentiment tab's drills. Each drawer lists exactly the claims,
 * overviews or checks behind the number that opened it, so its total equals
 * that number (NFR-14). A buyer prompt opens Prompt detail; a brand prompt
 * (not a page prompt) expands to the overview it comes from.
 */
export interface SentimentDrills {
  /** Claims by id, in that order. Ids not in this view are left out. */
  claims(copy: DrillCopy, claimIds: readonly string[]): ItemDrill
  /** Overviews by id, in that order. */
  overviews(copy: DrillCopy, overviewIds: readonly string[]): ItemDrill
  /** Full checks, such as the two behind "−10 since Oct 5". */
  checks(copy: DrillCopy, points: readonly SentimentCheckPoint[]): ItemDrill
  /** Own-brand claim ids of one full check: the latest from `claims`, earlier ones from `earlierClaims`. */
  runClaimIds(runId: string): string[]
  /** Prompt detail for a buyer prompt, pinned to its market and check. Null for a brand prompt. */
  promptTarget(
    item: Pick<SentimentOverview, 'source' | 'promptId' | 'marketId' | 'runId'>
  ): DrillTarget | null
  /** The overview a claim comes from. */
  overviewOf(claim: Pick<SentimentClaim, 'overviewId'>): SentimentOverview | undefined
}

const FILTER_TEXT: Readonly<Record<SourceFilter, string>> = {
  all: 'From brand and buyer questions.',
  brand: 'From brand questions only (the "Overviews from" picker).',
  buyer: 'From buyer questions only (the "Overviews from" picker).'
}

// The drawer can be 440px wide: the first column plus two narrow ones fit.
const CLAIM_COLUMNS = [
  { id: 'tone', label: 'Tone', width: '76px' },
  { id: 'about', label: 'About', width: 'minmax(84px, 0.8fr)' }
] as const

const OVERVIEW_COLUMNS = [
  { id: 'rank', label: 'Rank', width: '72px' },
  { id: 'claims', label: 'Claims', align: 'end', width: '56px' }
] as const

const CHECK_COLUMNS = [
  { id: 'net', label: 'Net', align: 'end', width: '56px' },
  { id: 'tone', label: '+ · = · −', align: 'end', width: '96px' }
] as const

function sourceTag(source: SentimentOverview['source']): string {
  return source === 'brand' ? 'Brand question' : 'Buyer question'
}

export function createSentimentDrills(input: {
  view: SentimentView
  brand: string
  /** Such as "🇺🇸 US · EN". */
  marketLabel: string
  filter: SourceFilter
}): SentimentDrills {
  const { view, brand, filter } = input
  const claimsById = new Map(
    [...view.claims, ...view.earlierClaims].map((claim) => [claim.id, claim] as const)
  )
  const overviewsById = new Map(
    [...view.overviews, ...view.earlierOverviews].map(
      (overview) => [overview.id, overview] as const
    )
  )
  const claimsByOverview = new Map<string, SentimentClaim[]>()
  for (const claim of claimsById.values()) {
    const list = claimsByOverview.get(claim.overviewId) ?? []
    list.push(claim)
    claimsByOverview.set(claim.overviewId, list)
  }
  const latest = view.trend.at(-1) ?? null

  function scope(copy: DrillCopy): DrillScope {
    return {
      pageId: view.pageId,
      marketId: view.marketId,
      runId: view.latestRunId,
      marketLabel: input.marketLabel,
      checkDateLabel: copy.checkDateLabel ?? formatMoment(latest?.checkedAt ?? null),
      brand,
      domain: ''
    }
  }

  function describe(copy: DrillCopy): string {
    const parts = [copy.description ?? '', copy.everySource ? FILTER_TEXT.all : FILTER_TEXT[filter]]
    return parts.filter((part) => part.length > 0).join(' ')
  }

  function promptTarget(
    item: Pick<SentimentOverview, 'source' | 'promptId' | 'marketId' | 'runId'>
  ): DrillTarget | null {
    if (item.source !== 'buyer') return null
    return {
      kind: 'prompt',
      pageId: view.pageId,
      promptId: item.promptId,
      marketId: item.marketId,
      runId: item.runId
    }
  }

  function overviewContext(overview: SentimentOverview, skipClaimId: string | null): string[] {
    const lines: string[] = []
    lines.push(
      `**${sourceTag(overview.source)}** · ${mdText(overview.promptLabel)}: ${mdText(overview.promptText)}`
    )
    if (overview.brandsNamed.length > 0) {
      const ranked = overview.brandsNamed
        .map((name, index) => {
          const text = `${index + 1}. ${mdText(name)}`
          return name === brand ? `**${text}**` : text
        })
        .join(' · ')
      lines.push(`**Brands named, in rank order:** ${ranked}`)
    } else if (overview.readState === 'read') {
      lines.push('**Brands named:** none of the tracked brands')
    }
    if (overview.reason)
      lines.push(`**Why ${mdText(brand)} sits there:** ${mdText(overview.reason)}`)
    const others = (claimsByOverview.get(overview.id) ?? []).filter(
      (claim) => claim.id !== skipClaimId
    )
    if (others.length > 0) {
      const title = skipClaimId === null ? 'Claims in this answer' : 'Other claims in this answer'
      lines.push(
        `**${title}:**\n${others
          .map(
            (claim) =>
              `- ${TONE_LABEL[claim.tone]} · ${mdText(claim.brand)}: “${mdText(claim.sentence)}”`
          )
          .join('\n')}`
      )
    }
    if (overview.references.length > 0) {
      lines.push(
        `**Sources Google listed:**\n${overview.references
          .map(
            (ref) =>
              `${ref.position}. ${mdLink(shortUrl(ref.url), ref.url)} · ${SOURCE_KIND_LABEL[ref.sourceType]}`
          )
          .join('\n')}`
      )
    }
    return lines
  }

  function claimItem(claim: SentimentClaim): DrillItem {
    const overview = overviewsById.get(claim.overviewId)
    const lines: string[] = []
    lines.push(
      claim.url
        ? `**Nearest source:** ${mdLink(shortUrl(claim.url), claim.url)}${
            claim.sourceKind ? ` · ${SOURCE_KIND_LABEL[claim.sourceKind]}` : ''
          }`
        : '**Nearest source:** no cited source next to this sentence'
    )
    if (claim.factProblem) {
      lines.push(
        `**Why it's wrong:** ${mdText(claim.factProblem.why)}`,
        `**Suggested correction:** ${mdText(claim.factProblem.correction)}`
      )
    }
    if (overview) lines.push(...overviewContext(overview, claim.id))
    return {
      id: claim.id,
      primary: `“${claim.sentence}”`,
      url: claim.url,
      secondary: overview ? `${sourceTag(claim.source)}: ${overview.promptText}` : null,
      target: overview ? promptTarget(overview) : null,
      cells: {
        tone: TONE_LABEL[claim.tone],
        about: `${claim.brand} · ${claim.theme}${claim.url ? ` · via ${hostOf(claim.url)}` : ''}`
      },
      detail: lines.join('\n\n'),
      group: claim.tone
    }
  }

  function overviewItem(overview: SentimentOverview): DrillItem {
    const rank = overview.brandsNamed.indexOf(brand)
    return {
      id: overview.id,
      primary: overview.promptText,
      secondary: `${sourceTag(overview.source)} · ${overview.promptLabel}${
        overview.brandsNamed.length > 0 ? ` · names ${overview.brandsNamed.join(', ')}` : ''
      }`,
      target: promptTarget(overview),
      cells: {
        rank: rank < 0 ? '—' : `#${rank + 1} of ${overview.brandsNamed.length}`,
        claims: (claimsByOverview.get(overview.id) ?? []).length
      },
      detail: overviewContext(overview, null).join('\n\n'),
      group: overview.source
    }
  }

  return {
    claims(copy, claimIds) {
      const items = claimIds.flatMap((id) => {
        const claim = claimsById.get(id)
        return claim ? [claimItem(claim)] : []
      })
      return {
        kind: 'items',
        id: copy.id,
        title: copy.title,
        description: describe(copy),
        noun: ['claim', 'claims'],
        primaryLabel: 'What the overview says',
        columns: CLAIM_COLUMNS,
        items,
        summary: [
          { label: 'Positive', group: 'positive' },
          { label: 'Neutral', group: 'neutral' },
          { label: 'Negative', group: 'negative' }
        ],
        note: 'A sentence links to its nearest cited source. A buyer question opens Question detail; expand a row to read the overview it comes from.',
        scope: scope(copy)
      }
    },
    overviews(copy, overviewIds) {
      const items = overviewIds.flatMap((id) => {
        const overview = overviewsById.get(id)
        return overview ? [overviewItem(overview)] : []
      })
      return {
        kind: 'items',
        id: copy.id,
        title: copy.title,
        description: describe(copy),
        noun: ['overview', 'overviews'],
        primaryLabel: 'Question',
        columns: OVERVIEW_COLUMNS,
        items,
        summary: [
          { label: 'Brand questions', group: 'brand' },
          { label: 'Buyer questions', group: 'buyer' }
        ],
        note: 'A buyer question opens Question detail. Expand a row for the brands it names, the reason and its sources.',
        scope: scope(copy)
      }
    },
    checks(copy, points) {
      return {
        kind: 'items',
        id: copy.id,
        title: copy.title,
        description: copy.description ?? '',
        noun: ['check', 'checks'],
        primaryLabel: 'Check',
        columns: CHECK_COLUMNS,
        items: points.map((point) => {
          const counts = pointCounts(point)
          return {
            id: point.runId,
            primary: formatMoment(point.checkedAt),
            secondary: `${counts.total} ${counts.total === 1 ? 'claim' : 'claims'} about ${brand}`,
            target: {
              kind: 'page',
              pageId: view.pageId,
              tab: 'history',
              marketId: view.marketId,
              runId: point.runId
            },
            cells: {
              net: formatNet(pointNet(point)),
              tone: `${point.positive} · ${point.neutral} · ${point.negative}`
            }
          }
        }),
        note: 'Select a check to open it in History. Net is shown from 5 claims.',
        scope: scope(copy)
      }
    },
    runClaimIds(runId) {
      const source = runId === view.latestRunId ? view.claims : view.earlierClaims
      return source.filter((claim) => claim.isOwn && claim.runId === runId).map((claim) => claim.id)
    },
    promptTarget,
    overviewOf: (claim) => overviewsById.get(claim.overviewId)
  }
}
