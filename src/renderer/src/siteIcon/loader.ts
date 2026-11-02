import { FAVICON_BATCH_MAX, type FaviconRequest, type FaviconResult } from '@shared/ipc'

/**
 * Site icons for the renderer (`favicons:get`). Icons asked for in the same
 * moment go to main in one batch; answers are kept for the window's life, so a
 * list that re-renders never asks again. A missing bridge (the Vite harness),
 * a failed call or icons switched off all leave the letter tile in place.
 * Only icons still on screen when a batch goes out are fetched, so a long,
 * virtualised list asks just for the rows the person can see.
 */

export type FetchIcons = (request: FaviconRequest) => Promise<FaviconResult>

/** `undefined`: not asked yet or on its way. `null`: no icon (letter tile). */
export type IconState = string | null | undefined

const BATCH_DELAY_MS = 16

const icons = new Map<string, string | null>()
const asked = new Set<string>()
const listeners = new Map<string, Set<() => void>>()
let queue: string[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let fetchIcons: FetchIcons | null = null

function bridgeFetch(): FetchIcons | null {
  if (typeof window === 'undefined') return null
  const api = (window as { citefox?: Partial<Window['citefox']> }).citefox
  const get = api?.['favicons:get']
  return typeof get === 'function' ? (request) => get(request) : null
}

/** Tests: a fake `favicons:get`, and a clean slate. */
export function setFetchIconsForTests(fake: FetchIcons | null): void {
  fetchIcons = fake
  icons.clear()
  asked.clear()
  listeners.clear()
  queue = []
  if (timer !== null) clearTimeout(timer)
  timer = null
}

/** The same key main uses: lower case, no scheme, path or `www.`. */
export function iconKey(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, '')
    .split(/[/?#]/u)[0]!
    .replace(/:\d+$/u, '')
    .replace(/^www\./u, '')
}

export function iconFor(domain: string): IconState {
  return icons.get(iconKey(domain))
}

export function subscribeIcon(domain: string, listener: () => void): () => void {
  const key = iconKey(domain)
  let set = listeners.get(key)
  if (set === undefined) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(listener)
  request(key)
  return () => {
    set.delete(listener)
  }
}

/** Someone on screen still wants this icon (a virtualised row may have scrolled away). */
function wanted(key: string): boolean {
  return (listeners.get(key)?.size ?? 0) > 0
}

function settle(key: string, value: string | null): void {
  icons.set(key, value)
  for (const listener of [...(listeners.get(key) ?? [])]) listener()
}

function request(key: string): void {
  if (key.length === 0 || asked.has(key)) return
  asked.add(key)
  queue.push(key)
  timer ??= setTimeout(flush, BATCH_DELAY_MS)
}

function flush(): void {
  timer = null
  // Rows that left the screen before the batch went out ask again when they come back.
  const pending = queue.filter((key) => {
    if (wanted(key)) return true
    asked.delete(key)
    return false
  })
  queue = []
  if (pending.length === 0) return
  const fetcher = fetchIcons ?? bridgeFetch()
  if (fetcher === null) {
    for (const key of pending) settle(key, null)
    return
  }
  for (let start = 0; start < pending.length; start += FAVICON_BATCH_MAX) {
    const batch = pending.slice(start, start + FAVICON_BATCH_MAX)
    void fetcher({ domains: batch })
      .then((result) => {
        const found = new Map(result.icons.map((entry) => [entry.domain, entry.dataUri]))
        for (const key of batch) settle(key, safeUri(found.get(key) ?? null))
      })
      .catch(() => {
        for (const key of batch) settle(key, null)
      })
  }
}

/** Only image data URIs ever reach an `<img>`. */
function safeUri(value: string | null): string | null {
  return value !== null && /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/iu.test(value)
    ? value
    : null
}
