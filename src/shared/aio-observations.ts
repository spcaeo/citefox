import type { AioOverview, AioSource } from './aio-overview'
import { overviewPassages, passageLabel, sentenceAt, type AioPassage } from './aio-passages'
import { brandMarks, findNames } from './brand-mentions'
import { cleanHost, competitorFor, type CompetitorTier } from './competitor-hosts'
import type { CitationClass, OverviewLens } from './domain'
import { isOwnHost } from './own-site'

/**
 * "What this overview says about you", computed in code with no Claude call: where
 * the overview names the brand or the own site, which of the own pages it cites and
 * for which passages, competitors named and cited (the page's product competitors),
 * and a one-line verdict. The same function feeds the prompt page card and the
 * "Analyse with Claude" prompt, so both read the same observations.
 */

export type ObservedSourceKind = 'this_page' | 'own' | 'competitor' | 'other'

export interface BrandMention {
  passageId: string
  section: string | null
  /** The sentence that names the brand or the own site. */
  sentence: string
  /** 1-based place of the passage among the non-heading passages (0: a heading). */
  order: number
  /** True when the passage cites one of the own pages. */
  cited: boolean
}

export interface OwnSourceLine {
  index: number
  url: string | null
  title: string | null
  name: string
  /** 1-based place in Google's source list. */
  position: number
  kind: 'this_page' | 'own'
  /** Passages that cite it, in reading order. */
  passages: readonly { id: string; label: string }[]
}

export interface PassageLine {
  passageId: string
  section: string | null
  label: string
  sentence: string
}

export interface CompetitorLine {
  name: string
  /** Its site's host, when known (the saved domain, else the cited host). */
  domain: string | null
  /** Null for a source the check stored as a competitor that the product's list no longer has. */
  tier: CompetitorTier | null
  /** Times the text names it. */
  named: number
  /** Sources on its site. */
  cited: number
}

export interface OverviewObservations {
  /** The first brand name, for copy. */
  brand: string
  mentions: readonly BrandMention[]
  /** Headings the mentions sit under, in order, once each (null: before the first heading). */
  sections: readonly (string | null)[]
  ownSources: readonly OwnSourceLine[]
  sourceCount: number
  namedNotCited: readonly BrandMention[]
  citedNotNamed: readonly PassageLine[]
  competitors: readonly CompetitorLine[]
  firstMention: { order: number; of: number; section: string | null } | null
  /** Sentences with an empty slot where Google showed a name the search data left out. */
  gaps: readonly PassageLine[]
  verdict: string
}

/** What the observations read: the overview, the lens, and the sample's scored sources. */
export interface ObservationInput {
  overview: Pick<AioOverview, 'blocks' | 'sources'>
  lens: OverviewLens
  /** The sample's scored references: their stored classification wins over the lens. */
  references: readonly { url: string; classification: CitationClass }[]
}

/** Every observation for one overview. */
export function observeOverview(input: ObservationInput): OverviewObservations {
  const { overview, lens } = input
  const passages = overviewPassages(overview)
  const kinds = sourceKinds(input)
  const ownIndexes = new Set(
    overview.sources
      .filter((source) => isOwnKind(kinds.get(source.index)))
      .map((source) => source.index)
  )
  const citesOwn = (passage: AioPassage): boolean => passage.refs.some((ref) => ownIndexes.has(ref))

  const mentions: BrandMention[] = []
  for (const passage of passages) {
    for (const mark of brandMarks(passage.text, lens)) {
      mentions.push({
        passageId: passage.id,
        section: passage.section,
        sentence: sentenceAt(passage.text, mark.start),
        order: passage.order,
        cited: citesOwn(passage)
      })
    }
  }
  const mentioned = new Set(mentions.map((mention) => mention.passageId))
  const ownSources = overview.sources.flatMap((source, at): OwnSourceLine[] => {
    const kind = kinds.get(source.index)
    if (kind !== 'this_page' && kind !== 'own') return []
    return [
      {
        index: source.index,
        url: source.url,
        title: source.title,
        name: siteName(source),
        position: at + 1,
        kind,
        passages: passages
          .filter((passage) => passage.refs.includes(source.index))
          .map((passage) => ({ id: passage.id, label: passageLabel(passage) }))
      }
    ]
  })
  const citedNotNamed = passages
    .filter((passage) => citesOwn(passage) && !mentioned.has(passage.id))
    .map((passage) => line(passage, sentenceAt(passage.text, 0)))
  const body = passages.filter((passage) => passage.kind !== 'heading')
  const first = mentions[0]
  const observations = {
    brand: lens.brandNames[0] ?? lens.ownDomain,
    mentions,
    sections: unique(mentions.map((mention) => mention.section)),
    ownSources,
    sourceCount: overview.sources.length,
    namedNotCited: mentions.filter((mention) => !mention.cited),
    citedNotNamed,
    competitors: competitorLines(passages, overview.sources, kinds, lens),
    firstMention:
      first === undefined
        ? null
        : { order: Math.max(first.order, 1), of: body.length, section: first.section },
    gaps: dataGaps(passages)
  }
  return { ...observations, verdict: verdictLine(observations, passages) }
}

