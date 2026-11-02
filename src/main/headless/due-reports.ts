import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unconfiguredDraftOpener } from '../email/draft'
import { dueOccurrences } from '../email/due'
import {
  reportContentType,
  reportExportRequest,
  reportModelRequest
} from '../email/reports/export-request'
import { reportSummaryLines } from '../email/reports/summary-body'
import { createEmailService } from '../email/service'
import { createStorageEmailStores } from '../email/storage-stores'
import type { SmtpTransport } from '../email/transport'
import type { ReportPayload, ReportSchedule, SummaryWriter } from '../email/types'
import { unconfiguredWebhookTransport } from '../email/webhook'
import { loadReportModel, startExport } from '../export/service'
import { redactString } from '../logging/redact'
import { storageReportBuilders } from '../export/report-builders'
import { createStorageExportSource } from '../export/source'
import type { Logger } from '../logging/logger'
import { localDateKey } from '../scheduler/local-time'
import type { SecretStore } from '../secrets/secret-store'
import type { AppStorage } from '../storage/app-storage'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { readProjectProfile } from '../storage/project-profile'
import { cachedSiteIcon, readReportSender } from '../storage/report-sender'
import { reviewPdfPrinter } from '../export/review/download'
import { buildReadyReportEmail } from '../export/review/scheduled'
import { senderEmailName } from '@shared/report/review/sender'
import { readProjectSchedule } from '../storage/project-schedule'
import { getProject, listProjects } from '../storage/records'
import { listPagesOfKind } from '../storage/pages'
import { scheduleScopePageIds } from './report-scope'

/**
 * SCH-1 and FR-23.12. After a `--check-due` pass, send weekly and monthly
 * reports whose slot is due. A throttle row from the first send keeps a second
 * pass on the same occurrence from sending again.
 */
export interface DueReportDelivery {
  secrets: SecretStore
  transport: SmtpTransport
  logger: Logger
  /** Values removed from the report file and the send log (NFR-5). */
  redacted?: readonly string[]
  /** Rewrites the summary with Claude for a schedule with a summary style. */
  summaryWriter?: SummaryWriter
}

/** What building a report file needs from the delivery port: the log and the masked values. */
export type ReportBuildPort = Pick<DueReportDelivery, 'logger' | 'redacted'>

export async function deliverDueScheduledReports(input: {
  storage: AppStorage
  delivery: DueReportDelivery
  now: () => Date
  timeZone: string
}): Promise<void> {
  const now = input.now()
  const clock = { now: input.now, timeZone: input.timeZone }
  const stores = createStorageEmailStores({
    app: input.storage.db,
    projectsDirectory: input.storage.paths.projectsDirectory,
    outboxDir: join(input.storage.paths.root, 'outbox'),
    clock,
    logger: input.delivery.logger
  })
  try {
    const payloads = new Map<string, ReportPayload>()
    for (const schedule of stores.reports.list()) {
      if (schedule.timing.kind !== 'weekly' && schedule.timing.kind !== 'monthly') continue
      if (schedule.status === 'paused') continue
      const pending = dueOccurrences(schedule, now.getTime()).filter(
        (occurrence) => !stores.deliveries.hasThrottle(`report:${schedule.id}:${occurrence.key}`)
      )
      if (pending.length === 0) continue
      try {
        payloads.set(
          schedule.id,
          await scheduledReportPayload(input.storage, schedule, now, input.delivery)
        )
      } catch (error: unknown) {
        // One schedule's report must not stop the others or fail the whole --check-due pass.
        input.delivery.logger.error('CiteFox could not build a scheduled report', {
          scheduleId: schedule.id,
          message: error instanceof Error ? error.message : 'failed'
        })
      }
    }
    const service = createEmailService({
      secrets: input.delivery.secrets,
      transport: input.delivery.transport,
      webhooks: unconfiguredWebhookTransport(),
      drafts: unconfiguredDraftOpener(),
      accounts: stores.accounts,
      alerts: stores.alerts,
      reports: stores.reports,
      deliveries: stores.deliveries,
      pdfs: stores.pdfs,
      logger: input.delivery.logger,
      clock,
      knownSecrets: () => input.delivery.redacted ?? [],
      sleep: async () => undefined,
      ...(input.delivery.summaryWriter !== undefined
        ? { summaryWriter: input.delivery.summaryWriter }
        : {})
    })
    await service.releaseDue({
      isPaused: (projectId) => projectIsPaused(input.storage, projectId),
      factsFor: (schedule) => payloads.get(schedule.id) ?? null
    })
  } finally {
    stores.close()
  }
}

