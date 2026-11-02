import { observeOverview, ordinal, type OverviewObservations } from '@shared/aio-observations'
import { overviewFromSample, type AioOverview } from '@shared/aio-overview'
import { overviewPassages } from '@shared/aio-passages'
import { competitorFor } from '@shared/competitor-hosts'
import type { OverviewLens, SampleCapture } from '@shared/domain'
import {
  checkOverviewRead,
  overviewReadReply,
  READ_ACTIONS_MAX,
  READ_COMPETITORS_MAX,
  type ReadFacts
} from '@shared/overview-read'
import { checkReportsRoot } from '../../engine/checks/report-files'
import { loadPromptDetail } from '../../engine/checks/results'
import { DATA_FENCE_RULE, fence, NO_CAUSE_RULE } from '../../prompts/blocks'
import { causeProblem } from '../../prompts/citations'
import { saveOverviewRead } from '../../storage/overview-reads'
import {
  AssistInputError,
  type AssistContext,
  type AssistDefinition,
  type AssistReply
} from '../types'
import {
  clip,
  inputText,
  marketIdOf,
  marketLabel,
  marketOf,
  pageOf,
  type OpenedPage
} from './gather'
import { replyTexts } from './results'

/**
 * "Analyse with Claude" in the prompt page's "What this overview says about you"
 * card. One single-purpose read of one stored overview sample: how it positions the
 * brand, its tone toward the brand, what earns the product's competitors their spots,
 * and 3 actions for the page. Code computes the observations first (the same ones the
 * card shows), checks every quote and name in the reply, and saves the checked read per
 * sample so the page shows it again without a new call.
 */

/** One overview sample with everything the read is checked against. */
interface OverviewSample {
  opened: OpenedPage
  marketId: string
  promptText: string
  sample: SampleCapture
  overview: AioOverview
  lens: OverviewLens
  observations: OverviewObservations
  facts: ReadFacts
}

function overviewSampleOf(context: AssistContext): OverviewSample {
  const opened = pageOf(context)
  const marketId = marketIdOf(context, opened.page)
  const detail = loadPromptDetail(opened.db, {
    projectId: opened.project.id,
    pageId: opened.page.id,
    marketId,
    runId: null,
    promptId: context.request.promptId ?? '',
    builtAt: context.host.now().toISOString(),
    domain: opened.project.domain,
    keyLabels: new Map(),
    reportsRoot: checkReportsRoot(context.host.storage.paths.root)
  })
  if (detail.row === null) {
    throw new AssistInputError(
      'This prompt has no result in the latest check.',
      'Press Check now, then try again.'
    )
  }
  const wanted = inputText(context, 'sampleId', 80)
  const sample =
    detail.samples.find((item) => item.id === wanted) ??
    (wanted === null ? detail.samples.find((item) => item.hasAio) : undefined)
  const overview = sample ? overviewFromSample(sample) : null
  if (sample === undefined || overview === null) {
    throw new AssistInputError(
      'This sample has no stored AI Overview to read.',
      'Pick a sample that shows an overview.'
    )
  }
  const lens = detail.lens
  const observations = observeOverview({ overview, lens, references: sample.references })
  return {
    opened,
    marketId,
    promptText: detail.row.text,
    sample,
    overview,
    lens,
    observations,
    facts: readFacts(overview, lens)
  }
}

function readFacts(overview: AioOverview, lens: OverviewLens): ReadFacts {
  const sourceNames = overview.sources.flatMap((source) => {
    const host = hostOf(source.url)
    return [source.source, host, source.url].filter((value): value is string => !!value)
  })
  return {
    overviewText: overviewPassages(overview)
      .map((passage) => passage.text)
      .join('\n'),
    brandNames: lens.brandNames,
    knownNames: [
      ...lens.competitors.flatMap((item) => (item.domain ? [item.name, item.domain] : [item.name])),
      ...sourceNames
    ],
    sourceNames
  }
}

/** The overview with `[n]` after each passage, n being the source's place in Google's list. */
function overviewWithMarkers(overview: AioOverview): string {
  const place = new Map(overview.sources.map((source, at) => [source.index, at + 1]))
  return overviewPassages(overview)
    .map((passage) => {
      const refs = passage.refs.flatMap((ref) => {
        const at = place.get(ref)
        return at === undefined ? [] : [at]
      })
      const text = passage.kind === 'heading' ? `## ${passage.text}` : passage.text
      return refs.length > 0 ? `${text} [${refs.join(', ')}]` : text
    })
    .join('\n')
}

function sourcesBlock(read: OverviewSample): string {
  const own = new Set(read.observations.ownSources.map((source) => source.index))
  const lists = {
    direct: read.lens.competitors.filter((item) => item.tier === 'direct'),
    partial: read.lens.competitors.filter((item) => item.tier === 'partial')
  }
  return read.overview.sources
    .map((source, at) => {
      const host = hostOf(source.url)
      const rival = host === null ? null : competitorFor(host, lists)
      const kind = own.has(source.index)
        ? 'own site'
        : rival
          ? `competitor: ${rival.name}, ${rival.tier ?? 'no tier'}`
          : 'other'
      const site = source.source ?? host ?? 'Source'
      return `${at + 1}. ${site} · ${host ?? 'no link'} · ${kind} · ${clip(source.title ?? '', 120)}`
    })
    .join('\n')
}

