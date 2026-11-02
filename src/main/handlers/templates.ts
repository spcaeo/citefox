/** Generation templates. */

import type { GenerationTemplate } from '@shared/domain'
import {
  TEMPLATE_ERROR_MESSAGES,
  type IpcHandlersFor,
  type templatesChannels,
  type TemplateUsage
} from '@shared/ipc'
import {
  IpcRequestError,
  parseCreateTemplate,
  parseListTemplates,
  parseTemplateId,
  parseTemplateUsage,
  parseUpdateTemplate
} from '../ipc-request'
import {
  createGenerationTemplate,
  deleteGenerationTemplate,
  getGenerationTemplate,
  listGenerationTemplates,
  readTemplateUsage,
  resetGenerationTemplate,
  restoreGenerationTemplate,
  setDefaultGenerationTemplate,
  updateGenerationTemplate
} from '../pipeline/templates'
import { withProject } from '../engine/project-db'
import { tryTemplate } from '../engine/template-try'
import {
  parseSaveOverride,
  parseTemplateKind,
  parseTemplateSteps,
  parseTemplateVersions,
  parseTryTemplate
} from '../ipc-ai'
import {
  listTemplateSteps,
  listVersionsOf,
  resetTemplateOverride,
  saveTemplateOverride
} from '../pipeline/template-steps'
import { resetTemplateToShipped } from '../pipeline/templates'
import { readTemplateUsageDetail } from '../pipeline/template-usage-detail'
import { guard, type EngineContext } from './context'

export function templatesHandlers(ctx: EngineContext): IpcHandlersFor<typeof templatesChannels> {
  return {
    'templates:list': (request) => guard('templates:list', ctx, () => listTemplates(ctx, request)),
    'templates:get': (request) => guard('templates:get', ctx, () => getOneTemplate(ctx, request)),
    'templates:create': (request) =>
      guard('templates:create', ctx, () => createTemplate(ctx, request)),
    'templates:update': (request) =>
      guard('templates:update', ctx, () => updateTemplate(ctx, request)),
    'templates:reset': (request) =>
      guard('templates:reset', ctx, () => resetTemplate(ctx, request)),
    'templates:delete': (request) =>
      guard('templates:delete', ctx, () => deleteTemplate(ctx, request)),
    'templates:restore': (request) =>
      guard('templates:restore', ctx, () => restoreTemplate(ctx, request)),
    'templates:setDefault': (request) =>
      guard('templates:setDefault', ctx, () => setDefaultTemplate(ctx, request)),
    'templates:usage': (request) =>
      guard('templates:usage', ctx, () => templateUsage(ctx, request)),
    'templates:usageDetail': (request) =>
      guard('templates:usageDetail', ctx, () =>
        readTemplateUsageDetail(ctx.storage, parseTemplateUsage(request, 'templates:usageDetail'))
      ),
    'templates:steps': (request) =>
      guard('templates:steps', ctx, async () => {
        const parsed = parseTemplateSteps(request)
        if (parsed.projectId === undefined) return listTemplateSteps(ctx.storage.db, null)
        return withProject(ctx, parsed.projectId, 'templates:steps', ({ db }) =>
          listTemplateSteps(ctx.storage.db, db)
        )
      }),
    'templates:saveOverride': (request) =>
      guard('templates:saveOverride', ctx, () => {
        const parsed = parseSaveOverride(request)
        return withProject(ctx, parsed.projectId, 'templates:saveOverride', ({ db }) =>
          saveTemplateOverride(ctx.storage.db, db, parsed, {
            id: `ovr-${ctx.createId()}`,
            now: ctx.now().toISOString()
          })
        )
      }),
    'templates:resetOverride': (request) =>
      guard('templates:resetOverride', ctx, () => {
        const parsed = parseTemplateKind(request, 'templates:resetOverride')
        return withProject(ctx, parsed.projectId, 'templates:resetOverride', ({ db }) =>
          resetTemplateOverride(ctx.storage.db, db, parsed.kind, ctx.now().toISOString())
        )
      }),
    'templates:resetToShipped': (request) =>
      guard('templates:resetToShipped', ctx, () => {
        const parsed = parseTemplateId(request, 'templates:resetToShipped')
        return resetTemplateToShipped(ctx.storage.db, parsed.id, ctx.now().toISOString())
      }),
    'templates:versions': (request) =>
      guard('templates:versions', ctx, () => {
        const parsed = parseTemplateVersions(request)
        if (parsed.id !== undefined) return listVersionsOf(ctx.storage.db, { id: parsed.id })
        const { projectId, kind } = parsed
        if (projectId === undefined || kind === undefined) {
          throw new IpcRequestError('templates:versions')
        }
        return withProject(ctx, projectId, 'templates:versions', ({ db }) =>
          listVersionsOf(ctx.storage.db, { projectDb: db, kind })
        )
      }),
    'templates:try': (request) =>
      guard('templates:try', ctx, () => tryTemplate(ctx, parseTryTemplate(request)))
  }
}

function listTemplates(ctx: EngineContext, request: unknown): readonly GenerationTemplate[] {
  return listGenerationTemplates(ctx.storage.db, parseListTemplates(request))
}

function getOneTemplate(ctx: EngineContext, request: unknown): GenerationTemplate {
  const parsed = parseTemplateId(request, 'templates:get')
  const template = getGenerationTemplate(ctx.storage.db, parsed.id)
  if (template === null) {
    throw new IpcRequestError('templates:get', TEMPLATE_ERROR_MESSAGES.not_found)
  }
  return template
}

function createTemplate(ctx: EngineContext, request: unknown): GenerationTemplate {
  const parsed = parseCreateTemplate(request)
  return createGenerationTemplate(ctx.storage.db, parsed, {
    id: `tpl-${ctx.createId()}`,
    now: ctx.now().toISOString()
  })
}

function updateTemplate(
  ctx: EngineContext,
  request: unknown
): {
  template: GenerationTemplate
  warnings: GenerationTemplate['warnings']
} {
  return updateGenerationTemplate(
    ctx.storage.db,
    parseUpdateTemplate(request),
    ctx.now().toISOString()
  )
}

function resetTemplate(ctx: EngineContext, request: unknown): GenerationTemplate {
  const parsed = parseTemplateId(request, 'templates:reset')
  const template = resetGenerationTemplate(ctx.storage.db, parsed.id)
  if (template === null) {
    throw new IpcRequestError('templates:reset', TEMPLATE_ERROR_MESSAGES.not_found)
  }
  return template
}

function deleteTemplate(ctx: EngineContext, request: unknown): GenerationTemplate {
  const parsed = parseTemplateId(request, 'templates:delete')
  return deleteGenerationTemplate(ctx.storage.db, parsed.id, ctx.now().toISOString())
}

function restoreTemplate(ctx: EngineContext, request: unknown): GenerationTemplate {
  const parsed = parseTemplateId(request, 'templates:restore')
  return restoreGenerationTemplate(ctx.storage.db, parsed.id)
}

function setDefaultTemplate(ctx: EngineContext, request: unknown): GenerationTemplate {
  const parsed = parseTemplateId(request, 'templates:setDefault')
  return setDefaultGenerationTemplate(ctx.storage.db, parsed.id)
}

function templateUsage(ctx: EngineContext, request: unknown): TemplateUsage {
  return readTemplateUsage(
    ctx.storage.db,
    ctx.storage.paths.projectsDirectory,
    parseTemplateUsage(request)
  )
}