/** This page, own page, competitor or other per source index. */
function sourceKinds(input: ObservationInput): Map<number, ObservedSourceKind> {
  const stored = new Map<string, CitationClass>()
  for (const reference of input.references) {
    const key = urlKey(reference.url)
    if (key !== null && !stored.has(key)) stored.set(key, reference.classification)
  }
  const kinds = new Map<number, ObservedSourceKind>()
  for (const source of input.overview.sources) {
    const saved = stored.get(urlKey(source.url) ?? '')
    if (saved !== undefined) {
      kinds.set(source.index, saved === 'target' ? 'this_page' : saved)
      continue
    }
    const host = cleanHost(hostOf(source.url))
    if (host.length > 0 && isOwnHost(host, input.lens.ownDomain, input.lens.includeSubdomains)) {
      kinds.set(source.index, 'own')
    } else if (host.length > 0 && competitorFor(host, tiers(input.lens)) !== null) {
      kinds.set(source.index, 'competitor')
    } else {
      kinds.set(source.index, 'other')
    }
  }
  return kinds
}

function competitorLines(
  passages: readonly AioPassage[],
  sources: readonly AioSource[],
  kinds: ReadonlyMap<number, ObservedSourceKind>,
  lens: OverviewLens
): CompetitorLine[] {
  const lines = new Map<string, CompetitorLine>()
  const lineFor = (
    name: string,
    tier: CompetitorTier | null,
    domain: string | null
  ): CompetitorLine => {
    const key = name.toLowerCase()
    const existing = lines.get(key)
    if (existing) {
      existing.domain ??= domain
      return existing
    }
    const created: CompetitorLine = { name, domain, tier, named: 0, cited: 0 }
    lines.set(key, created)
    return created
  }
  for (const competitor of lens.competitors) {
    const needles = competitor.domain ? [competitor.name, competitor.domain] : [competitor.name]
    const named = passages.reduce(
      (sum, passage) => sum + distinctHits(findNames(passage.text, needles)),
      0
    )
    if (named > 0) {
      lineFor(competitor.name, competitor.tier, competitor.domain ?? null).named += named
    }
  }
  for (const source of sources) {
    if (kinds.get(source.index) !== 'competitor') continue
    const host = cleanHost(hostOf(source.url))
    const hit = competitorFor(host, tiers(lens))
    lineFor(hit?.name ?? (host || siteName(source)), hit?.tier ?? null, host || null).cited += 1
  }
  return [...lines.values()]
    .filter((item) => item.named + item.cited > 0)
    .sort((a, b) => b.cited + b.named - (a.cited + a.named) || a.name.localeCompare(b.name))
}

/** A name and its domain in the same place count once. */
function distinctHits(hits: readonly { start: number; end: number }[]): number {
  let count = 0
  let end = -1
  for (const hit of hits) {
    if (hit.start >= end) count += 1
    end = Math.max(end, hit.end)
  }
  return count
}

/**
 * SerpApi sometimes drops a name Google showed as a link, leaving "a service like
 * Example Co or ." or "like or Plivo". Only those clear shapes count.
 */
const GAP_PATTERNS = [
  /\b(?:or|and)\s+[.,;:!?](?=\s|$)/iu,
  /\b(?:like|such as|including|from|with|versus|vs\.?)\s+(?:or|and|,)\s/iu,
  /[\p{L}\p{N}]\s{2,}(?:or|and)\b/iu
]

