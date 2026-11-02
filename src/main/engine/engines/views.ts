import {
  CLORO_CREDITS,
  ENGINE_IDS,
  ENGINE_LABEL,
  type EngineAnswerStatus,
  type EngineId,
  type PageSummary
} from '@shared/domain'
import type {
  EngineAnswerView,
  EngineCounts,
  PageEnginesView,
  ProjectEnginesView,
  QuestionEngineStatuses,
  QuestionEnginesView
} from '@shared/ipc'
import type { SqliteDatabase } from '../../storage/database'
import {
  listEngineStatusRows,
  latestAnswerSamples,
  latestGoogleSamples,
  type EngineScope,
  type EngineStatusRow,
  type LatestSample,
  type LatestSource
} from '../../storage/engine-reads'
import { listPageEngines, readEngineSettings, readPageEngines } from '../../storage/engine-records'
import { listPageMarkets } from '../../storage/pages'
import { engineStatusOfSample } from '../checks/answer-step'
import { selectedEngines } from '../checks/engines-plan'
import type { EngineAccess } from './access'

/** Most sources one engine answer carries to the screen. */
const SOURCES_SHOWN = 20

export function projectEnginesView(
  db: SqliteDatabase,
  projectId: string,
  access: EngineAccess
): ProjectEnginesView {
  const settings = readEngineSettings(db)
  return {
    projectId,
    engines: settings.engines,
    provider: settings.provider,
    activeProvider: access.providerFor(null),
    cloroReady: access.cloroReady,
    serpapiReady: access.serpapiReady,
    options: ENGINE_IDS.map((engine) => ({
      id: engine,
      label: ENGINE_LABEL[engine],
      credits: CLORO_CREDITS[engine],
      needsCloro: engine !== 'google_aio',
      runnable: engine === 'google_aio' || access.cloroReady
    })),
    overrides: listPageEngines(db).size,
    updatedAt: settings.updatedAt
  }
}

export function pageEnginesView(
  db: SqliteDatabase,
  projectId: string,
  page: PageSummary
): PageEnginesView {
  return {
    projectId,
    pageId: page.id,
    kind: page.kind === 'topic' ? 'topic' : 'page',
    engines: selectedEngines(db, page.id),
    own: readPageEngines(db, page.id),
    projectEngines: readEngineSettings(db).engines
  }
}

/**
 * Several samples of one question on one engine as one status: the best outcome wins,
 * so a question cited in any sample counts as cited (as the Google views do).
 */
const STATUS_ORDER: readonly EngineAnswerStatus[] = [
  'cited',
  'named',
  'not_cited',
  'no_answer',
  'unavailable',
  'error'
]

export function rollUpStatus(statuses: readonly EngineAnswerStatus[]): EngineAnswerStatus | null {
  let best: EngineAnswerStatus | null = null
  for (const status of statuses) {
    if (best === null || STATUS_ORDER.indexOf(status) < STATUS_ORDER.indexOf(best)) best = status
  }
  return best
}

function sampleStatus(sample: Pick<LatestSample, 'googleStatus' | 'status'>): EngineAnswerStatus {
  if (sample.status !== null) return sample.status
  return sample.googleStatus === null ? 'error' : engineStatusOfSample(sample.googleStatus)
}

/** The market a question view opens on: the one asked for, else the page's default. */
export function questionMarket(
  db: SqliteDatabase,
  page: PageSummary,
  marketId: string | null
): string | null {
  if (marketId !== null) return marketId
  return page.defaultMarketId ?? listPageMarkets(db, page.id)[0]?.marketId ?? null
}

export function questionEnginesView(
  db: SqliteDatabase,
  projectId: string,
  page: PageSummary,
  promptId: string,
  marketId: string | null
): QuestionEnginesView {
  const selected = new Set(selectedEngines(db, page.id))
  const byEngine = new Map<EngineId, { samples: LatestSample[]; sources: LatestSource[] }>()
  if (marketId !== null) {
    const google = latestGoogleSamples(db, page.id, marketId, promptId)
    if (google.samples.length > 0) byEngine.set('google_aio', google)
    const answers = latestAnswerSamples(db, page.id, marketId, promptId)
    for (const sample of answers.samples) {
      const entry = byEngine.get(sample.engine) ?? { samples: [], sources: answers.sources }
      entry.samples.push(sample)
      byEngine.set(sample.engine, entry)
    }
  }
  return {
    projectId,
    pageId: page.id,
    promptId,
    marketId,
    engines: ENGINE_IDS.map((engine) =>
      answerView(engine, selected.has(engine), byEngine.get(engine))
    )
  }
}

