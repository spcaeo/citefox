import type { BrandFact, BrandPromptSet, SentimentView } from '@shared/domain'
import type {
  AddBrandFactRequest,
  DeleteBrandFactRequest,
  RereadSentimentResult,
  SaveBrandPromptsRequest,
  SentimentRequest,
  SentimentUpdated
} from '@shared/ipc'
import type { Logger } from '../../logging/logger'
import { redactString } from '../../logging/redact'
import { PipelineError } from '../../pipeline/errors'
import type { GenerationCallCaps } from '../../pipeline/llm'
import type { ClaudeProvider } from '../../providers/claude/claude-code'
import type { AppStorage } from '../../storage/app-storage'
import { deleteBrandFact, insertBrandFact, listBrandFacts } from '../../storage/brand-records'
import type { SqliteDatabase } from '../../storage/database'
import { getPage } from '../../storage/pages'
import { closeProjectDatabase, openProjectDatabase } from '../../storage/project-files'
import { getProject } from '../../storage/records'
import { CheckInputError } from '../checks/results'
import { aiLimiter } from '../parallel'
import { isReading, startReading } from './activity'
import {
  generateBrandPrompts,
  pageMarkets,
  saveBrandPrompts,
  type BrandPromptDeps
} from './brand-prompts'
import { readRunSentiment } from './read'
import { runOverviews } from './overviews'
import { fullRuns, loadSentimentView } from './view'

export interface SentimentServiceDeps {
  storage: AppStorage
  logger: Logger
  now: () => Date
  createId: () => string
  knownSecrets: () => readonly string[]
  /** The project's Claude connection (FR-11.7). Throws when it cannot be built. */
  claude: (projectId: string) => ClaudeProvider
  emitUpdated: (event: SentimentUpdated) => void
  caps?: GenerationCallCaps
}

export interface SentimentService {
  get(request: SentimentRequest): SentimentView
  generateBrandPrompts(request: { projectId: string; pageId: string }): Promise<BrandPromptSet>
  saveBrandPrompts(request: SaveBrandPromptsRequest): BrandPromptSet
  listFacts(projectId: string): BrandFact[]
  addFact(request: AddBrandFactRequest): BrandFact[]
  deleteFact(request: DeleteBrandFactRequest): BrandFact[]
  /** FR-16.6. Starts a background re-read of saved overviews. No new searches. */
  reread(request: { projectId: string; pageId: string }): RereadSentimentResult
  /** Resolves when every background re-read has ended. */
  idle(): Promise<void>
}

export function createSentimentService(deps: SentimentServiceDeps): SentimentService {
  const active = new Set<Promise<void>>()
  const withDb = <T>(projectId: string, work: (db: SqliteDatabase) => T): T => {
    const project = getProject(deps.storage.db, projectId)
    if (project === null) throw new CheckInputError('Unknown project')
    const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
    try {
      return work(db)
    } finally {
      closeProjectDatabase(db)
    }
  }
  const base = (db: SqliteDatabase): BrandPromptDeps => ({
    db,
    appDb: deps.storage.db,
    logger: deps.logger,
    now: () => deps.now().toISOString(),
    createId: deps.createId,
    secrets: deps.knownSecrets(),
    ...(deps.caps !== undefined ? { caps: deps.caps } : {})
  })
  return {
    get: (request) =>
      withDb(request.projectId, (db) =>
        loadSentimentView(db, { ...request, running: isReading(request.projectId, request.pageId) })
      ),
    async generateBrandPrompts(request) {
      const claude = deps.claude(request.projectId)
      const project = getProject(deps.storage.db, request.projectId)
      if (project === null) throw new CheckInputError('Unknown project')
      const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
      try {
        return await generateBrandPrompts({ ...base(db), claude }, request)
      } finally {
        closeProjectDatabase(db)
      }
    },
    saveBrandPrompts: (request) =>
      withDb(request.projectId, (db) => saveBrandPrompts(base(db), request)),
    listFacts: (projectId) => withDb(projectId, (db) => listBrandFacts(db)),
    addFact: (request) =>
      withDb(request.projectId, (db) => {
        insertBrandFact(db, {
          id: deps.createId(),
          text: request.text,
          source: request.source,
          addedAt: deps.now().toISOString()
        })
        return listBrandFacts(db)
      }),
    deleteFact: (request) =>
      withDb(request.projectId, (db) => {
        if (!deleteBrandFact(db, request.factId)) {
          throw new PipelineError('That brand fact is already gone.', {
            code: 'not_found',
            nextStep: 'Reload the Sentiment tab.'
          })
        }
        return listBrandFacts(db)
      }),
    reread(request) {
      if (isReading(request.projectId, request.pageId)) {
        return {
          started: false,
          overviews: 0,
          message: 'CiteFox AI is already reading these overviews.'
        }
      }
      const plan = withDb(request.projectId, (db) => {
        if (getPage(db, request.pageId, request.projectId) === null) {
          throw new CheckInputError('Unknown page')
        }
        const runs = pageMarkets(db, request.pageId).flatMap((market) => {
          const latest = fullRuns(db, request.projectId, request.pageId, market.id).at(-1)
          return latest === undefined ? [] : [latest]
        })
        const overviews = runs.reduce(
          (sum, run) =>
            sum +
            runOverviews(db, request.projectId, run).filter((item) => item.aioText !== null).length,
          0
        )
        return { runIds: runs.map((run) => run.id), overviews }
      })
      const runIds = plan.runIds
      if (plan.overviews === 0) {
        return {
          started: false,
          overviews: 0,
          message: 'There are no saved overviews yet. Press Check now first.'
        }
      }
      const claude = deps.claude(request.projectId)
      const done = startReading(request.projectId, request.pageId)
      const work = rereadRuns(deps, claude, request.projectId, runIds)
        .catch((error: unknown) => {
          deps.logger.error('sentiment re-read failed', {
            message: redactString(error instanceof Error ? error.message : 'Re-read failed', {
              secrets: deps.knownSecrets(),
              hexKeys: true
            })
          })
        })
        .finally(() => {
          done()
          active.delete(work)
          deps.emitUpdated({ projectId: request.projectId, pageId: request.pageId })
        })
      active.add(work)
      const noun = plan.overviews === 1 ? 'overview' : 'overviews'
      return {
        started: true,
        overviews: plan.overviews,
        message: `CiteFox AI is re-reading ${plan.overviews} saved ${noun}. No new searches.`
      }
    },
    idle: async () => {
      while (active.size > 0) await Promise.allSettled([...active])
    }
  }
}

async function rereadRuns(
  deps: SentimentServiceDeps,
  claude: ClaudeProvider,
  projectId: string,
  runIds: readonly string[]
): Promise<void> {
  const project = getProject(deps.storage.db, projectId)
  if (project === null) return
  const db = openProjectDatabase(deps.storage.paths.projectsDirectory, project.slug)
  // One page's markets in turn; each run's overviews side by side ("Calls at once").
  const limiter = aiLimiter(deps.storage.readSettings().claudeConcurrency)
  try {
    for (const runId of runIds) {
      await readRunSentiment(
        {
          db,
          appDb: deps.storage.db,
          claude,
          logger: deps.logger,
          secrets: deps.knownSecrets(),
          now: () => deps.now().toISOString(),
          createId: deps.createId,
          limiter,
          ...(deps.caps !== undefined ? { caps: deps.caps } : {})
        },
        { projectId, runId }
      )
    }
  } finally {
    closeProjectDatabase(db)
  }
}