function dataGaps(passages: readonly AioPassage[]): PassageLine[] {
  const gaps: PassageLine[] = []
  for (const passage of passages) {
    if (passage.kind === 'table') continue
    for (const pattern of GAP_PATTERNS) {
      const match = pattern.exec(passage.text)
      if (match) {
        gaps.push(line(passage, sentenceAt(passage.text, match.index)))
        break
      }
    }
  }
  return gaps
}

type VerdictFacts = Omit<OverviewObservations, 'verdict'>

/** One plain sentence: named how often, cited how often, and for what. */
function verdictLine(facts: VerdictFacts, passages: readonly AioPassage[]): string {
  const named = facts.mentions.length
  const cited = facts.ownSources.length
  if (named === 0 && cited === 0) {
    const top = facts.competitors[0]
    if (top === undefined) return 'Not named and not cited.'
    return `Not named and not cited — ${top.name} is ${competitorSummary(top)}.`
  }
  if (cited === 0) {
    return `Named ${times(named)} but not cited — Google names you without linking your site.`
  }
  const firstCited = passages.find((passage) =>
    facts.ownSources.some((source) => passage.refs.includes(source.index))
  )
  const best = Math.min(...facts.ownSources.map((source) => source.position))
  const rank = `${ordinal(best)} of ${facts.sourceCount} sources`
  if (named === 0) {
    return firstCited
      ? `Cited ${times(cited)} but never named — first cited for "${passageLabel(firstCited)}" (${rank}).`
      : `Cited ${times(cited)} but never named — listed ${rank}.`
  }
  const lead = firstCited
    ? `Named ${times(named)} and cited ${times(cited)} — cited for "${passageLabel(firstCited)}"`
    : `Named ${times(named)} and cited ${times(cited)} — listed ${rank}`
  const unlinked = facts.namedNotCited[0]
  if (unlinked !== undefined) {
    return `${lead}, but the mention under "${sectionName(unlinked.section, unlinked.sentence)}" has no link to you.`
  }
  const first = facts.mentions[0]
  if (first !== undefined && first.passageId !== firstCited?.id) {
    return `${lead}; named under "${sectionName(first.section, first.sentence)}".`
  }
  return `${lead}.`
}

function competitorSummary(line: CompetitorLine): string {
  if (line.named > 0 && line.cited > 0)
    return `named ${times(line.named)} and cited ${times(line.cited)}`
  if (line.named > 0) return `named ${times(line.named)}`
  return `cited ${times(line.cited)}`
}

/** "once", "twice", then figures: "3 times". */
export function times(count: number): string {
  if (count === 1) return 'once'
  if (count === 2) return 'twice'
  return `${count} times`
}

/** 1st, 2nd, 3rd, 4th, 11th, 21st. */
export function ordinal(value: number): string {
  const tens = value % 100
  if (tens >= 11 && tens <= 13) return `${value}th`
  switch (value % 10) {
    case 1:
      return `${value}st`
    case 2:
      return `${value}nd`
    case 3:
      return `${value}rd`
    default:
      return `${value}th`
  }
}

function sectionName(section: string | null, sentence: string): string {
  return section ?? passageLabel({ section: null, text: sentence })
}

function line(passage: AioPassage, sentence: string): PassageLine {
  return {
    passageId: passage.id,
    section: passage.section,
    label: passageLabel(passage),
    sentence
  }
}

function isOwnKind(kind: ObservedSourceKind | undefined): boolean {
  return kind === 'this_page' || kind === 'own'
}

function tiers(lens: OverviewLens): {
  direct: OverviewLens['competitors']
  partial: OverviewLens['competitors']
} {
  return {
    direct: lens.competitors.filter((item) => item.tier === 'direct'),
    partial: lens.competitors.filter((item) => item.tier === 'partial')
  }
}

function siteName(source: AioSource): string {
  return source.source ?? (cleanHost(hostOf(source.url)) || source.title || 'Source')
}

function hostOf(url: string | null): string {
  if (url === null) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function urlKey(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).href.replace(/\/+$/u, '')
  } catch {
    return url.replace(/\/+$/u, '')
  }
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}
