/** Scheduled reports and delivery history. */

import type {
  DeliveryRecord,
  EmailTestResult,
  ReportSchedule,
  ReportScheduleListItem,
  ReportScheduleStatus
} from '../domain'
import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'

/** `reports:setStatus`. */
export interface SetReportScheduleStatusRequest {
  id: string
  status: ReportScheduleStatus
}

/**
 * `reports:sendTest`.
 * `accountId` null uses the default sending account (FR-23.5).
 */
export interface SendReportTestRequest {
  scheduleId: string
  accountId: string | null
}

/**
 * Why `reports:delete` was rejected.
 * The message is a fixed sentence. It does not include the request.
 */
export const REPORT_ERROR_CODES = ['not_found'] as const

export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[number]

/** Fixed sentences for {@link ReportErrorCode}. The engine does not paraphrase these. */
export const REPORT_ERROR_MESSAGES = {
  not_found: 'That schedule does not exist or is already deleted.'
} as const satisfies Record<ReportErrorCode, string>

export const REPORT_ERROR_CHANNELS = ['reports:delete'] as const

export type ReportErrorChannel = (typeof REPORT_ERROR_CHANNELS)[number]

export function isReportErrorChannel(value: string): value is ReportErrorChannel {
  return REPORT_ERROR_CHANNELS.some((item) => item === value)
}

/**
 * Structured rejection for `reports:delete`.
 * `message` is the fixed sentence for `code`.
 * The string form on the existing IPC error path is `${channel}: ${message}`.
 * `not_found` means the schedule does not exist or is already deleted.
 */
export type ReportContractError = {
  [Code in ReportErrorCode]: {
    channel: ReportErrorChannel
    code: Code
    message: (typeof REPORT_ERROR_MESSAGES)[Code]
  }
}[ReportErrorCode]

export function isReportErrorCode(value: string): value is ReportErrorCode {
  return REPORT_ERROR_CODES.some((item) => item === value)
}

/**
 * `reports:delete`.
 * This is a soft delete. `projectId` null is an all-projects schedule.
 * Deleted schedules drop out of the reports list,
 * are skipped by `citefox --check-due`, and never deliver.
 */
export interface DeleteReportScheduleRequest {
  /** Null is an all-projects schedule. */
  projectId: string | null
  scheduleId: string
}

/**
 * `reports:delete`.
 * Success is `{ ok: true, deletedAt }`. `deletedAt` is an ISO-8601 timestamp.
 * {@link ReportContractError} `not_found` is returned when the schedule does not
 * exist or is already deleted.
 */
export type DeleteReportScheduleResult =
  | {
      ok: true
      /** ISO-8601 timestamp. */
      deletedAt: string
    }
  | ReportContractError

/**
 * `reports:sendNow`. Builds the schedule's report now (summary and file, the same
 * way the scheduled send does) and emails it to the schedule's recipients from the
 * schedule's account. Records a delivery (occurrence key `now:<id>`). Does not move
 * the next scheduled send. A paused schedule still sends: the user asked for it.
 */
export interface SendReportNowRequest {
  scheduleId: string
}

/** `deliveries:list`. Omit `scheduleId` to list every delivery (FR-23.11). */
export interface ListDeliveriesRequest {
  scheduleId?: string
}

/** `deliveries:resend`. */
export interface ResendDeliveryRequest {
  id: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const reportsChannels = {
  'reports:list': invoke<readonly ReportScheduleListItem[]>(),
  'reports:save': invokeWith<ReportSchedule, ReportScheduleListItem>(),
  'reports:setStatus': invokeWith<SetReportScheduleStatusRequest, ReportScheduleListItem>(),
  'reports:sendTest': invokeWith<SendReportTestRequest, EmailTestResult>(),
  'reports:delete': invokeWith<DeleteReportScheduleRequest, DeleteReportScheduleResult>(),
  'reports:sendNow': invokeWith<SendReportNowRequest, DeliveryRecord>(),
  'deliveries:list': invokeWith<ListDeliveriesRequest, readonly DeliveryRecord[]>(),
  'deliveries:resend': invokeWith<ResendDeliveryRequest, DeliveryRecord>()
} as const satisfies InvokeChannelSpecs
