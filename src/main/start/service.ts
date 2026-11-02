import type {
  SiteStartBudget,
  SiteStartPlan,
  StartBeginRequest,
  StartBeginResult,
  StartEdit,
  StartEditList,
  StartEditResult,
  StartHomeworkRequest,
  StartJourney,
  StartProgress,
  StartSuggestUrlsRequest,
  StartUrlSuggestions
} from '@shared/ipc'
import { DEFAULT_PROMPT_COUNT, DEFAULT_SAMPLE_COUNT } from '@shared/domain'
import { applyKnownEdits, applyPlanEdits } from '@shared/start-edits'
import type { CheckEngine } from '../engine/checks/engine'
import type { EngineHost } from '../engine/host'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import type { SqliteDatabase } from '../storage/database'
import type { StructureRuntime } from '../structure/runtime'
import { searchesLeftFor } from '../topics/drafts'
import { runAutopilot, StartStopped } from './autopilot'
import { matchUrls } from './candidates'
import { beginFirstCheck, followUps, journeyOf } from './begin'
import {
  addedPages,
  insertEditRecord,
  listEditRecords,
  parseStartEdit,
  undoEditRecord
} from './edit-store'
import { newRecord } from './edits'
import { listStartPages, loadStartPlan } from './store'
import { StartTracker } from './tracker'

/**
 * The first-run journey service (owner feedback 4, journey A): the autopilot
 * (one run per project, stoppable between steps, with a live snapshot), the
 * user's edits along the way (stored, undoable, fed to the steps still to
 * run), the saved plan with a live budget, the first check, and where the
 * project is in the journey. Only `begin` spends searches.
 */

export interface StartDeps {
  host: EngineHost
  rt: StructureRuntime
  checks: CheckEngine | null
  emit: (event: StartProgress) => void
  /** Test runs only: the autopilot refuses to start. */
  autopilotOff?: boolean
}

export interface StartService {
  homework(request: StartHomeworkRequest): Promise<SiteStartPlan>
  get(projectId: string): Promise<SiteStartPlan | null>
  progress(projectId: string): Promise<StartProgress | null>
  stop(projectId: string): Promise<StartProgress | null>
  begin(request: StartBeginRequest): Promise<StartBeginResult>
  status(projectId: string): Promise<StartJourney>
  edit(projectId: string, raw: unknown): Promise<StartEditResult>
  undo(projectId: string, editId: string): Promise<StartEditResult>
  edits(projectId: string): Promise<StartEditList>
  suggestUrls(request: StartSuggestUrlsRequest): Promise<StartUrlSuggestions>
}

