/**
 * Where "Join CiteFox" and the daily version ping go: the owner's Google Apps
 * Script web app (server/README.md). Set at build time from the environment
 * (`CITEFOX_REGISTER_URL`, optional `CITEFOX_REGISTER_TOKEN`) by
 * electron.vite.config.ts, like `__CITEFOX_BUILD__`. A build without a URL
 * (dev, tests, a fork) sends nothing at all.
 *
 * The token ships inside the app, so it is public: it only keeps random
 * traffic off the script. Never put Gmail or SMTP credentials here; every
 * email is sent by the script.
 */

declare const __CITEFOX_REGISTER__: { url?: unknown; token?: unknown } | undefined

export interface RegisterEndpoint {
  url: string
  token: string
}

/** The token the script expects when the build sets none (`APP_TOKEN` in server/README.md). */
export const DEFAULT_APP_TOKEN = 'citefox-public-v1'

const TOKEN = /^[A-Za-z0-9._-]{8,128}$/

/** The configured endpoint, or null (no URL, or not an https address). */
export function registerEndpoint(
  injected: unknown = typeof __CITEFOX_REGISTER__ === 'undefined' ? undefined : __CITEFOX_REGISTER__
): RegisterEndpoint | null {
  if (typeof injected !== 'object' || injected === null) return null
  const { url, token } = injected as Record<string, unknown>
  if (typeof url !== 'string' || url.trim() === '') return null
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  return {
    url: parsed.toString(),
    token: typeof token === 'string' && TOKEN.test(token) ? token : DEFAULT_APP_TOKEN
  }
}
