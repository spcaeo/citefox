import type { IntentStage, Market, PageSummary, TopicDraftPrompt, TopicStage } from '@shared/domain'
import { TOPIC_STAGES } from '@shared/domain'
import type { ImportCommitRequest, ImportRowCheck, NewQuestion } from '@shared/ipc'
import { foldWord } from '@shared/import-fields'
import { pageMarkets } from '../engine/page-access'
import { appendQuestions } from '../engine/prompt-add'
import { pageKey, type EngineHost } from '../engine/host'
import type { SqliteDatabase } from '../storage/database'
import { addPageMarket, getPage, getPageByUrl } from '../storage/pages'
import { readProductCatalog, replaceProductCatalog } from '../storage/products'
import { insertMarket } from '../storage/project-profile'
import type { ProjectRecord } from '../storage/records'
import { createDraft, newDraftPrompt, saveDraft } from '../topics/drafts'
import { holdIntervalCheck, writeTopic } from '../topics/start'
import { checkListRows, marketOf } from './check-lists'
import { checkQuestionRows, questionText } from './check-questions'
import type { ImportDestination, ProjectFacts } from './context'
import type { BatchItem } from './store'
import { checkPageUrl } from './values'

/**
 * Writes the rows of an import that still check as new (or that the user kept next
 * to a similar one). The checks run again here, so a row that became a duplicate
 * since the preview is skipped with its reason. Every write is listed as a batch
 * item for Undo. Nothing is searched.
 */

export interface CommitOutcome {
  items: BatchItem[]
  added: number
  skipped: { index: number; reason: string }[]
  promptIds: { sourceId: string; promptIds: string[] }[]
}

interface Opened {
  project: ProjectRecord
  db: SqliteDatabase
}

/** A topic question's stage as a page prompt's intent stage (the reverse of questions/reads). */
const STAGE_TO_INTENT: Readonly<Record<TopicStage, IntentStage>> = {
  problem: 'problem',
  options: 'solution',
  doubts: 'objection',
  fit: 'solution',
  compare: 'comparison',
  decide: 'trigger'
}

function stageOf(value: string | undefined): TopicStage | null {
  return value !== undefined && (TOPIC_STAGES as readonly string[]).includes(value)
    ? (value as TopicStage)
    : null
}

function adds(check: ImportRowCheck): boolean {
  return check.result === 'new' || check.result === 'keyword'
}

/**
 * The product a competitor row names in "Competes with" (folded, so case and
 * punctuation do not matter). Blank or unknown: null, the whole business.
 */
export function productIdNamed(
  products: readonly { id: string; name: string }[],
  name: string | undefined
): string | null {
  const key = foldWord(name ?? '')
  if (key.length === 0) return null
  return products.find((product) => foldWord(product.name) === key)?.id ?? null
}

function skipReason(check: ImportRowCheck): string {
  if (check.result === 'similar')
    return check.reason ?? 'Similar to a tracked question: keep both or use the tracked one.'
  return check.reason ?? 'Skipped.'
}

