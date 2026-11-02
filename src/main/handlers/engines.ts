/** Multi-engine tracking: engine choices, estimates, per-engine answers and spend. */

import {
  ENGINE_IDS,
  isEngineId,
  isProviderChoice,
  normaliseEngines,
  type EngineId,
  type PageSummary,
  type ProviderChoice
} from '@shared/domain'
import type { enginesChannels, IpcHandlersFor } from '@shared/ipc'
import { engineAccess } from '../engine/engines/access'
import { estimateEngines } from '../engine/engines/estimate'
import { engineSpendView } from '../engine/engines/spend'
import {
  engineSummary,
  pageEnginesView,
  projectEnginesView,
  questionEnginesView,
  questionMarket
} from '../engine/engines/views'
import { systemZone } from '../engine/checks/engine-helpers'
import { withProject, type OpenProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { monthKey } from '../scheduler/local-time'
import { saveEngineSettings, savePageEngines } from '../storage/engine-records'
import { getPage, listPages } from '../storage/pages'
import { readProjectProfile } from '../storage/project-profile'
import { guard, type EngineContext } from './context'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
/** Pages one request may name. */
const MAX_PAGES = 2_000
/** Pages a per-question summary may cover, so the payload stays small. */
const MAX_QUESTION_PAGES = 50

export function enginesHandlers(ctx: EngineContext): IpcHandlersFor<typeof enginesChannels> {
  const access = (opened: OpenProject): ReturnType<typeof engineAccess> =>
    engineAccess(ctx.storage, opened.project, opened.db, ctx.now(), systemZone())
  return {
    'engines:get': (request) =>
      guard('engines:get', ctx, () => {
        const projectId = projectIdOf('engines:get', request)
        return withProject(ctx, projectId, 'engines:get', (opened) =>
          projectEnginesView(opened.db, projectId, access(opened))
        )
      }),
    'engines:set': (request) =>
      guard('engines:set', ctx, () => {
        const channel = 'engines:set'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const engines =
          record.engines === undefined ? undefined : enginesOf(channel, record.engines, false)
        const provider = record.provider === undefined ? undefined : providerOf(channel, record)
        return withProject(ctx, projectId, channel, (opened) => {
          saveEngineSettings(
            opened.db,
            {
              ...(engines !== undefined ? { engines } : {}),
              ...(provider !== undefined ? { provider } : {})
            },
            ctx.now().toISOString()
          )
          return projectEnginesView(opened.db, projectId, access(opened))
        })
      }),
    'engines:page': (request) =>
      guard('engines:page', ctx, () => {
        const channel = 'engines:page'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const pageId = idOf(channel, record.pageId)
        return withProject(ctx, projectId, channel, ({ db }) =>
          pageEnginesView(db, projectId, pageOf(channel, db, pageId, projectId))
        )
      }),
    'engines:setPage': (request) =>
      guard('engines:setPage', ctx, () => {
        const channel = 'engines:setPage'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const pageId = idOf(channel, record.pageId)
        const engines = record.engines === null ? null : enginesOf(channel, record.engines, true)
        return withProject(ctx, projectId, channel, ({ db }) => {
          const page = pageOf(channel, db, pageId, projectId)
          savePageEngines(
            db,
            page.id,
            engines === null || engines.length === 0 ? null : engines,
            ctx.now().toISOString()
          )
          return pageEnginesView(db, projectId, page)
        })
      }),
    'engines:estimate': (request) =>
      guard('engines:estimate', ctx, () => {
        const channel = 'engines:estimate'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const pageIds = pageIdsOf(channel, record.pageIds)
        const engines =
          record.engines === undefined || record.engines === null
            ? null
            : enginesOf(channel, record.engines, false)
        const provider =
          record.provider === undefined || record.provider === null
            ? null
            : providerOf(channel, record)
        return withProject(ctx, projectId, channel, (opened) => {
          const pages =
            pageIds === null
              ? listPages(opened.db, projectId).filter((page) => page.status === 'tracked')
              : pageIds.map((pageId) => pageOf(channel, opened.db, pageId, projectId))
          return estimateEngines({
            db: opened.db,
            projectId,
            access: access(opened),
            pages,
            picked: pageIds !== null,
            brands: readProjectProfile(opened.db)?.brandNames ?? [],
            engines,
            provider
          })
        })
      }),
    'engines:question': (request) =>
      guard('engines:question', ctx, () => {
        const channel = 'engines:question'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const pageId = idOf(channel, record.pageId)
        const promptId = idOf(channel, record.promptId)
        const marketId = optionalIdOf(channel, record.marketId)
        return withProject(ctx, projectId, channel, ({ db }) => {
          const page = pageOf(channel, db, pageId, projectId)
          return questionEnginesView(
            db,
            projectId,
            page,
            promptId,
            questionMarket(db, page, marketId)
          )
        })
      }),
    'engines:summary': (request) =>
      guard('engines:summary', ctx, () => {
        const channel = 'engines:summary'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const pageIds = pageIdsOf(channel, record.pageIds)
        const marketId = optionalIdOf(channel, record.marketId)
        if (record.perQuestion !== undefined && typeof record.perQuestion !== 'boolean') {
          throw new IpcRequestError(channel)
        }
        const perQuestion = record.perQuestion === true
        if (perQuestion && (pageIds === null || pageIds.length > MAX_QUESTION_PAGES)) {
          throw new IpcRequestError(
            channel,
            `Ask for each question's statuses on up to ${MAX_QUESTION_PAGES} pages at a time`
          )
        }
        return withProject(ctx, projectId, channel, ({ db }) => ({
          projectId,
          ...engineSummary(db, { pageIds, marketId }, perQuestion)
        }))
      }),
    'engines:spend': (request) =>
      guard('engines:spend', ctx, () => {
        const channel = 'engines:spend'
        const record = recordOf(channel, request)
        const projectId = projectIdOf(channel, record)
        const zone = systemZone()
        let month = monthKey(ctx.now().getTime(), zone)
        if (record.month !== undefined && record.month !== null) {
          if (typeof record.month !== 'string' || !MONTH.test(record.month)) {
            throw new IpcRequestError(channel)
          }
          month = record.month
        }
        return withProject(ctx, projectId, channel, ({ db }) =>
          engineSpendView({ db, appDb: ctx.storage.db, projectId, month, zone })
        )
      })
  }
}

function pageOf(
  channel: string,
  db: OpenProject['db'],
  pageId: string,
  projectId: string
): PageSummary {
  const page = getPage(db, pageId, projectId)
  if (page === null || page.status === 'removed') {
    throw new IpcRequestError(channel, 'That page was not found')
  }
  return page
}

function enginesOf(channel: string, value: unknown, allowEmpty: boolean): EngineId[] {
  if (!Array.isArray(value) || value.length > ENGINE_IDS.length * 2) {
    throw new IpcRequestError(channel)
  }
  if (!value.every(isEngineId)) throw new IpcRequestError(channel, 'Unknown engine')
  const engines = normaliseEngines(value)
  if (!allowEmpty && engines.length === 0) {
    throw new IpcRequestError(channel, 'Pick at least one engine')
  }
  return engines
}

function providerOf(channel: string, record: Record<string, unknown>): ProviderChoice {
  if (!isProviderChoice(record.provider)) throw new IpcRequestError(channel)
  return record.provider
}

function pageIdsOf(channel: string, value: unknown): string[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length > MAX_PAGES) throw new IpcRequestError(channel)
  return [...new Set(value.map((item) => idOf(channel, item)))]
}

function optionalIdOf(channel: string, value: unknown): string | null {
  return value === undefined || value === null ? null : idOf(channel, value)
}

function recordOf(channel: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  return value as Record<string, unknown>
}

function projectIdOf(channel: string, value: unknown): string {
  return idOf(channel, recordOf(channel, value).projectId)
}

function idOf(channel: string, value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}
