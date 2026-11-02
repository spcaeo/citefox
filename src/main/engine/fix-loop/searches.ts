import type { PageSummary, TopicResultRow } from '@shared/domain'
import type { FixSearch, ProjectSearches } from '@shared/page-fixes'
import { citedInstead, citedOwn, deriveRowState, winOdds } from '@shared/topic-scoring'
import type { SqliteDatabase } from '../../storage/database'
import { listPages } from '../../storage/pages'
import type { ProjectRecord } from '../../storage/records'
import { loadTopicResults, TopicNotFoundError } from '../../topics/results'
import { enabledPromptCounts } from '../allpages/rows'
import { normalizeUrl } from '../checks/url'
import { buildTimeline, isWorkingPage, readLineage } from '../overview/timeline'

/**
 * `fixes:searches`: every search of the project's working topics and tracked pages in
 * its default market, read the way their own screens read them (a topic's current
 * outcome per question, a page's latest full check). A tracked page's own URL is the
 * target of its questions. Reads stored checks only: no search, no Claude.
 */
export function loadProjectSearches(
  db: SqliteDatabase,
  project: ProjectRecord,
  builtAt: string
): ProjectSearches {
  const sources: ProjectSearches['sources'][number][] = []
  const searches: FixSearch[] = []
  const enabled = enabledPromptCounts(db)
  const lineage = readLineage(db)
  for (const page of listPages(db, project.id)) {
    const prompts = enabled.get(page.id) ?? 0
    if (!isWorkingPage(page) || prompts === 0) continue
    const found =
      page.kind === 'topic'
        ? topicSearches(db, project, page, builtAt)
        : pageSearches(db, project, { page, prompts, builtAt, lineage })
    if (found.length === 0) continue
    sources.push({
      id: page.id,
      kind: page.kind === 'topic' ? 'topic' : 'page',
      name: nameOf(page)
    })
    searches.push(...found)
  }
  return { projectId: project.id, domain: project.domain, builtAt, sources, searches }
}

/** The page's one name, as its screen's title shows it: title, then label, then path. */
function nameOf(page: PageSummary): string {
  if (page.title) return page.title
  if (page.label) return page.label
  if (page.url === null) return 'Untitled'
  try {
    return new URL(page.url).pathname || '/'
  } catch {
    return page.url
  }
}

function topicSearches(
  db: SqliteDatabase,
  project: ProjectRecord,
  page: PageSummary,
  builtAt: string
): FixSearch[] {
  let results: ReturnType<typeof loadTopicResults>
  try {
    results = loadTopicResults(db, {
      projectId: project.id,
      topicId: page.id,
      marketId: null,
      runId: null,
      domain: project.domain,
      builtAt
    })
  } catch (cause) {
    // A topic with no market yet has nothing to read.
    if (cause instanceof TopicNotFoundError) return []
    throw cause
  }
  const name = results.topic.name
  return results.rows.map((row) => fromTopicRow(page.id, name, results.topic.marketId, row))
}

function fromTopicRow(
  topicId: string,
  name: string,
  marketId: string,
  row: TopicResultRow
): FixSearch {
  return {
    id: `${topicId}|${row.promptId}`,
    sourceKind: 'topic',
    sourceId: topicId,
    sourceName: name,
    promptId: row.promptId,
    marketId,
    runId: row.runId,
    label: `${row.kind === 'keyword' ? 'K' : 'Q'}${row.number}`,
    kind: row.kind,
    text: row.text,
    state: row.state,
    targetPageId: row.targetPageId,
    targetUrl: row.targetUrl,
    citedOwnUrl: row.citedOwnUrl,
    citedInstead: row.citedInstead,
    winOdds: row.winOdds,
    checkedAt: row.checkedAt
  }
}

function pageSearches(
  db: SqliteDatabase,
  project: ProjectRecord,
  input: {
    page: PageSummary
    prompts: number
    builtAt: string
    lineage: ReadonlyMap<string, string>
  }
): FixSearch[] {
  const { page, builtAt } = input
  if (page.url === null) return []
  const timeline = buildTimeline(db, {
    projectId: project.id,
    page,
    marketId: null,
    enabledPrompts: input.prompts,
    lineage: input.lineage
  })
  const state = timeline?.stateAt(builtAt) ?? null
  if (state === null) return []
  const target = normalizeUrl(page.url)
  const name = nameOf(page)
  const out: FixSearch[] = []
  for (const item of state.values()) {
    const { row } = item
    const references = row.references.map((ref) => ({
      url: ref.url,
      normalizedUrl: ref.normalizedUrl,
      domain: ref.domain,
      position: ref.position,
      classification: ref.classification
    }))
    const rowState = deriveRowState({ status: row.status, references }, target)
    out.push({
      id: `${page.id}|${item.promptId}`,
      sourceKind: 'page',
      sourceId: page.id,
      sourceName: name,
      promptId: item.promptId,
      marketId: item.marketId,
      runId: item.runId,
      label: row.label,
      kind: 'question',
      text: item.text,
      state: rowState,
      targetPageId: page.id,
      targetUrl: page.url,
      citedOwnUrl: citedOwn(references, target)?.url ?? null,
      citedInstead: citedInstead(references),
      winOdds: winOdds({
        state: rowState,
        hasTarget: true,
        matchConfidence: null,
        targetConfirmed: true,
        references,
        named: row.named
      }),
      checkedAt: item.checkedAt
    })
  }
  return out
}
