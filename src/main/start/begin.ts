import type {
  StartBeginRequest,
  StartBeginResult,
  StartEditRecord,
  StartJourney,
  StartQuestion
} from '@shared/ipc'
import { applyQuestionEdits } from '@shared/start-edits'
import { normalizeUrl } from '../engine/checks/url'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { createTopicsService, type TopicsService } from '../topics/service'
import { readOne } from '../topics/site'
import { insertEditRecord, listEditRecords } from './edit-store'
import {
  draftQuestions,
  newRecord,
  questionsNaming,
  renamedText,
  syncDraftQuestions
} from './edits'
import type { StartDeps } from './service'
import { loadStartPlan, saveStartPlan } from './store'
import type { StartTracker } from './tracker'

/**
 * The first check from the plan, the follow-ups an edit needs, and where the
 * project is in the journey.
 */

function urlKey(url: string): string {
  return (normalizeUrl(url) ?? url).replace(/\/$/u, '').toLowerCase()
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/**
 * Questions that name a rival the user removed are rewritten by Claude
 * without it; each rewrite is stored as a follow-up of the removal (undone
 * with it). Returns how many were rewritten and how many could not be.
 */
export async function rewriteForRemovedRivals(
  deps: Pick<StartDeps, 'host'>,
  topics: TopicsService,
  projectId: string,
  draftId: string,
  questions: readonly StartQuestion[],
  records: readonly StartEditRecord[],
  only: StartEditRecord | null = null
): Promise<{ rewritten: number; failed: number }> {
  let rewritten = 0
  let failed = 0
  const removals = records.filter(
    (record) =>
      record.undoneAt === null &&
      record.edit.kind === 'rival' &&
      record.edit.op === 'remove' &&
      (only === null || record.id === only.id)
  )
  for (const removal of removals) {
    if (removal.edit.kind !== 'rival') continue
    const name = removal.edit.name
    const already = new Set(
      records
        .filter((record) => record.parentId === removal.id && record.undoneAt === null)
        .flatMap((record) =>
          record.edit.kind === 'question' && 'id' in record.edit ? [record.edit.id] : []
        )
    )
    const naming = questionsNaming(questions, name).filter((question) => !already.has(question.id))
    const own = naming.filter((question) => !question.id.startsWith('added:'))
    if (own.length === 0) continue
    try {
      const reply = await topics['topics:rewriteQuestion']({
        projectId,
        draftId,
        promptIds: own.map((question) => question.id),
        instruction: `Do not mention ${name}: the user says it is not a rival for this buyer. Keep the buyer's situation.`
      })
      const at = deps.host.now().toISOString()
      await withProject(deps.host, projectId, 'start:edit', (opened) => {
        own.forEach((question, index) => {
          const suggestion =
            reply.suggestions.find((entry) => entry.replacesId === question.id) ??
            reply.suggestions[index]
          if (suggestion === undefined) {
            failed += 1
            return
          }
          insertEditRecord(
            opened.db,
            newRecord(
              { kind: 'question', op: 'edit', id: question.id, text: suggestion.text },
              `edit-${deps.host.createId()}`,
              at,
              removal.id
            )
          )
          rewritten += 1
        })
      })
    } catch {
      failed += own.length
    }
  }
  return { rewritten, failed }
}

/** What an edit needs beyond being stored: reading an added page, fixing questions that name a rival. */
export async function followUps(
  deps: StartDeps,
  projectId: string,
  record: StartEditRecord,
  context: {
    questions: readonly StartQuestion[]
    draftId: string | null
    tracker: StartTracker | null
  }
): Promise<string | null> {
  const { host } = deps
  const edit = record.edit
  if (edit.kind === 'page' && edit.op === 'add') {
    const keyStep = context.tracker?.snapshot().items.find((item) => item.id === 'key_pages')
    if (keyStep !== undefined && (keyStep.state === 'pending' || keyStep.state === 'running')) {
      return 'It will be read with the key pages.'
    }
    context.tracker?.sub('key_pages', {
      label: pathOf(edit.url),
      state: 'running',
      detail: 'Reading your page'
    })
    const read = await withProject(host, projectId, 'start:edit', (opened) =>
      readOne(host, opened.db, edit.url, 'other', false)
    )
    context.tracker?.sub('key_pages', {
      label: pathOf(edit.url),
      state: read.ok ? 'ok' : 'skipped',
      detail: read.ok ? 'Read' : 'Could not be read'
    })
    return read.ok
      ? `Read ${pathOf(edit.url)}.`
      : `Could not read ${pathOf(edit.url)}; it stays in the plan.`
  }
  if (edit.kind !== 'rival' || (edit.op !== 'remove' && edit.op !== 'rename')) return null
  const records = await withProject(host, projectId, 'start:edit', (opened) =>
    listEditRecords(opened.db)
  )
  const questions = applyQuestionEdits(context.questions, records)
  const naming = questionsNaming(questions, edit.name)
  if (naming.length === 0) return null
  if (edit.op === 'rename') {
    const at = host.now().toISOString()
    await withProject(host, projectId, 'start:edit', (opened) => {
      for (const question of naming) {
        insertEditRecord(
          opened.db,
          newRecord(
            {
              kind: 'question',
              op: 'edit',
              id: question.id,
              text: renamedText(question.text, edit.name, edit.to)
            },
            `edit-${host.createId()}`,
            at,
            record.id
          )
        )
      }
    })
    return `Updated ${naming.length} ${naming.length === 1 ? 'question' : 'questions'} with the new name.`
  }
  if (context.draftId === null) return null
  context.tracker?.update('questions', {
    detail: `Rewriting ${naming.length} ${naming.length === 1 ? 'question' : 'questions'} with your change`
  })
  const topics = createTopicsService(host, deps.checks, () => undefined)
  const done = await rewriteForRemovedRivals(
    deps,
    topics,
    projectId,
    context.draftId,
    questions,
    records,
    record
  )
  if (done.rewritten === 0 && done.failed === 0) return null
  return done.failed > 0
    ? `Rewrote ${done.rewritten}; ${done.failed} still name ${edit.name}. Edit them below.`
    : `Rewrote ${done.rewritten} ${done.rewritten === 1 ? 'question' : 'questions'} with your change.`
}

/**
 * Starts the first check: the draft takes the edited questions, questions
 * matched to a page not ticked get "no page yet", then the drafted topic
 * starts with every question now.
 */
export async function beginFirstCheck(
  deps: StartDeps,
  request: StartBeginRequest
): Promise<StartBeginResult> {
  const channel = 'start:begin'
  const { projectId } = request
  const loaded = await withProject(deps.host, projectId, channel, (opened) => ({
    plan: loadStartPlan(opened.db),
    records: listEditRecords(opened.db)
  }))
  const plan = loaded.plan
  if (plan === null || plan.topic === null) {
    throw new IpcRequestError(channel, 'There is no plan to start yet.', 'Set up your site first.')
  }
  if (plan.topicId !== null) {
    return { topicId: plan.topicId, jobId: null, message: 'The first check already started.' }
  }
  const topics = createTopicsService(deps.host, deps.checks, () => undefined)
  const draftId = plan.topic.draftId
  let draft = await topics['topics:getDraft']({ projectId, draftId })
  draft = await syncDraftQuestions(
    topics,
    draft,
    applyQuestionEdits(draftQuestions(draft), loaded.records)
  )
  const ticked = new Set(request.targetUrls.map(urlKey))
  const untick = draft.prompts
    .filter((prompt) => prompt.targetUrl !== null && !ticked.has(urlKey(prompt.targetUrl)))
    .map((prompt) => prompt.id)
  if (untick.length > 0) {
    await topics['topics:setTarget']({
      projectId,
      draftId,
      promptIds: untick,
      target: { pageId: null, url: null }
    })
  }
  const started = await topics['topics:start']({ projectId, draftId, plan: 'all_now' })
  await withProject(deps.host, projectId, channel, (opened) => {
    const current = loadStartPlan(opened.db)
    if (current !== null) {
      saveStartPlan(opened.db, {
        ...current,
        topicId: started.topicId,
        firstCheckAt: deps.host.now().toISOString()
      })
    }
  })
  return { topicId: started.topicId, jobId: started.jobId, message: started.message }
}

export async function journeyOf(
  host: EngineHost,
  projectId: string,
  running: boolean
): Promise<StartJourney> {
  return withProject(host, projectId, 'start:status', (opened) => {
    const db = opened.db
    const plan = loadStartPlan(db)
    const working =
      db
        .prepare<unknown[], { n: number }>(
          `SELECT COUNT(*) AS n FROM pages
           WHERE status IN ('tracked', 'setting_up', 'paused') OR kind = 'topic'`
        )
        .get()?.n ?? 0
    const topicId = plan?.topicId ?? null
    const anyRun =
      db.prepare<unknown[], { n: number }>(`SELECT COUNT(*) AS n FROM runs`).get()?.n ?? 0
    const finished = db
      .prepare<unknown[], { page_id: string }>(
        `SELECT page_id FROM runs WHERE status = 'finished'
         ORDER BY (page_id = ?) DESC, finished_at DESC LIMIT 1`
      )
      .get(topicId ?? '')
    return {
      projectId,
      empty: working === 0,
      running,
      hasPlan: plan !== null,
      topicId,
      checkStarted: anyRun > 0 || plan?.firstCheckAt != null,
      hasResults: finished !== undefined,
      resultsPageId: finished?.page_id ?? null
    }
  })
}
