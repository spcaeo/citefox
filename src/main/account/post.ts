import type { HttpTransport } from '../providers/http'
import { withTimeout } from '../providers/timeout'
import type { RegisterEndpoint } from './endpoint'

/** What the script answers: `{ ok: true }` or `{ ok: false, error }` (server/apps-script/Code.gs). */
export type ScriptReply = { ok: true } | { ok: false; error: string }

const TIMEOUT_MS = 10_000

/**
 * The script's reply body is served from this host after a redirect. Only a
 * GET is sent there, with nothing from the request (the token stays in the POST).
 */
const REPLY_HOST = /^script\.googleusercontent\.com$/

/**
 * POSTs one JSON message to the Apps Script web app. Apps Script runs the
 * script, then answers 302 to the reply on googleusercontent.com; the HTTP
 * transport never follows redirects, so the reply is fetched here with a GET.
 * Throws when the network fails; a reply that cannot be read is `{ ok: false }`.
 */
export async function postToScript(
  http: HttpTransport,
  endpoint: RegisterEndpoint,
  message: Record<string, unknown>
): Promise<ScriptReply> {
  const label = 'CiteFox account'
  const first = await withTimeout(
    (signal) =>
      http.request({
        method: 'POST',
        url: endpoint.url,
        headers: { 'content-type': 'application/json', 'user-agent': 'CiteFox' },
        body: JSON.stringify({ ...message, token: endpoint.token }),
        timeoutMs: TIMEOUT_MS,
        signal,
        maxBodyBytes: 64_000
      }),
    TIMEOUT_MS,
    label
  )
  let response = first
  if (first.status >= 300 && first.status < 400) {
    const location = headerOf(first.headers, 'location')
    const target = location ? safeUrl(location, endpoint.url) : null
    if (target === null || target.protocol !== 'https:' || !REPLY_HOST.test(target.hostname)) {
      return { ok: false, error: 'redirect' }
    }
    response = await withTimeout(
      (signal) =>
        http.request({
          method: 'GET',
          url: target.toString(),
          headers: { 'user-agent': 'CiteFox' },
          timeoutMs: TIMEOUT_MS,
          signal,
          maxBodyBytes: 64_000
        }),
      TIMEOUT_MS,
      label
    )
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, error: `http-${response.status}` }
  }
  return parseReply(response.body)
}

export function parseReply(body: string): ScriptReply {
  try {
    const value = JSON.parse(body) as unknown
    if (typeof value === 'object' && value !== null) {
      const r = value as Record<string, unknown>
      if (r.ok === true) return { ok: true }
      if (r.ok === false)
        return { ok: false, error: typeof r.error === 'string' ? r.error.slice(0, 40) : 'failed' }
    }
  } catch {
    // An HTML error page from Google: not a reply.
  }
  return { ok: false, error: 'unreadable' }
}

function headerOf(
  headers: Readonly<Record<string, string>> | undefined,
  name: string
): string | null {
  if (!headers) return null
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value
  }
  return null
}

function safeUrl(value: string, base: string): URL | null {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}