/**
 * The summary lines and the report file a schedule sends. The scheduled send and a
 * resend from Delivery history both use it, so a resend carries the same file.
 */
export async function scheduledReportPayload(
  storage: AppStorage,
  schedule: ReportSchedule,
  now: Date,
  delivery: ReportBuildPort
): Promise<ReportPayload> {
  const projectId = schedule.projectId ?? firstOpenProjectId(storage)
  const name = projectId === null ? null : (getProject(storage.db, projectId)?.name ?? null)
  const market = schedule.marketIds.length === 1 ? (schedule.marketIds[0] ?? null) : null
  const scoped = withReportMarkets(storage, schedule, projectId)
  const pageIds = scheduleScopePageIds(storage, schedule, projectId, delivery.logger)
  if (schedule.report && projectId !== null) {
    const ready = await readyReportEmail(storage, scoped, projectId, now, delivery)
    return {
      facts: {
        project: name,
        dateRange: localDateKey(now.getTime(), schedule.timeZone),
        market,
        score: projectScore(storage, projectId),
        lines: ready.lines
      },
      attachment: ready.attachment
    }
  }
  return {
    facts: {
      project: name,
      dateRange: localDateKey(now.getTime(), schedule.timeZone),
      market,
      score: projectId === null ? null : projectScore(storage, projectId),
      lines: await summaryLines(storage, scoped, projectId, pageIds, name, now, delivery)
    },
    attachment: await reportFile(storage, scoped, projectId, pageIds, now, delivery)
  }
}

/**
 * A schedule that sends a ready report: its PDF (offline HTML for `html_link`, or when
 * no printer is set up) built exactly as Reports' Download builds it, and its headline
 * as the body. A summary-only schedule still gets the body and no file.
 */
async function readyReportEmail(
  storage: AppStorage,
  schedule: ReportSchedule,
  projectId: string,
  now: Date,
  delivery: ReportBuildPort
): Promise<{ lines: string[]; attachment: ReportPayload['attachment'] }> {
  const project = getProject(storage.db, projectId)
  if (project === null || !schedule.report) throw new Error('The project is gone.')
  const sender = readReportSender(storage.paths.root)
  const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
  try {
    const built = await buildReadyReportEmail(
      db,
      project,
      {
        report: schedule.report,
        scope: schedule.scope ?? null,
        marketIds: schedule.marketIds,
        timeZone: schedule.timeZone,
        html: schedule.format === 'html_link'
      },
      now,
      {
        from: { sender, brandIcon: (domain) => cachedSiteIcon(storage.paths.root, domain) },
        printer: reviewPdfPrinter(),
        secrets: delivery.redacted ?? [],
        preparedBy: senderEmailName(sender)
      }
    )
    return {
      lines: built.lines,
      attachment: schedule.format === 'summary' ? null : built.attachment
    }
  } finally {
    closeProjectDatabase(db)
  }
}

/**
 * The plain-text email body (Docs/REPORT-SPEC.md): headline, score and change, what
 * changed, top 3 actions and the attachment, from the same report model as the file.
 */
