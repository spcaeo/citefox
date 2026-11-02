import type { PermissionId, PermissionItem, PermissionNeed, PermissionState } from '@shared/ipc'
import type { ChipTone } from '../ui'

export const NEED_ORDER: readonly PermissionNeed[] = ['required', 'optional', 'if_used']

const NEED_LABEL: Readonly<Record<PermissionNeed, string>> = {
  required: 'Required',
  optional: 'Optional',
  if_used: 'Only if used'
}

const STATE_WORD: Readonly<Record<PermissionState, string>> = {
  ok: 'Ready',
  action: 'Needs a step',
  off: 'Off',
  unchecked: 'Not checked',
  not_needed: 'Nothing to do'
}

const STATE_TONE: Readonly<Record<PermissionState, ChipTone>> = {
  ok: 'ok',
  action: 'warn',
  off: 'neutral',
  unchecked: 'info',
  not_needed: 'neutral'
}

/** Severity for sorting: what needs you first. */
const STATE_RANK: Readonly<Record<PermissionState, number>> = {
  action: 0,
  unchecked: 1,
  off: 2,
  ok: 3,
  not_needed: 4
}

export function needLabel(need: PermissionNeed): string {
  return NEED_LABEL[need]
}

export function stateWord(state: PermissionState): string {
  return STATE_WORD[state]
}

export function stateTone(state: PermissionState): ChipTone {
  return STATE_TONE[state]
}

export function stateRank(state: PermissionState): number {
  return STATE_RANK[state]
}

/** Items grouped by need, in the snapshot's order inside each group. Empty groups are dropped. */
export function groupByNeed(
  items: readonly PermissionItem[]
): { need: PermissionNeed; items: PermissionItem[] }[] {
  return NEED_ORDER.map((need) => ({
    need,
    items: items.filter((item) => item.need === need)
  })).filter((group) => group.items.length > 0)
}

/** Where a `setup` action opens in the app (outside onboarding). */
export const SETUP_HREF: Readonly<Partial<Record<PermissionId, string>>> = {
  claude: '#/connections?tab=claude',
  serpapi: '#/connections?tab=serpapi',
  jina: '#/connections?tab=jina',
  exportFolder: '#/export',
  email: '#/settings?tab=email'
}

/** The permissions page, optionally with one item open. */
export function permissionsHash(id?: PermissionId | null): string {
  return id ? `#/permissions/${id}` : '#/permissions'
}
