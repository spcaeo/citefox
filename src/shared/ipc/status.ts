/** The status capsule. */

import type { ConnectionState } from '../domain'
import { invoke, type InvokeChannelSpecs } from './contract'

/**
 * Basic status capsule (FR-24.1, M1). The full Status screen is M5.
 * `issueCount` counts `warning` among the four connections. `off` and `unchecked` are not issues.
 * `searchesLeft` is null when CiteFox cannot name a remaining number.
 */
export interface StatusCapsule {
  searchesLeft: number | null
  issueCount: number
  serpapi: ConnectionState
  claudeCode: ConnectionState
  jina: ConnectionState
  youtube: ConnectionState
}

/** Invoke channels for this area. Each one is declared here only. */
export const statusChannels = {
  'status:getCapsule': invoke<StatusCapsule>()
} as const satisfies InvokeChannelSpecs
