import { referenceDomain, referenceWho } from './competition'
import type { DrillRegistry } from './drills'
import type {
  ContentGapsSection,
  RecommendationEvidence,
  RecommendationKind,
  RecommendationModel,
  ReportPage,
  ReportReference,
  ReportRow
} from './types'

/**
 * "What to do next" (Docs/REPORT-SPEC.md): at most three recommendations, each a
 * "Do this" line, a "Why" line and the questions that prove it. Derived only from data
 * the report already holds (competitor gaps, wrong page cited, content gaps, answers
 * without you), so no evidence means no recommendation. Fixed wording, no AI.
 */

export const NEXT_STEPS_TITLE = 'What to do next'
export const NEXT_STEPS_LEDE =
  'At most three changes, each with the questions that show why. Built from the checks in this report, not from AI.'

export const MAX_RECOMMENDATIONS = 3
/** Questions shown in a recommendation's evidence table; the drill opens all of them. */
export const EVIDENCE_ROWS = 5

/** Earlier kinds win a tie on the number of questions. */
const KIND_ORDER: readonly RecommendationKind[] = [
  'competitor_gap',
  'wrong_page',
  'content_gap',
  'not_visible'
]

export interface RecommendationInput {
  rows: readonly ReportRow[]
  references: readonly ReportReference[]
  pages: readonly ReportPage[]
  contentGaps: ContentGapsSection
  ownDomain: string
  /** Topic subjects: named by title, since a topic has no single page. */
  topicPageIds: ReadonlySet<string>
  drills: DrillRegistry
}

interface Candidate {
  kind: RecommendationKind
  token: string
  rows: readonly ReportRow[]
  doThis: string
  why: string
  /** The competitor this evidence is about, preferred in the evidence columns. */
  competitor: string | null
}

export function buildRecommendations(input: RecommendationInput): RecommendationModel[] {
  const refsByRow = new Map<string, ReportReference[]>()
  for (const reference of input.references) {
    const list = refsByRow.get(reference.rowId)
    if (list === undefined) refsByRow.set(reference.rowId, [reference])
    else list.push(reference)
  }
  for (const list of refsByRow.values()) list.sort((a, b) => a.position - b.position)
  const refsOf = (row: ReportRow): readonly ReportReference[] => refsByRow.get(row.id) ?? []
  const domainOf = (reference: ReportReference): string =>
    referenceDomain(reference, input.ownDomain)
  const competitorsOf = (row: ReportRow): string[] => [
    ...new Set(
      refsOf(row)
        .filter((reference) => reference.classification === 'competitor')
        .map(domainOf)
    )
  ]
  const where = (rows: readonly ReportRow[]): string => targetText(rows, input)

  const candidates: Candidate[] = []
  const notCited = input.rows.filter((row) => row.aio && !row.cited)

  // 1. A competitor is cited where you are not.
  const byCompetitor = new Map<string, ReportRow[]>()
  for (const row of notCited) {
    for (const domain of competitorsOf(row)) {
      const list = byCompetitor.get(domain)
      if (list === undefined) byCompetitor.set(domain, [row])
      else list.push(row)
    }
  }
  const top = [...byCompetitor.entries()].sort(
    ([leftDomain, left], [rightDomain, right]) =>
      right.length - left.length || leftDomain.localeCompare(rightDomain)
  )[0]
  if (top !== undefined) {
    const [domain, rows] = top
    candidates.push({
      kind: 'competitor_gap',
      token: `next:competitor=${domain}`,
      rows,
      doThis: `Answer these questions directly ${where(rows)}, so Google can cite you where it now cites ${domain}.`,
      why: `${domain} is cited in ${rows.length} AI ${rows.length === 1 ? 'Overview that does' : 'Overviews that do'} not cite you.`,
      competitor: domain
    })
  }

  // 2. Google cites another of your pages instead of the tracked one.
  const wrong = input.rows.filter((row) => row.wrongPage)
  if (wrong.length > 0) {
    const pages = new Set(wrong.map((row) => row.pageId))
    const single = pages.size === 1 ? pageText(wrong[0]?.pageId ?? '', input) : null
    candidates.push({
      kind: 'wrong_page',
      token: 'next:wrongpage',
      rows: wrong,
      doThis:
        single === null
          ? 'Make each question’s tracked page the clearest answer, and link to it from the page Google cites now.'
          : `Make ${single} the clearest answer to these questions, and link to it from the page Google cites now.`,
      why: `Google cites another of your pages instead of the tracked one in ${wrong.length} AI ${wrong.length === 1 ? 'Overview' : 'Overviews'}.`,
      competitor: null
    })
  }

  // 3. The page covers these buyer questions weakly or not at all (page scope only).
  const weakIds = new Set(
    input.contentGaps.matrix
      .filter(
        (item) => item.rowId !== null && (item.coverage === 'weak' || item.coverage === 'none')
      )
      .map((item) => item.rowId as string)
  )
  const weak = input.rows.filter((row) => weakIds.has(row.id))
  if (weak.length > 0) {
    const hasDrafts = input.contentGaps.oneByOne.some((item) => item.faq !== null)
    candidates.push({
      kind: 'content_gap',
      token: 'next:content',
      rows: weak,
      doThis: `Add the missing answers to ${pageText(weak[0]?.pageId ?? '', input)}${hasDrafts ? ', starting from the FAQ drafts in Content gaps' : ''}.`,
      why: `The page covers ${weak.length} of these buyer ${weak.length === 1 ? 'question' : 'questions'} weakly or not at all.`,
      competitor: null
    })
  }

  // 4. Google answers without you or any competitor.
  const open = input.rows.filter((row) => row.notVisible && competitorsOf(row).length === 0)
  if (open.length > 0) {
    const leader = mostCitedOther(open, refsOf, domainOf)
    candidates.push({
      kind: 'not_visible',
      token: 'next:invisible',
      rows: open,
      doThis: `Add a short, direct answer to these questions ${where(open)}; Google answers them now from other sites.`,
      why: `Google shows an AI Overview for ${open.length} ${open.length === 1 ? 'question' : 'questions'} without citing or naming you or a competitor${leader === null ? '' : `; it cites ${leader} most`}.`,
      competitor: null
    })
  }

  return candidates
    .sort(
      (left, right) =>
        right.rows.length - left.rows.length ||
        KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
    )
    .slice(0, MAX_RECOMMENDATIONS)
    .map((candidate) => ({
      kind: candidate.kind,
      doThis: candidate.doThis,
      why: candidate.why,
      questions: input.drills.count(
        candidate.token,
        candidate.rows.map((row) => row.id)
      ),
      evidence: candidate.rows
        .slice(0, EVIDENCE_ROWS)
        .map((row) => evidenceRow(row, candidate, refsOf(row), domainOf, input))
    }))
}