async function summaryLines(
  storage: AppStorage,
  schedule: ReportSchedule,
  projectId: string | null,
  pageIds: readonly string[] | null,
  name: string | null,
  now: Date,
  delivery: ReportBuildPort
): Promise<string[]> {
  const fallback = [name === null ? 'Scheduled report' : `${name} report`]
  if (projectId === null) return fallback
  const loaded = await loadReportModel({
    request: reportModelRequest(schedule, projectId, pageIds),
    source: createStorageExportSource({
      app: storage.db,
      projectsDirectory: storage.paths.projectsDirectory,
      now: () => now
    }),
    now: () => now,
    builders: reportBuilders(storage, projectId, now, delivery)
  })
  if (!loaded.ok) return fallback
  const secrets = delivery.redacted ?? []
  const preparedBy = senderEmailName(readReportSender(storage.paths.root))
  return reportSummaryLines(loaded.model, schedule.format, preparedBy).map((line) =>
    redactString(line, { secrets, hexKeys: false })
  )
}

async function reportFile(
  storage: AppStorage,
  schedule: ReportSchedule,
  projectId: string | null,
  pageIds: readonly string[] | null,
  now: Date,
  delivery: ReportBuildPort
): Promise<ReportPayload['attachment']> {
  if (projectId === null) return null
  const request = reportExportRequest(schedule, projectId, pageIds)
  if (request === null) return null
  const directory = mkdtempSync(join(tmpdir(), 'citefox-due-report-'))
  try {
    const written = await startExport({
      request,
      source: createStorageExportSource({
        app: storage.db,
        projectsDirectory: storage.paths.projectsDirectory,
        now: () => now
      }),
      directory,
      secrets: delivery.redacted ?? [],
      now: () => now,
      builders: reportBuilders(storage, projectId, now, delivery)
    })
    if (!written.ok) {
      throw new Error(written.reason)
    }
    return {
      filename: written.filename,
      contentType: reportContentType(schedule.format),
      bytes: readFileSync(written.filePath)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** The same section builders the Export screen uses, so the email and the file agree. */
function reportBuilders(
  storage: AppStorage,
  projectId: string,
  now: Date,
  delivery: ReportBuildPort
): ReturnType<typeof storageReportBuilders> {
  return storageReportBuilders(
    {
      app: storage.db,
      projectsDirectory: storage.paths.projectsDirectory,
      now: () => now,
      logger: delivery.logger
    },
    projectId
  )
}

/**
 * A schedule with no markets picked reports each project's default market (the form says
 * "Each project's default market"); the export needs the market ids themselves.
 */
export function withReportMarkets(
  storage: AppStorage,
  schedule: ReportSchedule,
  projectId: string | null
): ReportSchedule {
  if (schedule.marketIds.length > 0 || projectId === null) return schedule
  const project = getProject(storage.db, projectId)
  if (project === null) return schedule
  const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
  try {
    const market = readProjectProfile(db)?.market
    return market === undefined ? schedule : { ...schedule, marketIds: [market.id] }
  } finally {
    closeProjectDatabase(db)
  }
}

function firstOpenProjectId(storage: AppStorage): string | null {
  const open = listProjects(storage.db).find((project) => !projectIsPaused(storage, project.id))
  return open?.id ?? null
}

function projectIsPaused(storage: AppStorage, projectId: string | null): boolean {
  if (projectId === null) {
    const projects = listProjects(storage.db)
    return projects.length > 0 && projects.every((project) => projectIsPaused(storage, project.id))
  }
  const project = getProject(storage.db, projectId)
  if (project === null || project.status === 'paused' || project.status === 'archived') return true
  const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
  try {
    return readProjectSchedule(db, project.id).paused
  } finally {
    closeProjectDatabase(db)
  }
}

function projectScore(storage: AppStorage, projectId: string): string | null {
  const project = getProject(storage.db, projectId)
  if (project === null) return null
  const db = openProjectDatabase(storage.paths.projectsDirectory, project.slug)
  try {
    const scores = listPagesOfKind(db, project.id, 'page')
      .map((page) => page.score)
      .filter((score): score is number => score !== null)
    const score = scores[0]
    if (scores.length !== 1 || score === undefined) return null
    return String(score)
  } finally {
    closeProjectDatabase(db)
  }
}
