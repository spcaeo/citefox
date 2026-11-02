/**
 * "What CiteFox needs": one checklist of every permission and connection, with
 * its live state (owner feedback #2). `permissions:list` only reads saved state:
 * it never opens a system prompt. `permissions:request` runs one item's action,
 * and only the renderer calls it, after the user clicked and read what the
 * system will ask (`PermissionItem.osPrompt`). No payload carries a secret.
 */

import { invoke, invokeWith, type InvokeChannelSpecs } from './contract'

export const PERMISSION_IDS = [
  'claude',
  'serpapi',
  'jina',
  'keychain',
  'notifications',
  'background',
  'loginItem',
  'exportFolder',
  'email'
] as const

export type PermissionId = (typeof PERMISSION_IDS)[number]

/** Items `permissions:request` can run. The others are set up on their own screen. */
export const REQUESTABLE_PERMISSIONS = [
  'claude',
  'keychain',
  'notifications',
  'background',
  'loginItem'
] as const satisfies readonly PermissionId[]

export type RequestablePermissionId = (typeof REQUESTABLE_PERMISSIONS)[number]

/** `required`: checks cannot run without it. `optional`: nice to have. `if_used`: only for a feature you turn on. */
export type PermissionNeed = 'required' | 'optional' | 'if_used'

/**
 * `ok` works. `action` needs a step from you. `off` is not set up (fine when optional).
 * `unchecked` is saved but not tested yet. `not_needed` means nothing to grant on
 * this computer, or the feature is not in use.
 */
export type PermissionState = 'ok' | 'action' | 'off' | 'unchecked' | 'not_needed'

export type PermissionPlatform = 'darwin' | 'win32' | 'linux' | 'other'

/** One sub-check under an item, such as Claude Code's "CLI found". */
export interface PermissionCheck {
  label: string
  state: 'ok' | 'warning' | 'skipped' | 'pending'
  detail: string
}

export interface PermissionAction {
  /**
   * `request`: the renderer calls `permissions:request` (main may show a system prompt).
   * `setup`: the renderer opens the screen or step where this is set up.
   */
  kind: 'request' | 'setup'
  label: string
}

export interface PermissionItem {
  id: PermissionId
  title: string
  /** What CiteFox uses it for, in one sentence. */
  purpose: string
  need: PermissionNeed
  state: PermissionState
  /** Short state text, such as "Signed in · Claude Max". */
  statusLabel: string
  /** A second line, such as the next step. Null when there is nothing to add. */
  detail: string | null
  checks: readonly PermissionCheck[]
  /**
   * Shown before the action runs: the system prompt that will appear and what to
   * choose ("Always Allow"). Null when the action shows no system prompt.
   */
  osPrompt: string | null
  action: PermissionAction | null
}

/**
 * The Claude connection AI features use right now (Settings, or a project's own),
 * for the status chip shown wherever AI runs. Never a secret or an account email.
 */
export interface ClaudeStatus {
  connection: 'claude-code' | 'anthropic-api' | 'codex'
  state: 'ready' | 'needs_setup' | 'unchecked'
  /** "Claude Code" or "Anthropic API key". */
  name: string
  /** "connected", "not found", "not signed in", "not checked yet", "test call failed", "no key". */
  summary: string
  /** Plan name such as "Claude Max". Null when unknown. */
  plan: string | null
  /** Friendly model name, such as "Sonnet 4.5". Null when unknown. */
  model: string | null
  /** ISO-8601 UTC of the last Claude Code checkup or key test. Null when never run. */
  checkedAt: string | null
  /** True when the last checkup is recent enough to trust without running it again. */
  fresh: boolean
  /** NFR-10 next step when `state` is not `ready`. */
  nextStep: string | null
}

export interface PermissionsSnapshot {
  platform: PermissionPlatform
  items: readonly PermissionItem[]
  claude: ClaudeStatus
  /** Required items that are not `ok`. */
  requiredOpen: number
  /** Items that are `ok` or `not_needed`. */
  readyCount: number
  /** ISO-8601 UTC when main built this snapshot. */
  checkedAt: string
}

export interface PermissionRequest {
  id: PermissionId
}

export interface PermissionRequestResult {
  snapshot: PermissionsSnapshot
  ok: boolean
  /** Plain words for the result, such as "Notifications are on." */
  message: string
}

export function isPermissionId(value: string): value is PermissionId {
  return PERMISSION_IDS.some((item) => item === value)
}

export function isRequestablePermission(value: string): value is RequestablePermissionId {
  return REQUESTABLE_PERMISSIONS.some((item) => item === value)
}

/** Invoke channels for this area. Each one is declared here only. */
export const permissionsChannels = {
  'permissions:list': invoke<PermissionsSnapshot>(),
  'permissions:request': invokeWith<PermissionRequest, PermissionRequestResult>()
} as const satisfies InvokeChannelSpecs