export function commitQuestions(
  host: EngineHost,
  opened: Opened,
  request: ImportCommitRequest,
  facts: ProjectFacts,
  target: ImportDestination | null
): CommitOutcome {
  const { db, project } = opened
  const entity = request.entity
  const checks = checkQuestionRows({
    rows: request.rows.map((row) => ({ values: row.values, keep: row.keep })),
    facts,
    target,
    entity,
    rules: request.rules
  })
  const outcome: CommitOutcome = { items: [], added: 0, skipped: [], promptIds: [] }
  const existing = new Map<
    string,
    { page: PageSummary; rows: number[]; questions: NewQuestion[]; addMarkets: Set<string> }
  >()
  const fresh = new Map<
    string,
    {
      name: string
      rows: number[]
      prompts: TopicDraftPrompt[]
      /** Markets the rows name (W3I-C1). */
      markets: Set<string>
      /** True when a row names no market: it is checked in the usual markets too. */
      unscoped: boolean
    }
  >()
  const projectMarkets = new Set(facts.markets.map((market) => market.id))
  checks.forEach((check, index) => {
    const row = request.rows[index]
    if (row === undefined) return
    if (!adds(check)) {
      outcome.skipped.push({ index, reason: skipReason(check) })
      return
    }
    const values = row.values
    const text = questionText(values)
    const topicCell = entity === 'questions' ? (values.topic ?? '').trim() : ''
    const named =
      topicCell.length > 0 ? (facts.topicsByName.get(foldWord(topicCell)) ?? null) : null
    const stage = stageOf(values.stage)
    const pageCell = (values.page ?? '').trim()
    const checkedPage =
      pageCell.length === 0 ? null : checkPageUrl(pageCell, facts.domain, facts.includeSubdomains)
    const targetUrl = checkedPage !== null && checkedPage.ok ? checkedPage.url : null
    const targetPage = targetUrl === null ? null : getPageByUrl(db, targetUrl, project.id)
    const note = (values.tags ?? '').trim().slice(0, 200) || null
    const kind = check.kind ?? 'question'
    const marketCell = (values.market ?? '').trim()
    const market = projectMarkets.has(marketCell) ? marketCell : null
    if (topicCell.length > 0 && named === null) {
      // "Create it": a new topic named in the Topic column.
      const key = foldWord(topicCell)
      const group = fresh.get(key) ?? {
        name: topicCell.slice(0, 120),
        rows: [],
        prompts: [],
        markets: new Set<string>(),
        unscoped: false
      }
      if (market !== null) group.markets.add(market)
      else group.unscoped = true
      const prompt = newDraftPrompt(
        { kind, text, stage, source: 'imported', sourceNote: note },
        `tp-${host.createId()}`,
        facts.brands
      )
      group.prompts.push(
        targetUrl === null
          ? prompt
          : {
              ...prompt,
              targetPageId:
                targetPage !== null && targetPage.kind !== 'topic' ? targetPage.id : null,
              targetUrl,
              matchStatus: 'confirmed',
              matchReason: 'Set when the question was imported.'
            }
      )
      group.rows.push(index)
      fresh.set(key, group)
      return
    }
    const destinationId = named?.id ?? target?.id ?? null
    const page = destinationId === null ? null : getPage(db, destinationId, project.id)
    if (page === null) {
      outcome.skipped.push({ index, reason: 'Pick a topic or page for this row first.' })
      return
    }
    const topic = page.kind === 'topic'
    const question: NewQuestion = {
      text,
      intentStage: !topic && stage !== null ? STAGE_TO_INTENT[stage] : 'unset',
      source: 'written_by_user',
      ...(topic
        ? {
            topic: {
              kind,
              stage,
              origin: 'imported' as const,
              note,
              targetPageId:
                targetPage !== null && targetPage.kind !== 'topic' ? targetPage.id : null,
              targetUrl
            }
          }
        : {})
    }
    const group = existing.get(page.id) ?? { page, rows: [], questions: [], addMarkets: new Set() }
    group.rows.push(index)
    group.questions.push(question)
    if (market !== null && values.addMarket === '1') group.addMarkets.add(market)
    existing.set(page.id, group)
  })

  for (const group of existing.values()) {
    const noun = group.page.kind === 'topic' ? 'topic' : 'page'
    const blocked =
      group.page.status !== 'tracked' && group.page.status !== 'paused'
        ? `That ${noun} is not tracked, so it cannot take questions.`
        : host.memory.drafts.has(pageKey(project.id, group.page.id))
          ? `This ${noun} has unsaved prompt edits on its Prompts tab. Save or discard them there first.`
          : null
    if (blocked !== null) {
      for (const index of group.rows) outcome.skipped.push({ index, reason: blocked })
      continue
    }
    try {
      const written = appendQuestions(
        host,
        db,
        project.id,
        group.page,
        group.questions,
        'import:commit'
      )
      outcome.promptIds.push({ sourceId: group.page.id, promptIds: written.promptIds })
      for (const promptId of written.promptIds) {
        outcome.items.push({ kind: 'prompt', sourceId: group.page.id, promptId })
      }
      outcome.added += written.promptIds.length
      outcome.items.push(...addRowMarkets(host, db, group.page.id, group.addMarkets))
    } catch (error) {
      host.logger.warn('import rows were not added', {
        rows: group.rows.length,
        threw: error instanceof Error ? error.name : typeof error
      })
      const reason = error instanceof Error ? error.message : 'Could not add these rows.'
      for (const index of group.rows) outcome.skipped.push({ index, reason })
    }
  }

  for (const group of fresh.values()) {
    try {
      const topicId = createImportedTopic(host, opened, group.name, group.prompts, target, group)
      outcome.items.push({ kind: 'topic', topicId })
      outcome.added += group.prompts.length
    } catch (error) {
      host.logger.warn('import topic was not created', {
        rows: group.rows.length,
        threw: error instanceof Error ? error.name : typeof error
      })
      const reason = error instanceof Error ? error.message : 'Could not create that topic.'
      for (const index of group.rows) outcome.skipped.push({ index, reason })
    }
  }
  outcome.skipped.sort((left, right) => left.index - right.index)
  return outcome
}

/**
 * The rows' own markets a page or topic does not check yet ("Add it" in Add
 * questions), linked to it and listed for Undo. A row's market is saved this
 * way: CiteFox checks each question in every market of its page or topic.
 */
function addRowMarkets(
  host: EngineHost,
  db: SqliteDatabase,
  pageId: string,
  wanted: ReadonlySet<string>
): BatchItem[] {
  if (wanted.size === 0) return []
  const have = new Set(pageMarkets(db, pageId).map((market) => market.id))
  const addedAt = host.now().toISOString()
  const items: BatchItem[] = []
  for (const marketId of wanted) {
    if (have.has(marketId)) continue
    addPageMarket(db, { pageId, marketId, addedAt, baselineRunId: null })
    items.push({ kind: 'market', marketId, pageId, created: false })
  }
  return items
}

