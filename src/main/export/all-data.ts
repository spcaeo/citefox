import { basename, dirname } from 'node:path'
import type { ExportSection } from '@shared/domain'
import type { AllDataProjectEntry, ExportAllDataResult, ExportRequest } from '@shared/ipc'
import type { Logger } from '../logging/logger'
import { redactString, redactValue } from '../logging/redact'
import type { AppStorage } from '../storage/app-storage'
import { listProjects, type ProjectRecord } from '../storage/records'
import { nodeExportIo, publishBytes, type ExportAtomicIo } from './atomic'
import type { ExportSaveDialog } from './ipc'
import { buildJsonExport, serializeJsonExport } from './json'
import { reportModelFor } from './model/from-dataset'
import { prepareExport } from './prepare'
import { storageReportBuilders } from './report-builders'
import { exportedSections, jsonSelection } from './service-request'
import { createStorageExportSource } from './source'
import { calendarDay, isIanaTimeZone } from './timezone'
import { zipStore, type ZipEntry } from './zip'

/**
 * Settings → Data → "Export all data": one zip with every project's JSON export v2
 * (all pages, markets and checks, raw SerpApi data included), the app settings and a
 * manifest. Secrets live only in the system keychain, so API keys, SMTP passwords and
 * webhook URLs are never read here; known secret values are masked as well.
 */

export const ALL_DATA_FORMAT = 'citefox-data-export'
export const ALL_DATA_VERSION = 1
export const ALL_DATA_MANIFEST = 'citefox-data.json'

/** Every report section, raw data included: this is a backup, not a report. */
const ALL_SECTIONS: readonly ExportSection[] = [
  'overview',
  'pages',
  'competition',
  'reputation',
  'trends',
  'universe',
  'sources',
  'answer_shape',
  'content_gaps',
  'prompts',
  'raw'
]

const READ_FAILED = 'This project could not be read, so it is not in the zip.'
const KEYCHAIN_NOTE =
  'API keys, SMTP passwords and Slack webhook URLs stay in the system keychain and are not included.'

export interface AllDataInput {
  storage: AppStorage
  now: () => Date
  /** Values masked wherever they appear (NFR-5). */
  secrets: readonly string[]
  appVersion: string
  /** IANA zone for check dates and the default file name. Defaults to this computer's. */
  timeZone?: string
  logger?: Logger
}

export interface ExportAllDataInput extends AllDataInput {
  /** The save dialog. Null when none is configured. */
  dialog: ExportSaveDialog | null
  io?: ExportAtomicIo
}

/** `citefox-all-data-<date>.zip`, the date in `timeZone`. */
export function allDataFilename(now: Date, timeZone: string): string {
  return `citefox-all-data-${calendarDay(now.toISOString(), timeZone)}.zip`
}

/** The zip bytes and what happened to each project. Writes nothing. */
export async function buildAllDataZip(
  input: AllDataInput
): Promise<{ bytes: Buffer; projects: AllDataProjectEntry[] }> {
  const now = input.now()
  const timeZone = zoneOf(input.timeZone)
  const entries: ZipEntry[] = []
  const projects: AllDataProjectEntry[] = []
  const usedNames = new Set<string>()
  for (const project of listProjects(input.storage.db)) {
    const file = uniqueName(`projects/${safeSlug(project.slug)}.citefox.json`, usedNames)
    try {
      const text = await projectJson(input, project, now, timeZone)
      entries.push({ name: file, data: Buffer.from(text, 'utf8') })
      projects.push(entry(project, input.secrets, file, null))
    } catch (error) {
      input.logger?.error('export all data: project skipped', {
        message: redactString(error instanceof Error ? error.message : 'read failed', {
          secrets: input.secrets,
          hexKeys: true
        })
      })
      projects.push(entry(project, input.secrets, null, READ_FAILED))
    }
  }
  const settings = {
    format: ALL_DATA_FORMAT,
    note: KEYCHAIN_NOTE,
    settings: redactValue(input.storage.readSettings(), { secrets: input.secrets, hexKeys: true })
  }
  const manifest = {
    format: ALL_DATA_FORMAT,
    version: ALL_DATA_VERSION,
    appVersion: input.appVersion,
    exportedAt: now.toISOString(),
    timeZone,
    note: KEYCHAIN_NOTE,
    projects
  }
  const head: ZipEntry[] = [
    { name: ALL_DATA_MANIFEST, data: jsonBytes(manifest) },
    { name: 'settings.json', data: jsonBytes(settings) }
  ]
  return { bytes: zipStore([...head, ...entries]), projects }
}