function answerView(
  engine: EngineId,
  selected: boolean,
  found: { samples: LatestSample[]; sources: LatestSource[] } | undefined
): EngineAnswerView {
  const samples = found?.samples ?? []
  const status = rollUpStatus(samples.map(sampleStatus))
  // The sample shown is the first with the rolled-up status, so "cited" shows the citing answer.
  const shown = samples.find((sample) => sampleStatus(sample) === status) ?? samples[0]
  if (shown === undefined) {
    return {
      engine,
      label: ENGINE_LABEL[engine],
      selected,
      status: null,
      checkedAt: null,
      cited: false,
      named: false,
      citedUrl: null,
      position: null,
      text: null,
      markdown: null,
      sources: [],
      message: null,
      provider: null,
      credits: 0,
      costMicros: 0
    }
  }
  return {
    engine,
    label: ENGINE_LABEL[engine],
    selected,
    status,
    checkedAt: shown.checkedAt,
    cited: status === 'cited',
    named: status === 'named' || samples.some((sample) => sample.named),
    citedUrl: status === 'cited' ? shown.citedUrl : null,
    position: status === 'cited' ? shown.position : null,
    text: shown.text,
    markdown: shown.markdown,
    sources: (found?.sources ?? [])
      .filter((source) => source.sampleId === shown.id)
      .slice(0, SOURCES_SHOWN)
      .map((source) => ({
        position: source.position,
        url: source.url,
        domain: source.domain,
        title: source.title,
        classification: source.classification
      })),
    message: shown.message,
    provider: shown.provider,
    credits: samples.reduce((sum, sample) => sum + sample.credits, 0),
    costMicros: samples.reduce((sum, sample) => sum + sample.costMicros, 0)
  }
}

interface Group {
  engine: EngineId
  pageId: string
  marketId: string
  promptId: string
  latest: EngineAnswerStatus[]
  previous: EngineAnswerStatus[]
  checkedAt: string
  /** Own pages among the latest check's sources (answer engines). */
  ownUrls: Set<string>
}

/** Latest status of every question × market per engine, and whether it moved. */
export function engineSummary(
  db: SqliteDatabase,
  scope: EngineScope,
  perQuestion: boolean
): { engines: EngineId[]; counts: EngineCounts[]; questions?: QuestionEngineStatuses[] } {
  const groups = groupRows(listEngineStatusRows(db, scope))
  const projectEngines = readEngineSettings(db).engines
  const seen = new Set<EngineId>(projectEngines)
  for (const group of groups.values()) seen.add(group.engine)
  const counts = new Map<EngineId, EngineCounts>(
    ENGINE_IDS.filter((engine) => seen.has(engine)).map((engine) => [engine, emptyCounts(engine)])
  )
  const questions = new Map<string, QuestionEngineStatuses>()
  for (const group of groups.values()) {
    const latest = rollUpStatus(group.latest)
    if (latest === null) continue
    const count = counts.get(group.engine)
    if (count === undefined) continue
    const previous = rollUpStatus(group.previous)
    count.checked += 1
    if (latest === 'cited') count.cited += 1
    else if (latest === 'named') count.named += 1
    else if (latest === 'not_cited') count.notCited += 1
    else if (latest === 'no_answer') count.noAnswer += 1
    else if (latest === 'unavailable') count.unavailable += 1
    else count.error += 1
    if (previous !== null && latest === 'cited' && previous !== 'cited') count.gained += 1
    if (previous === 'cited' && latest !== 'cited') count.lost += 1
    if (count.lastCheckedAt === null || group.checkedAt > count.lastCheckedAt) {
      count.lastCheckedAt = group.checkedAt
    }
    if (perQuestion) {
      const key = `${group.pageId}\u0000${group.marketId}\u0000${group.promptId}`
      const row = questions.get(key) ?? {
        pageId: group.pageId,
        promptId: group.promptId,
        marketId: group.marketId,
        statuses: {}
      }
      row.statuses[group.engine] = latest
      // A cited answer names the own pages it cites, so a screen can tell the target page.
      if (latest === 'cited' && group.ownUrls.size > 0) {
        row.ownUrls = { ...row.ownUrls, [group.engine]: [...group.ownUrls] }
      }
      const move =
        previous !== null && latest === 'cited' && previous !== 'cited'
          ? 'gained'
          : previous === 'cited' && latest !== 'cited'
            ? 'lost'
            : null
      if (move !== null) row.moved = { ...row.moved, [group.engine]: move }
      questions.set(key, row)
    }
  }
  return {
    engines: projectEngines,
    counts: [...counts.values()],
    ...(perQuestion ? { questions: [...questions.values()] } : {})
  }
}

function groupRows(rows: readonly EngineStatusRow[]): Map<string, Group> {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const key = `${row.engine}\u0000${row.pageId}\u0000${row.marketId}\u0000${row.promptId}`
    const group = groups.get(key) ?? {
      engine: row.engine,
      pageId: row.pageId,
      marketId: row.marketId,
      promptId: row.promptId,
      latest: [],
      previous: [],
      checkedAt: '',
      ownUrls: new Set<string>()
    }
    const status = sampleStatus(row)
    if (row.rank === 1) {
      group.latest.push(status)
      for (const url of row.ownUrls) group.ownUrls.add(url)
      if (row.checkedAt > group.checkedAt) group.checkedAt = row.checkedAt
    } else {
      group.previous.push(status)
    }
    groups.set(key, group)
  }
  return groups
}

function emptyCounts(engine: EngineId): EngineCounts {
  return {
    engine,
    label: ENGINE_LABEL[engine],
    checked: 0,
    cited: 0,
    named: 0,
    notCited: 0,
    noAnswer: 0,
    unavailable: 0,
    error: 0,
    gained: 0,
    lost: 0,
    lastCheckedAt: null
  }
}
