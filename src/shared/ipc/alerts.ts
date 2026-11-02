/** Per-project alert settings, alert rules, the alert log and the Slack test. */

import type { AlertSettings } from '../domain'
import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/**
 * `alerts:update`. Omitted fields stay as they are.
 * `slackWebhook` is write-only. Null leaves the stored URL. An empty string clears it.
 * The URL is never returned (NFR-5).
 */
export interface UpdateAlertSettingsRequest {
  projectId: string
  desktop?: boolean
  emailAfterCheck?: boolean
  emailAccountId?: string | null
  emailTo?: readonly string[]
  slackEnabled?: boolean
  slackWebhook?: string | null
  monthlyClientPdf?: boolean
  /**
   * Null clears the monthly PDF recipient. Omit to leave the stored address.
   * One address, or null. A comma-separated list is invalid.
   */
  monthlyPdfTo?: string | null
}

/**
 * What makes a rule fire, read against two checks of the same page in the same market:
 * - `citation_lost`: a question that cited the page no longer does.
 * - `citation_gained`: a question cites the page that did not before.
 * - `score_drop`: the page's score fell by `scoreDrop` points or more.
 * - `competitor_cited`: a competitor (`competitorDomain`, or any saved competitor when
 *   null) is cited on a question that does not cite the page, and was not before.
 * - `wrong_page`: another page of the site is cited where this page should be.
 * - `check_failed`: the check ended in an error, or every question failed.
 * - `aio_gone`: a question that showed an AI Overview shows none now.
 */
export const ALERT_RULE_WHENS = [
  'citation_lost',
  'citation_gained',
  'score_drop',
  'competitor_cited',
  'wrong_page',
  'check_failed',
  'aio_gone'
] as const

export type AlertRuleWhen = (typeof ALERT_RULE_WHENS)[number]

/** The scope kinds a rule can watch (a subset of the renderer's `Scope`). */
export const ALERT_SCOPE_KINDS = ['tracked', 'pages', 'group', 'cluster', 'topic'] as const

export type AlertScopeKind = (typeof ALERT_SCOPE_KINDS)[number]

export interface AlertRuleScope {
  kind: AlertScopeKind
  /** Picked ids for `pages`, `group`, `cluster`, `topic`. Empty for `tracked`. */
  ids: readonly string[]
}

/** `instant`: right after the check. `digest`: one message a day with everything that fired. */
export const ALERT_DELIVERIES = ['instant', 'digest'] as const

export type AlertDelivery = (typeof ALERT_DELIVERIES)[number]

export const ALERT_RULE_STATUSES = ['active', 'paused'] as const

export type AlertRuleStatus = (typeof ALERT_RULE_STATUSES)[number]

/** Default for "Score drops by [N] or more". */
export const DEFAULT_SCORE_DROP = 10

/** The rule fields a person edits (also what a dry run reads). */
export interface AlertRuleInput {
  name: string
  when: AlertRuleWhen
  /** `score_drop` only: 1–100 points. Null for the other kinds. */
  scoreDrop: number | null
  /** `competitor_cited` only: a bare domain, or null for any saved competitor. */
  competitorDomain: string | null
  scope: AlertRuleScope
  /** Empty: every market. */
  marketIds: readonly string[]
  desktop: boolean
  /** Every address gets the alert. Empty: no email. */
  emailTo: readonly string[]
  /** Posts through the project's Slack webhook (Notifications). */
  slack: boolean
  delivery: AlertDelivery
}

export interface AlertRule extends AlertRuleInput {
  id: string
  projectId: string
  status: AlertRuleStatus
  /** ISO-8601 UTC. */
  createdAt: string
  updatedAt: string
  /** Last entry in the alert log. Null before the rule first fires. */
  lastFiredAt: string | null
  /** Entries in the alert log for this rule. */
  firedCount: number
}

export interface AlertRuleList {
  projectId: string
  rules: readonly AlertRule[]
  /** True when the project has a Slack webhook saved (Notifications). */
  slackReady: boolean
}

/** `alerts:saveRule`. Null `id` creates a rule; `status` defaults to `active` on create. */
export interface SaveAlertRuleRequest extends AlertRuleInput {
  projectId: string
  id: string | null
  status?: AlertRuleStatus
}

/** `alerts:deleteRule` and `alerts:setRuleStatus` take one or many ids (bulk). */
export interface AlertRuleIdsRequest {
  projectId: string
  ids: readonly string[]
}

export interface SetAlertRuleStatusRequest extends AlertRuleIdsRequest {
  status: AlertRuleStatus
}

export interface AlertRuleIdsResult {
  ids: readonly string[]
}

/** One change a rule matched: one page, one market, one check. */
export interface AlertEvent {
  /** When the check finished, ISO-8601 UTC. */
  at: string
  pageId: string
  pageLabel: string
  /** Null for a topic (checked as its own subject). */
  pageUrl: string | null
  marketId: string
  runId: string
  when: AlertRuleWhen
  /** One line: "Target page no longer cited on 2 questions". */
  summary: string
  /** Up to five details: the questions, the competitor, the score move. */
  details: readonly string[]
}

/** `alerts:dryRun`: the rule as it stands in the drawer, saved or not. */
export interface AlertDryRunRequest {
  projectId: string
  rule: AlertRuleInput
  /** Default 30. */
  days?: number
}

export interface AlertDryRunResult {
  days: number
  /** Times the rule would have fired: one per matching page, market and check. */
  fired: number
  /** Checks read (pages × markets × checks in the window). */
  checksRead: number
  /** Newest first, at most 100. */
  events: readonly AlertEvent[]
}

/** One fired alert, kept in the project's alert log. */
export interface AlertLogEntry extends AlertEvent {
  id: string
  ruleId: string
  /** The rule's name when it fired (kept after the rule is renamed or deleted). */
  ruleName: string
  /** Where it went: "Desktop", "2 emails", "Slack"; "Waiting for the daily digest". */
  deliveredTo: readonly string[]
}

export interface AlertLogRequest {
  projectId: string
  /** Only this rule's entries. */
  ruleId?: string | null
  /** Default 200, at most 500. */
  limit?: number
}

export interface AlertLog {
  projectId: string
  entries: readonly AlertLogEntry[]
}

/** `alerts:testSlack`. Without `webhook` the saved one is used; a new URL is not saved. */
export interface TestSlackRequest {
  projectId: string
  webhook?: string
}

export interface TestSlackResult {
  ok: boolean
  /** ISO-8601 UTC. */
  testedAt: string
  /** "Posted to Slack." or why it failed, never the URL. */
  message: string
}

/** Invoke channels for this area. Each one is declared here only. */
export const alertsChannels = {
  'alerts:get': invokeWith<ProjectIdRequest, AlertSettings>(),
  'alerts:update': invokeWith<UpdateAlertSettingsRequest, AlertSettings>(),
  'alerts:testSlack': invokeWith<TestSlackRequest, TestSlackResult>(),
  'alerts:listRules': invokeWith<ProjectIdRequest, AlertRuleList>(),
  'alerts:saveRule': invokeWith<SaveAlertRuleRequest, AlertRule>(),
  'alerts:deleteRule': invokeWith<AlertRuleIdsRequest, AlertRuleIdsResult>(),
  'alerts:setRuleStatus': invokeWith<SetAlertRuleStatusRequest, AlertRuleIdsResult>(),
  'alerts:dryRun': invokeWith<AlertDryRunRequest, AlertDryRunResult>(),
  'alerts:listLog': invokeWith<AlertLogRequest, AlertLog>()
} as const satisfies InvokeChannelSpecs
