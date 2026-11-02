/** Project rules (Project settings › Project rules) and the charts' tracking changes. */

import {
  PROJECT_RULE_MAX,
  type IpcHandlersFor,
  type ProjectRuleList,
  type projectRulesChannels,
  type SaveProjectRuleRequest
} from '@shared/ipc'
import { withProject } from '../engine/project-db'
import { IpcRequestError } from '../ipc-request'
import { parseProjectId } from '../ipc-m2'
import { StorageError } from '../storage/errors'
import { deleteProjectRule, listProjectRules, saveProjectRule } from '../storage/project-rules'
import { listTrackingChanges } from '../storage/tracking-changes'
import { guard, type EngineContext } from './context'

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

export function projectRulesHandlers(
  ctx: EngineContext
): IpcHandlersFor<typeof projectRulesChannels> {
  const list = (projectId: string, rules: ProjectRuleList['rules']): ProjectRuleList => ({
    projectId,
    rules
  })
  return {
    'projectRules:list': (request) =>
      guard('projectRules:list', ctx, () => {
        const { projectId } = parseProjectId(request, 'projectRules:list')
        return withProject(ctx, projectId, 'projectRules:list', ({ db }) =>
          list(projectId, listProjectRules(db))
        )
      }),
    'projectRules:save': (request) =>
      guard('projectRules:save', ctx, () => {
        const channel = 'projectRules:save'
        const parsed = parseSave(request, channel)
        return withProject(ctx, parsed.projectId, channel, ({ db }) => {
          try {
            return list(parsed.projectId, saveProjectRule(db, parsed, ctx.now().toISOString()))
          } catch (error) {
            if (error instanceof StorageError) throw new IpcRequestError(channel, error.message)
            throw error
          }
        })
      }),
    'projectRules:delete': (request) =>
      guard('projectRules:delete', ctx, () => {
        const channel = 'projectRules:delete'
        const record = plain(request, channel, ['projectId', 'id'])
        const projectId = readId(record.projectId, channel)
        const id = readId(record.id, channel)
        return withProject(ctx, projectId, channel, ({ db }) =>
          list(projectId, deleteProjectRule(db, id))
        )
      }),
    'tracking:changes': (request) =>
      guard('tracking:changes', ctx, () => {
        const { projectId } = parseProjectId(request, 'tracking:changes')
        return withProject(ctx, projectId, 'tracking:changes', ({ db }) => ({
          projectId,
          changes: listTrackingChanges(db)
        }))
      })
  }
}

function parseSave(value: unknown, channel: string): SaveProjectRuleRequest {
  const record = plain(value, channel, ['projectId', 'id', 'text', 'enabled'])
  const text = record.text
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > PROJECT_RULE_MAX * 2) {
    throw new IpcRequestError(channel, 'Write the rule first.')
  }
  if (typeof record.enabled !== 'boolean') throw new IpcRequestError(channel)
  return {
    projectId: readId(record.projectId, channel),
    id: record.id === null ? null : readId(record.id, channel),
    text,
    enabled: record.enabled
  }
}

/** An object with exactly these keys. */
function plain(value: unknown, channel: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IpcRequestError(channel)
  }
  const record = value as Record<string, unknown>
  const present = Object.keys(record)
  if (present.length !== keys.length || !keys.every((key) => present.includes(key))) {
    throw new IpcRequestError(channel)
  }
  return record
}

function readId(value: unknown, channel: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new IpcRequestError(channel)
  return value
}
