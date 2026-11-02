import { isTopicStage } from '@shared/domain'
import type {
  FinishSetupRequest,
  FinishSetupResult,
  OnboardingState,
  ProductSuggestion,
  CompanySuggestion,
  SetupRow,
  TopicProfilePointInput
} from '@shared/ipc'
import type { CheckEngine } from '../engine/checks/engine'
import type { EngineHost } from '../engine/host'
import { saveFillCatalog } from '../engine/products'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { clearOnboardingDraft } from '../storage/onboarding-draft'
import { saveProjectRule } from '../storage/project-rules'
import {
  listApiKeys,
  listProjects,
  readOnboardingFinished,
  writeOnboardingFinished
} from '../storage/records'
import { createTopicClustersService } from '../topics/clusters/service'
import { createTopicsService } from '../topics/service'
import { parseRows, parseRules, record, text } from './sections/parse'

/**
 * `onboarding:finishSetup` (Docs/ONBOARDING.md "Finish"): step 8's "Finish and run
 * the first check". The profile is already saved (step 6). This saves the rest:
 *
 * 1. Products and competitors by product (the same catalog Fill from my website
 *    saves, `saveFillCatalog`).
 * 2. The first topic with its questions (stage tags), its buyer profile (buyers as
 *    segments, trigger events) and the summary as its "About the business", which the
 *    topic prompts read. The project has no other home for that summary today.
 * 3. Onboarding is marked finished and the draft is cleared.
 * 4. With `runFirstCheck` and a search key on (cloro or SerpApi), the topic starts
 *    the way Start does (`topics:start`, plan `all_now`, the real job queue). With no
 *    key, the topic is saved without a check and `message` says why.
 *
 * A failure before step 3 leaves onboarding open, so the user can try again.
 */

const CHANNEL = 'onboarding:finishSetup'

export const NO_SEARCH_KEY_MESSAGE =
  'The first check did not start because no search key is on. Add a search key in Connections, then press Check now.'

/** True when a cloro or SerpApi key is saved and on. */
export function hasSearchKey(host: EngineHost): boolean {
  return listApiKeys(host.storage.db).some(
    (key) => (key.provider === 'serpapi' || key.provider === 'cloro') && key.on
  )
}

export function parseFinishSetup(value: unknown): FinishSetupRequest {
  const r = record(
    value,
    CHANNEL,
    [
      'summary',
      'products',
      'competitors',
      'buyers',
      'triggers',
      'topic',
      'questions',
      'runFirstCheck',
      'rules'
    ],
    ['rules']
  )
  if (typeof r.runFirstCheck !== 'boolean') throw new IpcRequestError(CHANNEL)
  if (!Array.isArray(r.triggers) || r.triggers.length > 100) throw new IpcRequestError(CHANNEL)
  return {
    summary: text(r.summary, CHANNEL, 4000).trim(),
    products: parseRows(r.products, CHANNEL),
    competitors: parseRows(r.competitors, CHANNEL),
    buyers: parseRows(r.buyers, CHANNEL),
    triggers: r.triggers.map((item) => text(item, CHANNEL, 500).trim()).filter(Boolean),
    topic: text(r.topic, CHANNEL, 500).trim(),
    questions: parseRows(r.questions, CHANNEL),
    runFirstCheck: r.runFirstCheck,
    rules: parseRules(r.rules, CHANNEL)
  }
}

export async function finishSetup(
  host: EngineHost,
  checks: CheckEngine | null,
  request: FinishSetupRequest,
  readState: () => OnboardingState
): Promise<FinishSetupResult> {
  if (readOnboardingFinished(host.storage.db)) {
    throw new IpcRequestError(CHANNEL, 'Setup is already finished.', 'Open the app.')
  }
  const project = listProjects(host.storage.db)[0]
  if (project === undefined || readState().profile === null) {
    throw new IpcRequestError(CHANNEL, 'Save your site first.', 'Go back to the Competitors step.')
  }
  // The rules first: the topic's own AI steps below already follow them.
  await saveRules(host, project.id, request.rules ?? [])
  await saveCatalog(host, project.id, request)
  const searchKey = hasSearchKey(host)
  const topic = await saveTopic(
    host,
    checks,
    project.id,
    request,
    request.runFirstCheck && searchKey
  )
  writeOnboardingFinished(host.storage.db, true)
  clearOnboardingDraft(host.storage.paths.onboardingDraftFile)
  let message: string | null = null
  if (request.runFirstCheck) {
    if (topic === null) message = 'Add at least one question to run a first check.'
    else if (!searchKey) message = NO_SEARCH_KEY_MESSAGE
    else if (topic.jobId === null) message = topic.message
  }
  host.logger.info('onboarding setup finished', {
    products: request.products.length,
    competitors: request.competitors.length,
    questions: request.questions.length,
    topic: topic !== null,
    checkStarted: topic?.jobId != null
  })
  return {
    state: readState(),
    projectId: project.id,
    topicId: topic?.topicId ?? null,
    checkStarted: topic !== null && topic.jobId !== null,
    message
  }
}

/** The draft's project rules into Project settings › Project rules. A failure never blocks. */
async function saveRules(
  host: EngineHost,
  projectId: string,
  rules: readonly string[]
): Promise<void> {
  if (rules.length === 0) return
  try {
    await withProject(host, projectId, CHANNEL, ({ db }) => {
      const now = new Date().toISOString()
      for (const text of rules) saveProjectRule(db, { id: null, text, enabled: true }, now)
    })
  } catch (error) {
    host.logger.warn('onboarding rules not saved', {
      reason: error instanceof Error ? error.name : 'unknown'
    })
  }
}

