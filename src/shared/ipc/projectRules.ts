/**
 * Two owner decisions that live in each project's database (project migration 057):
 *
 * - Project rules: the owner's standing instructions ("don't call us a cloud
 *   service"), saved from a setup card's Redo box or typed in Project settings ›
 *   Project rules. Every later AI prompt for the project carries the rules that are on.
 * - Tracking changes: what the owner changed in what CiteFox tracks. The charts mark
 *   them in grey, one marker per day, so a jump from tracking more is never read as a fix.
 */

import { invokeWith, type InvokeChannelSpecs } from './contract'
import type { ProjectIdRequest } from './projects'

/** Longest rule, in characters. */
export const PROJECT_RULE_MAX = 300
/** Most rules one project keeps. */
export const PROJECT_RULES_MAX = 40

export interface ProjectRule {
  id: string
  text: string
  /** Off: kept in the list, left out of prompts. */
  enabled: boolean
  /** ISO-8601 UTC. */
  createdAt: string
  updatedAt: string
}

export interface ProjectRuleList {
  projectId: string
  /** Oldest first. */
  rules: readonly ProjectRule[]
}

/** `projectRules:save`: a new rule (`id` null) or an edit. Saving a rule already listed keeps one. */
export interface SaveProjectRuleRequest {
  projectId: string
  id: string | null
  text: string
  enabled: boolean
}

export interface ProjectRuleIdRequest {
  projectId: string
  id: string
}

export const TRACKING_CHANGE_KINDS = [
  'questions_added',
  'questions_removed',
  'engine_on',
  'engine_off',
  'market_added',
  'schedule_changed'
] as const

export type TrackingChangeKind = (typeof TRACKING_CHANGE_KINDS)[number]

export function isTrackingChangeKind(value: unknown): value is TrackingChangeKind {
  return TRACKING_CHANGE_KINDS.some((kind) => kind === value)
}

/** One change to what CiteFox tracks. */
export interface TrackingChange {
  id: string
  /** ISO-8601 UTC. */
  at: string
  kind: TrackingChangeKind
  /** The page or topic whose questions changed; null for the whole project. */
  pageId: string | null
  /** Questions added or removed; 1 otherwise. */
  count: number
  /**
   * Plain words for the change: an engine's name ("ChatGPT"), a market ("UK · EN"),
   * the new schedule ("every 7 days at 09:00"). Null for questions.
   */
  detail: string | null
}

export interface TrackingChangeList {
  projectId: string
  /** Oldest first. */
  changes: readonly TrackingChange[]
}

/** Invoke channels for this area. Each one is declared here only. */
export const projectRulesChannels = {
  'projectRules:list': invokeWith<ProjectIdRequest, ProjectRuleList>(),
  'projectRules:save': invokeWith<SaveProjectRuleRequest, ProjectRuleList>(),
  'projectRules:delete': invokeWith<ProjectRuleIdRequest, ProjectRuleList>(),
  'tracking:changes': invokeWith<ProjectIdRequest, TrackingChangeList>()
} as const satisfies InvokeChannelSpecs
