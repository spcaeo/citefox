import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface UrlPolicy {
  /** Set in dev to the renderer dev-server URL. Null in a production load. */
  devServerOrigin: string | null
  /** Directory that may be loaded as a file URL. Null allows no file URLs. */
  appRoot: string | null
}

export type UrlClass = 'app' | 'external' | 'blocked'

const DEVTOOLS_PROTOCOLS = new Set(['devtools:', 'chrome-devtools:'])

/**
 * Classifies a URL the renderer might load or open.
 * `app` may load in the window. `external` is an http(s) link for the system
 * browser. Everything else is blocked (NFR-16).
 */
export function classifyUrl(url: string, policy: UrlPolicy): UrlClass {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'blocked'
  }

  if (parsed.protocol === 'about:' && parsed.href.startsWith('about:blank')) {
    return 'app'
  }
  if (DEVTOOLS_PROTOCOLS.has(parsed.protocol)) {
    return 'app'
  }

  const devServer = parseUrl(policy.devServerOrigin)
  if (devServer) {
    if (parsed.origin === devServer.origin) return 'app'
    if (
      (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') &&
      parsed.host === devServer.host
    ) {
      return 'app'
    }
  }

  if (parsed.protocol === 'file:') {
    return policy.appRoot !== null && fileInsideRoot(parsed, policy.appRoot) ? 'app' : 'blocked'
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return 'external'
  }
  return 'blocked'
}

/**
 * `ELECTRON_RENDERER_URL` is set by `electron-vite dev`. A packaged build
 * ignores it, so an environment variable cannot load remote content as the
 * app (with the preload bridge) in production.
 */
export function devServerUrlFrom(
  env: Readonly<Record<string, string | undefined>>,
  isPackaged: boolean
): string | null {
  if (isPackaged) return null
  const url = env['ELECTRON_RENDERER_URL']
  return typeof url === 'string' && url.length > 0 ? url : null
}

/**
 * True when an IPC call comes from the app renderer: a file inside the app
 * root, or the dev server origin over http(s). about:blank, DevTools, and
 * every remote page are refused, so a frame that somehow got the bridge
 * cannot call the engine.
 */
export function isTrustedIpcSender(
  frameUrl: string | null | undefined,
  policy: UrlPolicy
): boolean {
  if (frameUrl === null || frameUrl === undefined || frameUrl.length === 0) return false
  let parsed: URL
  try {
    parsed = new URL(frameUrl)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') {
    return policy.appRoot !== null && fileInsideRoot(parsed, policy.appRoot)
  }
  const devServer = parseUrl(policy.devServerOrigin)
  if (devServer === null) return false
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return parsed.origin === devServer.origin
}

/** What a user-initiated navigation or window.open should do. */
export function navigationAction(urlClass: UrlClass): 'allow' | 'open-external' | 'cancel' {
  if (urlClass === 'app') return 'allow'
  if (urlClass === 'external') return 'open-external'
  return 'cancel'
}

/** Redirects never leave the app window, and they are not sent to the browser. */
export function redirectAction(urlClass: UrlClass): 'allow' | 'cancel' {
  return urlClass === 'app' ? 'allow' : 'cancel'
}

function parseUrl(value: string | null): URL | null {
  if (value === null || value.length === 0) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function fileInsideRoot(fileUrl: URL, appRoot: string): boolean {
  let filePath: string
  try {
    filePath = fileURLToPath(fileUrl)
  } catch {
    return false
  }
  const resolved = path.resolve(filePath)
  const root = path.resolve(appRoot)
  const relative = path.relative(root, resolved)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