/**
 * The kept products and competitors as a Fill read, so the catalog is saved the same
 * way. A competitor's `tag` names its product. A failure is logged and never blocks.
 */
async function saveCatalog(
  host: EngineHost,
  projectId: string,
  request: FinishSetupRequest
): Promise<void> {
  if (request.products.length === 0 && request.competitors.length === 0) return
  const products: ProductSuggestion[] = request.products
    .filter((row) => row.name.trim().length > 0)
    .map((row) => ({
      id: `prod-${host.createId()}`,
      name: row.name.trim(),
      job: row.detail.trim(),
      buyer: '',
      evidence: row.url === null ? null : { path: row.url, quote: '' },
      searchNote: null
    }))
  const productId = (name: string | null): string | null => {
    const key = (name ?? '').trim().toLowerCase()
    return products.find((item) => item.name.toLowerCase() === key)?.id ?? null
  }
  const competitors: CompanySuggestion[] = request.competitors
    .filter((row) => row.name.trim().length > 0)
    .map((row) => ({
      id: `comp-${host.createId()}`,
      name: row.name.trim(),
      domain: row.url,
      domainSource: row.url === null ? null : 'typed',
      reason: row.detail,
      evidence: null,
      checkDomain: false,
      product: productId(row.tag),
      tier: row.tier === 'partial' ? 'partial' : 'direct',
      startingPrice: null,
      sources: []
    }))
  const kept = competitors.map((row) => row.domain ?? row.name)
  try {
    await withProject(host, projectId, CHANNEL, ({ db }) => {
      const saved = saveFillCatalog(db, { products, competitors }, kept)
      host.logger.info('onboarding catalog saved', {
        products: saved.products.length,
        competitors: saved.competitors.length
      })
    })
  } catch (error) {
    host.logger.warn('onboarding catalog not saved', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown'
    })
  }
}

/** Segments (up to 12) and trigger events as the topic's buyer profile points. */
function profilePoints(request: FinishSetupRequest): TopicProfilePointInput[] {
  const points: TopicProfilePointInput[] = []
  for (const row of request.buyers.slice(0, 40)) {
    const name = row.name.trim()
    if (name.length === 0) continue
    const detail = row.detail.trim()
    points.push({ section: 'segments', text: clip(detail ? `${name}: ${detail}` : name, 400) })
  }
  for (const trigger of request.triggers.slice(0, 40)) {
    points.push({ section: 'triggers', text: clip(trigger, 400) })
  }
  return points.slice(0, 80)
}

/**
 * The first topic: a draft filled with the questions, the profile and the summary, then
 * started now (a search key is on and a check was asked for) or saved without a check.
 * Null when there is no question to track.
 */
async function saveTopic(
  host: EngineHost,
  checks: CheckEngine | null,
  projectId: string,
  request: FinishSetupRequest,
  start: boolean
): Promise<{ topicId: string; jobId: string | null; message: string } | null> {
  const questions = uniqueQuestions(request.questions)
  if (questions.length === 0) return null
  const name = clip(request.topic || questions[0]?.name || 'First topic', 300)
  const topics = createTopicsService(host, checks, () => undefined)
  const draft = await topics['topics:createDraft']({
    projectId,
    path: 'seed',
    name,
    seed: clip(name, 500)
  })
  const points = profilePoints(request)
  // The check covers the kinds the draft generates, so keywords need it to say so.
  const searches = questions.filter((row) => row.detail === 'search').length
  const generate =
    searches === 0 ? 'questions' : searches === questions.length ? 'keywords' : 'both'
  await topics['topics:updateDraft']({
    projectId,
    draftId: draft.id,
    patch: {
      name,
      generate,
      ...(request.summary.length > 0 ? { about: clip(request.summary, 4000) } : {}),
      segments: request.buyers
        .map((row) => clip(row.name, 120))
        .filter(Boolean)
        .slice(0, 12),
      // Step 8's short searches are keywords; questions and situations are questions.
      upsertPrompts: questions.map((row) => ({
        kind: row.detail === 'search' ? ('keyword' as const) : ('question' as const),
        text: clip(row.name, 500),
        stage: row.tag !== null && isTopicStage(row.tag) ? row.tag : null,
        source: 'claude' as const
      })),
      ...(points.length > 0 ? { profile: { points, note: 'edited' as const } } : {})
    }
  })
  if (start) {
    const started = await topics['topics:start']({ projectId, draftId: draft.id, plan: 'all_now' })
    return {
      topicId: started.topicId,
      jobId: started.jobId,
      message: started.nextStep ?? started.message
    }
  }
  const clusters = createTopicClustersService(host, checks, () => undefined)
  const saved = await clusters['topics:createFromDraft']({ projectId, draftId: draft.id })
  return { topicId: saved.topicId, jobId: null, message: saved.message }
}

/** Kept questions once each (case and spacing ignored), at most 200. */
function uniqueQuestions(rows: readonly SetupRow[]): SetupRow[] {
  const seen = new Set<string>()
  const out: SetupRow[] = []
  for (const row of rows) {
    const key = row.name.replace(/\s+/gu, ' ').trim().toLowerCase()
    if (key.length < 3 || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out.slice(0, 200)
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/gu, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}
