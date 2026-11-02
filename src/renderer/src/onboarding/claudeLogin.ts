import type { ClaudeCheckupResult, ConnectionsOverview } from '@shared/ipc'

/** Checkup result from the shared contract, including `login: 'api_key'`. */
export type OnboardingCheckupResult = ClaudeCheckupResult

/** Connections snapshot from the shared contract. */
export type OnboardingConnections = ConnectionsOverview

/** Exact status label for `login: 'api_key'`. */
export const API_KEY_LOGIN_LABEL = 'API key only'

export function loginStatusLabel(result: ClaudeCheckupResult): string {
  if (result.login === 'api_key') return API_KEY_LOGIN_LABEL
  return result.rows.login.statusLabel
}
