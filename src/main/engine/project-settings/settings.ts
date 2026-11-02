import { statSync } from 'node:fs'
import { isGenerationTemplateKind } from '@shared/domain'
import type { ProjectClaudeSettings, ProjectTemplateOverride } from '@shared/domain'
import type { ProjectSettingsView, UpdateProjectSettingsRequest } from '@shared/ipc'
import { IpcRequestError } from '../../ipc-request'
import { capAllowance } from '../../queue/usage'
import type { SqliteDatabase } from '../../storage/database'
import { readCheckWhenReady, writeCheckWhenReady } from '../../storage/first-check-waits'
import { listPages } from '../../storage/pages'
import { readProjectOptions, writeProjectOptions } from '../../storage/project-options'
import { listMarkets } from '../../storage/project-profile'
import { getApiKey, getProject, type ProjectRecord } from '../../storage/records'
import { projectDatabasePath } from '../../storage/slug'
import { getTemplate } from '../../storage/template-records'
import { projectUsedForMonth } from '../checks/key-rotation'
import type { EngineHost } from '../host'
import { withProject } from '../project-db'
import { applyTemplateChoices, projectTemplateChoices } from './template-choices'
import { detailFrom } from '../projects'
import { localZone, monthWindow, projectedMonthEnd } from './month'
import { applySearchSettings, readSearchSettings } from './search'

export function getProjectSettings(
  host: EngineHost,
  projectId: string
): Promise<ProjectSettingsView> {
  return withProject(host, projectId, 'projectSettings:get', (opened) =>
    settingsView(host, opened.project, opened.db)
  )
}

/** Saves each part that is present. Key ids are checked against `api_keys` first. */
export function updateProjectSettings(
  host: EngineHost,
  request: UpdateProjectSettingsRequest
): Promise<ProjectSettingsView> {
  const channel = 'projectSettings:update'
  return withProject(host, request.projectId, channel, (opened) => {
    const options = readProjectOptions(opened.db)
    const claude = request.claude
    if (claude !== undefined) assertClaudeKeys(host, claude, channel)
    const overrides = request.templateOverrides
    if (overrides !== undefined) assertOverrides(host, overrides, channel)
    if (request.search !== undefined) {
      applySearchSettings(host.storage, opened.db, opened.project.id, request.search, channel)
    }
    if (overrides !== undefined) {
      // TPL-1: choices are project template versions (template_overrides, FR-26.8).
      applyTemplateChoices(host.storage.db, opened.db, overrides, {
        now: host.now().toISOString(),
        createId: host.createId
      })
    }
    if (request.checkWhenReady !== undefined) writeCheckWhenReady(opened.db, request.checkWhenReady)
    if (claude !== undefined || request.defaultSamples !== undefined) {
      writeProjectOptions(opened.db, {
        claude: claude ?? options.claude,
        defaultSamples: request.defaultSamples ?? options.defaultSamples,
        templateOverrides: options.templateOverrides
      })
    }
    return settingsView(host, opened.project, opened.db)
  })
}

/** FR-11.7. Both keys must be Anthropic API keys that exist. */
export function assertClaudeKeys(
  host: EngineHost,
  claude: ProjectClaudeSettings,
  channel: string
): void {
  const ids = [
    claude.connection === 'api_key' ? claude.keyId : null,
    claude.fallback === 'switch_key' ? claude.fallbackKeyId : null
  ]
  if (claude.connection === 'api_key' && claude.keyId === null) {
    throw new IpcRequestError(channel, 'Choose an Anthropic API key')
  }
  if (claude.fallback === 'switch_key' && claude.fallbackKeyId === null) {
    throw new IpcRequestError(channel, 'Choose the API key to switch to')
  }
  for (const id of ids) {
    if (id === null) continue
    const key = getApiKey(host.storage.db, id)
    if (key === null || key.provider !== 'anthropic') {
      throw new IpcRequestError(channel, 'That Anthropic API key was not found')
    }
  }
}

function assertOverrides(
  host: EngineHost,
  overrides: readonly ProjectTemplateOverride[],
  channel: string
): void {
  for (const override of overrides) {
    const template = getTemplate(host.storage.db, override.templateId)
    if (
      !isGenerationTemplateKind(override.kind) ||
      template === null ||
      template.deletedAt !== null ||
      template.kind !== override.kind
    ) {
      throw new IpcRequestError(channel, 'That template was not found')
    }
  }
}

/** The settings view for one open project file. Usage is this local month (SERP-6). */
export function settingsView(
  host: EngineHost,
  project: ProjectRecord,
  db: SqliteDatabase
): ProjectSettingsView {
  const options = readProjectOptions(db)
  const search = readSearchSettings(db)
  const window = monthWindow(host.now(), localZone())
  const used = projectUsedForMonth(host.storage, project.id, window.month)
  const path = projectDatabasePath(host.storage.paths.projectsDirectory, project.slug)
  const current = getProject(host.storage.db, project.id) ?? project
  return {
    project: detailFrom(current, db),
    markets: listMarkets(db),
    search,
    usage: {
      used,
      allowance: search.cap === null ? null : capAllowance(search.cap, search.capRule),
      projectedMonthEnd: projectedMonthEnd(used, window),
      resetsOn: window.resetsOn
    },
    claude: options.claude,
    defaultSamples: options.defaultSamples ?? host.settings().defaultSamples,
    templateOverrides: projectTemplateChoices(host.storage.db, db),
    checkWhenReady: readCheckWhenReady(db),
    database: {
      path,
      bytes: fileBytes(path),
      pageCount: listPages(db, project.id).length,
      checkCount: countRuns(db)
    }
  }
}

function countRuns(db: SqliteDatabase): number {
  const row = db.prepare<unknown[], { total: number }>(`SELECT COUNT(*) AS total FROM runs`).get()
  return row?.total ?? 0
}

function fileBytes(path: string): number {
  let total = 0
  for (const file of [path, `${path}-wal`]) {
    try {
      total += statSync(file).size
    } catch {
      // A missing WAL file is normal.
    }
  }
  return total
}