/** `settings:exportAllData`: asks where to save, then writes the zip atomically. */
export async function exportAllData(input: ExportAllDataInput): Promise<ExportAllDataResult> {
  if (input.dialog === null) {
    return {
      ok: false,
      cancelled: false,
      reason: 'Could not open the save dialog.',
      nextStep: 'Try the export again.'
    }
  }
  const picked = await input.dialog({
    title: 'Export all data',
    defaultPath: allDataFilename(input.now(), zoneOf(input.timeZone)),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }]
  })
  if (picked.canceled || picked.filePath === undefined || picked.filePath.length === 0) {
    return {
      ok: false,
      cancelled: true,
      reason: 'Export cancelled',
      nextStep: 'Choose a file name and save.'
    }
  }
  try {
    const { bytes, projects } = await buildAllDataZip(input)
    const filename = basename(picked.filePath)
    const filePath = await publishBytes(
      dirname(picked.filePath),
      filename,
      bytes,
      input.io ?? nodeExportIo()
    )
    return { ok: true, filePath, filename, bytes: bytes.length, projects }
  } catch (error) {
    input.logger?.error('export all data failed', {
      message: redactString(error instanceof Error ? error.message : 'write failed', {
        secrets: input.secrets,
        hexKeys: true
      })
    })
    return {
      ok: false,
      cancelled: false,
      reason: 'CiteFox could not write the zip.',
      nextStep: 'Choose another folder with free space, then try again.'
    }
  }
}

async function projectJson(
  input: AllDataInput,
  project: ProjectRecord,
  now: Date,
  timeZone: string
): Promise<string> {
  const deps = {
    app: input.storage.db,
    projectsDirectory: input.storage.paths.projectsDirectory,
    now: () => now
  }
  const base: ExportRequest = {
    projectId: project.id,
    scope: 'project',
    pageIds: [],
    viewId: null,
    marketIds: [],
    checks: 'all',
    from: null,
    to: null,
    sections: ALL_SECTIONS,
    format: 'json',
    pdf: null,
    xlsx: null,
    csv: null,
    html: null,
    filenamePattern: '{project}.citefox.{ext}',
    timeZone,
    logoBase64: null
  }
  const dataset = await createStorageExportSource(deps).loadExportDataset({
    projectId: project.id,
    scope: 'project',
    pageIds: [],
    viewId: null,
    marketIds: [],
    checks: 'all',
    from: null,
    to: null,
    timeZone,
    includeRaw: true
  })
  // Every market any page has: an empty list would select none.
  const marketIds = [
    ...new Set(dataset.pages.flatMap((page) => page.markets.map((market) => market.marketId)))
  ]
  const request: ExportRequest = { ...base, marketIds }
  const prepared = prepareExport(dataset, request)
  const builders = storageReportBuilders(
    { ...deps, ...(input.logger !== undefined ? { logger: input.logger } : {}) },
    project.id
  )
  const model = reportModelFor(dataset, prepared.pages, request, now, builders)
  return serializeJsonExport(
    buildJsonExport({
      projectName: dataset.projectName,
      projectSlug: dataset.projectSlug,
      clientName: dataset.clientName,
      pages: prepared.pages,
      sections: exportedSections(request.sections),
      includeRaw: true,
      selection: jsonSelection(request),
      timeZone,
      now,
      secrets: input.secrets,
      model
    })
  )
}

function entry(
  project: ProjectRecord,
  secrets: readonly string[],
  file: string | null,
  error: string | null
): AllDataProjectEntry {
  return {
    id: project.id,
    name: redactString(project.name, { secrets }),
    slug: project.slug,
    file,
    error
  }
}

function zoneOf(timeZone: string | undefined): string {
  if (timeZone !== undefined && isIanaTimeZone(timeZone)) return timeZone
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  return isIanaTimeZone(local) ? local : 'UTC'
}

/** Slugs are already file-safe; this keeps a zip entry name inside `projects/` regardless. */
function safeSlug(slug: string): string {
  const cleaned = slug.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned : 'project'
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name
  for (let index = 2; used.has(candidate); index += 1) {
    candidate = name.replace(/\.citefox\.json$/, `-${index}.citefox.json`)
  }
  used.add(candidate)
  return candidate
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