/** The card's observations as plain lines, so Claude starts from what code already counted. */
function observationLines(seen: OverviewObservations): string {
  const lines: string[] = [`Verdict: ${seen.verdict}`]
  lines.push(
    seen.mentions.length === 0
      ? 'The text never names the brand or the own site.'
      : `Named ${seen.mentions.length} time(s): ${seen.mentions
          .map(
            (mention) =>
              `under "${mention.section ?? 'the opening'}": "${clip(mention.sentence, 200)}"${mention.cited ? ' (that passage cites the own site)' : ' (no own citation)'}`
          )
          .join('; ')}`
  )
  lines.push(
    seen.ownSources.length === 0
      ? `No own page among the ${seen.sourceCount} sources.`
      : `Own pages cited: ${seen.ownSources
          .map(
            (source) =>
              `${source.url ?? source.name} (${ordinal(source.position)} of ${seen.sourceCount}${source.kind === 'this_page' ? ', this page' : ''})`
          )
          .join('; ')}`
  )
  for (const line of seen.citedNotNamed) {
    lines.push(`Cites the own site without naming it: "${clip(line.sentence, 200)}"`)
  }
  lines.push(
    seen.competitors.length === 0
      ? 'No competitor of this product is named or cited.'
      : `Competitors: ${seen.competitors
          .map((line) => `${line.name} named ${line.named}, cited ${line.cited}`)
          .join('; ')}`
  )
  for (const gap of seen.gaps) {
    lines.push(
      `Google showed a name here that the search data left out: "${clip(gap.sentence, 200)}"`
    )
  }
  return lines.map((line) => `- ${line}`).join('\n')
}

function competitorsLine(lens: OverviewLens): string {
  if (lens.competitors.length === 0) return 'None saved.'
  return lens.competitors
    .map((item) => {
      const domain =
        item.domain && item.domain !== item.name.toLowerCase() ? ` (${item.domain})` : ''
      return `${item.name}${domain}, ${item.tier}`
    })
    .join('; ')
}

export const OVERVIEW_READ_ASSIST: AssistDefinition = {
  id: 'results.overviewRead',
  title: 'What this overview says about you',
  expectedSeconds: 12,
  acceptsInstruction: true,
  needsProject: true,
  needs: ['pageId', 'promptId'],
  minItems: 2,
  maxItems: 1 + READ_COMPETITORS_MAX + READ_ACTIONS_MAX + 2,
  task: `Read the AI Overview under "Overview" for the brand under "Brand". Say how it positions the brand, its tone toward the brand, what earns the competitors their spots, and the 3 most useful changes for the page.
- Start from "Observed in code": those counts are right; do not recount them.
- Quote only text that is in the overview, exactly as written (you may drop the [n] markers).
- ${DATA_FENCE_RULE}
- ${NO_CAUSE_RULE}
Reply in the shared shape with these fixed tags:
- summary: how the overview positions the brand, in 1 or 2 sentences (for example "one middleware option, after the API routes"). When the brand is absent, say who holds the space instead.
- One item tagged "tone": text is positive, neutral, negative or absent. detail quotes the sentence that names the brand; null when absent.
- Up to ${READ_COMPETITORS_MAX} items tagged "competitor: <name>", the name copied from "Competitors of this product" or from a source's site name: text says what earns it its place (which passage or source, and what it offers there). detail quotes that passage.
- Exactly ${READ_ACTIONS_MAX} items tagged "action", most useful first: text is one concrete change to the page (which section to add or rewrite, and what it must say). detail quotes the overview passage it answers, or names the source (its domain) it must beat.
- caution: "Confidence: high", "Confidence: medium" or "Confidence: low", then one short reason (one sample, a missing name in the data, few sources).`,
  gather(context) {
    const read = overviewSampleOf(context)
    const lens = read.lens
    return [
      `Brand: ${lens.brandNames.join(', ') || 'not set'}`,
      `Own site: ${lens.ownDomain}${lens.includeSubdomains ? ' and its subdomains' : ''}`,
      `Product this prompt belongs to: ${lens.productName ?? 'the whole business'}`,
      `Competitors of this product: ${competitorsLine(lens)}`,
      `Market: ${marketLabel(marketOf(read.opened.db, read.marketId))}`,
      `Prompt: ${read.promptText}`,
      `Sample: ${read.sample.sampleNo}`,
      '',
      'Sources, in Google’s order (n. site · domain · own site, competitor or other · title):',
      sourcesBlock(read),
      '',
      'Overview ([n] after a passage names the sources Google showed for it; ## is a heading):',
      fence('overview', overviewWithMarkers(read.overview)),
      '',
      'Observed in code:',
      observationLines(read.observations)
    ].join('\n')
  },
  check(reply, context) {
    const read = overviewSampleOf(context)
    const checked = checkOverviewRead(reply, read.facts)
    if ('problem' in checked) return checked.problem
    return causeProblem(replyTexts(reply))
  },
  finish(reply, context) {
    const read = overviewSampleOf(context)
    const checked = checkOverviewRead(reply, read.facts)
    if ('problem' in checked) return reply
    saveOverviewRead(read.opened.db, {
      sampleId: read.sample.id,
      ranAt: context.host.now().toISOString(),
      read: checked.read
    })
    const shaped = overviewReadReply(checked.read)
    const finished: AssistReply = {
      summary: shaped.summary,
      caution: shaped.caution,
      items: shaped.items.map((item) => ({ ...item, verify: null, sign: null }))
    }
    return finished
  }
}

export const OVERVIEW_READ_ASSISTS: readonly AssistDefinition[] = [OVERVIEW_READ_ASSIST]

function hostOf(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return null
  }
}
