import { OVERLAY_PARAM } from '../shell/routes'

/**
 * A red ⋯ item's confirm lives on the URL as `?dialog=head-<id>` (owner rule:
 * every state has a URL), next to the build menu's `?dialog=reset`.
 */
const CONFIRM_PREFIX = 'head-'

function split(hash: string): { path: string; params: URLSearchParams } {
  const plain = hash.startsWith('#') ? hash.slice(1) : hash
  const at = plain.indexOf('?')
  return at < 0
    ? { path: plain, params: new URLSearchParams() }
    : { path: plain.slice(0, at), params: new URLSearchParams(plain.slice(at + 1)) }
}

/** `hash` with the header confirm for `id` set, or cleared when null. */
export function withHeaderConfirm(hash: string, id: string | null): string {
  const { path, params } = split(hash)
  if (id) params.set(OVERLAY_PARAM, `${CONFIRM_PREFIX}${id}`)
  else params.delete(OVERLAY_PARAM)
  const query = params.toString()
  return `#${path}${query ? `?${query}` : ''}`
}

/** The ⋯ item whose confirm the URL opens, or null. */
export function headerConfirmId(hash: string): string | null {
  const value = split(hash).params.get(OVERLAY_PARAM)
  return value?.startsWith(CONFIRM_PREFIX) ? value.slice(CONFIRM_PREFIX.length) : null
}