export function createStartService(deps: StartDeps): StartService {
  const running = new Map<string, Promise<SiteStartPlan>>()
  const stopFlags = new Map<string, boolean>()
  const trackers = new Map<string, StartTracker>()
  const drafts = new Map<string, string>()
  const host = deps.host

  /** The live snapshot with the user's edits applied. */
  async function edited(projectId: string, snapshot: StartProgress): Promise<StartProgress> {
    return withProject(host, projectId, 'start:progress', (opened) => {
      const records = listEditRecords(opened.db)
      if (records.length === 0) return snapshot
      const sections = loadStartPlan(opened.db)?.sections ?? []
      return {
        ...snapshot,
        known: applyKnownEdits(snapshot.known, records, addedPages(opened.db, records, sections))
      }
    })
  }

  function emitEdited(projectId: string, snapshot: StartProgress): void {
    void edited(projectId, snapshot).then(deps.emit, () => deps.emit(snapshot))
  }

  async function plan(projectId: string, channel: string): Promise<SiteStartPlan | null> {
    return withProject(host, projectId, channel, (opened) => {
      const saved = loadStartPlan(opened.db)
      return saved === null ? null : planView(host, opened.db, saved)
    })
  }

  async function run(request: StartHomeworkRequest): Promise<SiteStartPlan> {
    const { projectId } = request
    if (request.force !== true) {
      const saved = await plan(projectId, 'start:homework')
      if (saved !== null) return saved
    }
    if (deps.autopilotOff === true) {
      throw new IpcRequestError('start:homework', 'Setup is turned off in this test run.')
    }
    stopFlags.set(projectId, false)
    const tracker = new StartTracker(
      projectId,
      Date.now(),
      () => Date.now(),
      (snapshot) => emitEdited(projectId, snapshot)
    )
    trackers.set(projectId, tracker)
    try {
      await runAutopilot(
        { host, rt: deps.rt, checks: deps.checks },
        projectId,
        request.force === true,
        tracker,
        () => stopFlags.get(projectId) === true,
        {
          edits: () =>
            withProject(host, projectId, 'start:homework', (opened) => listEditRecords(opened.db)),
          onDraft: (draftId) => drafts.set(projectId, draftId)
        }
      )
      tracker.end('done')
      const done = await plan(projectId, 'start:homework')
      if (done === null) throw new Error('The plan was not saved.')
      return done
    } catch (error) {
      if (error instanceof StartStopped) {
        tracker.end('stopped', 'Paused. Edit anything, then resume; nothing read so far is lost.')
        throw new IpcRequestError('start:homework', 'Setup was paused.', 'Resume to finish.')
      }
      const reason = error instanceof Error ? error.message : 'Setup stopped.'
      tracker.end('failed', reason)
      throw error
    }
  }

  async function result(
    projectId: string,
    record: StartEditResult['record'],
    effect: string | null
  ): Promise<StartEditResult> {
    const tracker = trackers.get(projectId)
    const live = running.has(projectId) && tracker !== undefined
    const progress = live ? await edited(projectId, tracker.snapshot()) : null
    if (progress !== null) deps.emit(progress)
    return { record, effect, plan: await plan(projectId, 'start:edit'), progress }
  }

  return {
    homework(request) {
      const current = running.get(request.projectId)
      if (current !== undefined) return current
      const next = run(request).finally(() => running.delete(request.projectId))
      running.set(request.projectId, next)
      return next
    },
    get: (projectId) => plan(projectId, 'start:get'),
    async progress(projectId) {
      const snapshot = trackers.get(projectId)?.snapshot() ?? null
      return snapshot === null ? null : edited(projectId, snapshot)
    },
    async stop(projectId) {
      if (running.has(projectId)) stopFlags.set(projectId, true)
      const snapshot = trackers.get(projectId)?.snapshot() ?? null
      return snapshot === null ? null : edited(projectId, snapshot)
    },
    begin: (request) => beginFirstCheck(deps, request),
    status: (projectId) => journeyOf(host, projectId, running.has(projectId)),
    async edit(projectId, raw) {
      const channel = 'start:edit'
      const { record, base } = await withProject(host, projectId, channel, (opened) => {
        const edit: StartEdit = parseStartEdit(raw, opened.project.domain, channel)
        const created = newRecord(edit, `edit-${host.createId()}`, host.now().toISOString())
        insertEditRecord(opened.db, created)
        const saved = loadStartPlan(opened.db)
        const liveQuestions = trackers.get(projectId)?.known.questions ?? []
        return {
          record: created,
          base: {
            questions: saved?.questions ?? liveQuestions,
            draftId: saved?.topic?.draftId ?? null
          }
        }
      })
      const effect = await followUps(deps, projectId, record, {
        questions: base.questions,
        draftId: base.draftId ?? drafts.get(projectId) ?? null,
        tracker: running.has(projectId) ? (trackers.get(projectId) ?? null) : null
      })
      return result(projectId, record, effect)
    },
    async undo(projectId, editId) {
      const channel = 'start:undo'
      const record = await withProject(host, projectId, channel, (opened) => {
        const found = listEditRecords(opened.db).find((entry) => entry.id === editId)
        if (found === undefined || !undoEditRecord(opened.db, editId, host.now().toISOString())) {
          throw new IpcRequestError(channel, 'That change was already undone.')
        }
        return { ...found, undoneAt: host.now().toISOString() }
      })
      return result(projectId, record, null)
    },
    edits: (projectId) =>
      withProject(host, projectId, 'start:edits', (opened) => ({
        edits: listEditRecords(opened.db)
      })),
    suggestUrls: (request) =>
      withProject(host, request.projectId, 'start:suggestUrls', (opened) =>
        matchUrls(listStartPages(opened.db), request.query, request.limit ?? 8)
      )
  }
}

/** Budget numbers for the plan estimate, read now (key usage changes). */
export function startBudget(
  host: EngineHost,
  db: SqliteDatabase,
  projectId: string,
  questions: number
): SiteStartBudget {
  // The drafted topic checks the project's default market only.
  return {
    markets: 1,
    promptsPerPage: DEFAULT_PROMPT_COUNT,
    questionsPerTopic: questions,
    samples: DEFAULT_SAMPLE_COUNT,
    searchesLeft: searchesLeftFor(host.storage, db, projectId, host.now())
  }
}

/** The saved plan with the user's edits, what is tracked now, and a live budget. */
export function planView(
  host: EngineHost,
  db: SqliteDatabase,
  saved: SiteStartPlan
): SiteStartPlan {
  const records = listEditRecords(db)
  const withEdits = applyPlanEdits(saved, records, addedPages(db, records, saved.sections))
  const tracked = new Set(
    listStartPages(db)
      .filter((page) => page.tracked)
      .map((page) => page.url)
  )
  return {
    ...withEdits,
    pages: withEdits.pages.map((page) => ({ ...page, alreadyTracked: tracked.has(page.url) })),
    budget: startBudget(host, db, saved.projectId, withEdits.questions.length)
  }
}