function evidenceRow(
  row: ReportRow,
  candidate: Candidate,
  refs: readonly ReportReference[],
  domainOf: (reference: ReportReference) => string,
  input: RecommendationInput
): RecommendationEvidence {
  const others = refs.filter((reference) => referenceWho(reference) !== 'you')
  const rivals = others.filter((reference) => reference.classification === 'competitor')
  const rival =
    rivals.find((reference) => domainOf(reference) === candidate.competitor) ?? rivals[0] ?? null
  // The page Google cited instead: your other page for a wrong-page question, else the
  // competitor's page, else the first other page cited.
  const cited =
    candidate.kind === 'wrong_page'
      ? { url: row.citedUrl, title: null }
      : (rival ?? others[0] ?? null)
  return {
    rowId: row.id,
    question: row.text,
    pagePath: pageLabel(row.pageId, input),
    marketId: row.marketId,
    competitor: rival === null ? null : domainOf(rival),
    citedUrl: cited?.url ?? null,
    citedTitle: cited?.title ?? null
  }
}

function mostCitedOther(
  rows: readonly ReportRow[],
  refsOf: (row: ReportRow) => readonly ReportReference[],
  domainOf: (reference: ReportReference) => string
): string | null {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const domains = new Set(
      refsOf(row)
        .filter((reference) => referenceWho(reference) !== 'you')
        .map(domainOf)
    )
    for (const domain of domains) counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort(
    ([leftDomain, left], [rightDomain, right]) =>
      right - left || leftDomain.localeCompare(rightDomain)
  )[0]
  // One question is not a pattern: name a site only when it leads on two or more.
  return best !== undefined && best[1] >= 2 ? best[0] : null
}

/** "on /pricing", "on your page for Text alerts", or "on each question's tracked page". */
function targetText(rows: readonly ReportRow[], input: RecommendationInput): string {
  const pages = new Set(rows.map((row) => row.pageId))
  if (pages.size !== 1) return 'on each question’s tracked page'
  return `on ${pageText(rows[0]?.pageId ?? '', input)}`
}

/** The page column: the path, or the topic's title. */
function pageLabel(pageId: string, input: RecommendationInput): string {
  const page = input.pages.find((item) => item.id === pageId)
  if (page === undefined) return ''
  return input.topicPageIds.has(pageId) ? (page.title ?? 'Topic') : page.path
}

function pageText(pageId: string, input: RecommendationInput): string {
  const page = input.pages.find((item) => item.id === pageId)
  if (page === undefined) return 'the tracked page'
  if (input.topicPageIds.has(pageId)) return `your page for ${page.title ?? 'this topic'}`
  return page.path
}
