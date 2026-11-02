import { DEFAULT_SERPAPI_ROTATION, serpKeyAllowance } from '@shared/domain'
import type { ApiKeyProvider, ConnectionState, SerpApiRotationMode } from '@shared/domain'
import type { ApiKeyMetadata } from '@shared/domain'
import type { ClaudeCheckupResult, ConnectionsOverview, StatusCapsule } from '@shared/ipc'

/**
 * Rolled-up connection for one provider.
 * No row, or a key the user switched off, is `off`.
 * A saved key that has never been tested is `unchecked`.
 * A stored `off` from an older test is shown as `warning`: `off` is only
 * "no key" or "user disabled" (lead decision).
 */
export function providerConnection(
  keys: readonly ApiKeyMetadata[],
  provider: ApiKeyProvider
): ConnectionState {
  const key = keys.find((item) => item.provider === provider)
  if (key === undefined || !key.on) return 'off'
  if (key.state === 'unchecked') return 'unchecked'
  if (key.state === 'off') return 'warning'
  return key.state
}

/** No checkup yet is `unchecked`. Ready is `ok`. Anything else needs a next step. */
export function claudeCodeConnection(checkup: ClaudeCheckupResult | null): ConnectionState {
  if (checkup === null) return 'unchecked'
  if (checkup.ready) return 'ok'
  return 'warning'
}

/**
 * Searches still available this month across tested, enabled SerpApi keys.
 * Null when none of those keys has a plan allowance or a cap.
 * A CiteFox cap counts CiteFox's own searches; the plan counts the whole account;
 * the tighter remaining number wins (`serpKeyAllowance`).
 */
export function searchesLeft(keys: readonly ApiKeyMetadata[]): number | null {
  let total = 0
  let any = false
  for (const key of keys) {
    if (key.provider !== 'serpapi' || !key.on || key.state === 'unchecked') continue
    const allowance = serpKeyAllowance(key)
    if (allowance === null) continue
    any = true
    total += allowance.left
  }
  return any ? total : null
}

export function issueCount(
  states: Pick<StatusCapsule, 'serpapi' | 'claudeCode' | 'jina' | 'youtube'>
): number {
  return [states.serpapi, states.claudeCode, states.jina, states.youtube].filter(
    (state) => state === 'warning'
  ).length
}

export function buildConnectionsOverview(input: {
  keys: readonly ApiKeyMetadata[]
  checkup: ClaudeCheckupResult | null
  rotation?: SerpApiRotationMode
}): ConnectionsOverview {
  const serpapi = providerConnection(input.keys, 'serpapi')
  const claudeCode = claudeCodeConnection(input.checkup)
  const jina = providerConnection(input.keys, 'jina')
  const youtube = providerConnection(input.keys, 'youtube')
  const states = { serpapi, claudeCode, jina, youtube }
  return {
    serpapiRotation: input.rotation ?? DEFAULT_SERPAPI_ROTATION,
    keys: input.keys,
    ...states,
    claudeCheckup: input.checkup,
    searchesLeft: searchesLeft(input.keys),
    issueCount: issueCount(states)
  }
}

export function statusCapsuleFromOverview(overview: ConnectionsOverview): StatusCapsule {
  return {
    searchesLeft: overview.searchesLeft,
    issueCount: overview.issueCount,
    serpapi: overview.serpapi,
    claudeCode: overview.claudeCode,
    jina: overview.jina,
    youtube: overview.youtube
  }
}