/**
 * The markets a topic made from the Topic column is checked in: the ones its rows
 * name (W3I-C1), plus the usual ones (the picked page's or topic's, else the
 * project default) when a row names none or no row names one.
 */
export function importedTopicMarkets(
  rows: { markets: ReadonlySet<string>; unscoped: boolean },
  usual: readonly string[]
): string[] {
  if (rows.markets.size === 0) return [...usual]
  return [...new Set([...(rows.unscoped ? usual : []), ...rows.markets])]
}

/** A topic from the Topic column, written the way New topic writes one: no check until Check now. */
function createImportedTopic(
  host: EngineHost,
  opened: Opened,
  name: string,
  prompts: readonly TopicDraftPrompt[],
  like: ImportDestination | null,
  rows: { markets: ReadonlySet<string>; unscoped: boolean }
): string {
  const { db, project } = opened
  const env = { host, checks: null, emitProgress: () => undefined }
  const deps = { now: () => host.now(), createId: () => host.createId() }
  const draft = createDraft(
    db,
    project,
    { projectId: project.id, path: 'seed', name, seed: name },
    deps
  )
  const marketIds = importedTopicMarkets(
    rows,
    like !== null && like.marketIds.length > 0 ? like.marketIds : draft.marketIds
  )
  const filled = { ...draft, marketIds, prompts: [...prompts] }
  const written = writeTopic(env, opened, filled, prompts, filled.intervalDays)
  const now = host.now()
  holdIntervalCheck(db, written.topicId, now, filled.intervalDays)
  saveDraft(
    db,
    { ...filled, topicId: written.topicId, startedAt: now.toISOString(), step: 'estimate' },
    now
  )
  return written.topicId
}

/** Competitors, products and markets: one write each, listed for Undo. */
export function commitList(
  host: EngineHost,
  opened: Opened,
  request: ImportCommitRequest,
  facts: ProjectFacts
): CommitOutcome {
  const { db } = opened
  const entity = request.entity
  if (entity === 'questions' || entity === 'keywords' || entity === 'pages') {
    throw new Error('commitList takes competitors, products or markets.')
  }
  const values = request.rows.map((row) => row.values)
  const checks = checkListRows(entity, values, facts)
  const outcome: CommitOutcome = { items: [], added: 0, skipped: [], promptIds: [] }
  const chosen: number[] = []
  checks.forEach((check, index) => {
    if (check.result === 'new') chosen.push(index)
    else outcome.skipped.push({ index, reason: skipReason(check) })
  })
  if (chosen.length === 0) return outcome
  if (entity === 'competitors' || entity === 'products') {
    const catalog = readProductCatalog(db)
    const products = [...catalog.products]
    const competitors = [...catalog.competitors]
    for (const index of chosen) {
      const row = values[index] ?? {}
      if (entity === 'competitors') {
        const domain =
          (row.domain ?? '')
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//u, '')
            .replace(/^www\./u, '')
            .split('/')[0] ?? ''
        const name = (row.name ?? '').trim() || domain
        competitors.push({
          name: name.slice(0, 80),
          domain,
          productId: productIdNamed(products, row.competes_with),
          tier: 'direct',
          startingPrice: null,
          sources: []
        })
        outcome.items.push({ kind: 'competitor', name: name.slice(0, 80), domain })
      } else {
        const productId = `prod-${host.createId()}`
        const url = (row.url ?? '').trim()
        const checked =
          url.length === 0 ? null : checkPageUrl(url, facts.domain, facts.includeSubdomains)
        products.push({
          id: productId,
          name: (row.name ?? '').trim().slice(0, 80),
          job: (row.job ?? '').trim().slice(0, 300),
          buyer: (row.buyer ?? '').trim().slice(0, 300),
          evidencePath: checked !== null && checked.ok ? new URL(checked.url).pathname : null
        })
        outcome.items.push({ kind: 'product', productId })
      }
      outcome.added += 1
    }
    replaceProductCatalog(db, { products, competitors })
    return outcome
  }
  // Markets: added to the project, and to the page or topic the import is for.
  const now = host.now().toISOString()
  const language = facts.markets[0]?.language ?? 'en'
  db.transaction(() => {
    for (const index of chosen) {
      const parsed = marketOf(values[index] ?? {}, language)
      if (!parsed.ok) continue
      const market: Market = {
        id: `mkt-${host.createId()}`,
        country: parsed.country,
        language: parsed.language,
        location: parsed.location,
        device: parsed.device,
        localWording: false,
        serpapiLocation: null
      }
      insertMarket(db, market)
      if (request.targetId !== null && getPage(db, request.targetId, opened.project.id) !== null) {
        addPageMarket(db, {
          pageId: request.targetId,
          marketId: market.id,
          addedAt: now,
          baselineRunId: null
        })
      }
      outcome.items.push({
        kind: 'market',
        marketId: market.id,
        pageId: request.targetId,
        created: true
      })
      outcome.added += 1
    }
  })()
  return outcome
}
