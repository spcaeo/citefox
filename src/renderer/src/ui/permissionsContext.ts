import { createContext, useContext } from 'react'
import type {
  ClaudeCheckupPhase,
  ClaudeCheckupProgress,
  ClaudeCheckupProgressState,
  ClaudeStatus,
  PermissionId,
  PermissionRequestResult,
  PermissionsSnapshot
} from '@shared/ipc'

/**
 * "What CiteFox needs" and the Claude connection, shared by every screen
 * (`permissions/PermissionsProvider.tsx` at the app root). Components read it
 * with {@link usePermissions}; outside a provider (component tests) it is null
 * and the Claude chip renders nothing.
 */
export interface PermissionsContextValue {
  snapshot: PermissionsSnapshot | null
  /** The Claude connection AI features use now. Null until the first read. */
  claude: ClaudeStatus | null
  /** True until the first snapshot (or its error) arrives. */
  loading: boolean
  error: string | null
  /** A Claude Code checkup is running. */
  checking: boolean
  /** The checkup's latest phase while `checking`. */
  progress: ClaudeCheckupProgress | null
  /** Each checkup phase seen in the current (or last) check CiteFox ran. */
  steps: CheckupSteps
  /** The item whose action is running. */
  busy: PermissionId | null
  /** The last action's message, for a live region. */
  message: string | null
  refresh(): Promise<PermissionsSnapshot | null>
  /** Runs the Claude Code checkup (or re-reads the API key state) and returns the new status. */
  checkClaude(): Promise<ClaudeStatus | null>
  /**
   * The status an AI action can trust: the cached one when ready and fresh,
   * else the result of a new checkup.
   */
  ensureClaude(): Promise<ClaudeStatus | null>
  /** Runs one item's action. Call only after a click and its explanation. */
  request(id: PermissionId): Promise<PermissionRequestResult | null>
}

export type CheckupSteps = Partial<
  Record<ClaudeCheckupPhase, { state: ClaudeCheckupProgressState; detail: string }>
>

export const PermissionsContext = createContext<PermissionsContextValue | null>(null)

export function usePermissions(): PermissionsContextValue | null {
  return useContext(PermissionsContext)
}
