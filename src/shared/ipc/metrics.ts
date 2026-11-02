/**
 * The shared metrics layer over IPC (Docs/METRICS.md): every number the reports and the
 * analysis screens need for one scope, market, engine and window, each with the rows
 * behind it. Read-only: it spends no searches.
 */

import type { MetricEngine, MetricScope, MetricsResult } from '../metrics/types'
import type { ReportBranding, ReportExtras } from '../report/review/extras'
import type { ReportSender } from '../report/review/sender'
import type { ReportKind } from '../report/review/types'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'

/**
 * `reports:metrics`. `marketId` null: each page and topic in its default market.
 * `to` null: the latest check. `from` null: latest only; `previous`: each page and topic
 * against its check before the latest; `first`: the first check in scope (merge.ts
 * `firstCheckAt`). Otherwise `from` and `to` are a run id (the moment
 * that check finished), a `YYYY-MM-DD` day (the end of that day, UTC) or an ISO-8601 time.
 */
export interface MetricsRequest {
  projectId: string
  scope: MetricScope
  marketId: string | null
  engine: MetricEngine
  from: string | null
  to: string | null
}

export type { MetricsResult }

/**
 * `reports:review`: a ready report's numbers (`reports:metrics`, same request) and its
 * extras (backlinks, page changes, owners, answer shapes, "Prepared for"), read once.
 */
export interface ReviewDataResult {
  metrics: MetricsResult
  extras: ReportExtras
}

/** `reports:setBranding`: the "Prepared for" line. An empty name and no logo clears it. */
export interface ReportBrandingRequest extends ReportBranding {
  projectId: string
}

/** The tables a ready report saves on their own as CSV. */
export const REPORT_TABLES = [
  'questions',
  'pages',
  'competitors',
  'topics',
  'notindexed',
  'backlinks',
  'sitekinds',
  // The Visibility report: target pages, other own pages, wrong claims, answer by answer.
  'targetpages',
  'otherpages',
  'claims',
  'answers',
  'youtube',
  'reddit',
  'linkedin',
  // Content plan: one row per question to win.
  'contentplan'
] as const
export type ReportTable = (typeof REPORT_TABLES)[number]

/**
 * `reports:download`: a ready report (Docs/REPORT-SPEC.md "Ready reports") as one offline
 * HTML file, a PDF (the same file printed, every table in full), or one table as CSV. The
 * numbers come from `reports:metrics` with the same request, so the file and the app
 * agree. Main opens the save dialog; the renderer never sends a path.
 */
export interface ReportDownloadRequest extends MetricsRequest {
  report: ReportKind
  format: 'html' | 'pdf' | 'csv'
  /** Required for `csv`. */
  table: ReportTable | null
  /** IANA zone the dates are written in, such as `America/Toronto`. */
  timeZone: string
  /** Head-to-head: the rival's domain (`rival=` on the URL). Absent: the top competitor. */
  rival?: string | null
}

export type ReportDownloadResult =
  | { ok: true; filePath: string; filename: string; bytes: number }
  | { ok: false; reason: string; nextStep: string | null }

/** Invoke channels for this area. Each one is declared here only. */
export const metricsChannels = {
  'reports:metrics': invokeWith<MetricsRequest, MetricsResult>(),
  'reports:download': invokeWith<ReportDownloadRequest, ReportDownloadResult>(),
  'reports:review': invokeWith<MetricsRequest, ReviewDataResult>(),
  'reports:getBranding': invokeWith<{ projectId: string }, ReportBranding>(),
  'reports:setBranding': invokeWith<ReportBrandingRequest, ReportBranding>(),
  /** Settings › Reports: who the reports are from (app-wide, every project). */
  'reports:getSender': invoke<ReportSender>(),
  'reports:setSender': invokeWith<ReportSender, ReportSender>()
} as const satisfies InvokeChannelSpecs
