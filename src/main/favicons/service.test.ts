import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FAVICON_BATCH_MAX } from '@shared/ipc'
import {
  FAVICON_NEGATIVE_TTL_MS,
  FAVICON_TTL_MS,
  openFaviconCache,
  type FaviconCache
} from './cache'
import { createFaviconService } from './service'

const ICON = 'data:image/png;base64,iVBORw0KGgo='
const DAY = 24 * 60 * 60 * 1000

const caches: FaviconCache[] = []
const dirs: string[] = []

afterEach(() => {
  for (const cache of caches.splice(0)) cache.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function memoryCache(): FaviconCache {
  const cache = openFaviconCache(':memory:')
  caches.push(cache)
  return cache
}

function setup(
  icons: Record<string, string | null>,
  enabled = true
): {
  service: ReturnType<typeof createFaviconService>
  fetched: string[]
  advance: (ms: number) => void
} {
  let now = Date.parse('2026-10-23T10:00:00Z')
  const fetched: string[] = []
  const cache = memoryCache()
  const service = createFaviconService({
    cache: () => cache,
    fetch: (domain) => {
      fetched.push(domain)
      return Promise.resolve(icons[domain] ?? null)
    },
    now: () => now,
    enabled: () => enabled
  })
  return {
    service,
    fetched,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('favicon cache', () => {
  it('keeps a found icon for 30 days and "no icon" for 3 days', () => {
    const cache = memoryCache()
    const at = 1_000_000_000_000
    cache.put('a.com', ICON, at)
    cache.put('b.com', null, at)
    expect(cache.get('a.com', at + FAVICON_TTL_MS - 1)).toEqual({ dataUri: ICON })
    expect(cache.get('a.com', at + FAVICON_TTL_MS + 1)).toBeNull()
    expect(cache.get('b.com', at + FAVICON_NEGATIVE_TTL_MS - 1)).toEqual({ dataUri: null })
    expect(cache.get('b.com', at + FAVICON_NEGATIVE_TTL_MS + 1)).toBeNull()
    expect(cache.get('c.com', at)).toBeNull()
  })

  it('persists in its own file and refuses a non-image data URI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'citefox-favicons-'))
    dirs.push(dir)
    const file = join(dir, 'favicons.sqlite')
    const first = openFaviconCache(file)
    first.put('a.com', ICON, 5)
    expect(() => first.put('x.com', 'data:text/html;base64,PGh0bWw+', 5)).toThrow()
    first.close()
    const second = openFaviconCache(file)
    caches.push(second)
    expect(second.get('a.com', 6)).toEqual({ dataUri: ICON })
  })
})

describe('favicon service', () => {
  it('fetches a miss once, then answers from the cache', async () => {
    const { service, fetched } = setup({ 'textbolt.com': ICON })
    expect(await service.get(['https://www.TextBolt.com/pricing'])).toEqual({
      icons: [{ domain: 'textbolt.com', dataUri: ICON }]
    })
    expect(await service.get(['textbolt.com'])).toEqual({
      icons: [{ domain: 'textbolt.com', dataUri: ICON }]
    })
    expect(fetched).toEqual(['textbolt.com'])
  })

  it('caches "no icon" (negative cache) and fetches again after it expires', async () => {
    const { service, fetched, advance } = setup({})
    expect((await service.get(['nofav.com'])).icons).toEqual([
      { domain: 'nofav.com', dataUri: null }
    ])
    await service.get(['nofav.com'])
    expect(fetched).toEqual(['nofav.com'])
    advance(FAVICON_NEGATIVE_TTL_MS + DAY)
    await service.get(['nofav.com'])
    expect(fetched).toEqual(['nofav.com', 'nofav.com'])
  })

  it('fetches a found icon again once its 30 days are up (TTL)', async () => {
    const { service, fetched, advance } = setup({ 'a.com': ICON })
    await service.get(['a.com'])
    advance(29 * DAY)
    await service.get(['a.com'])
    expect(fetched).toHaveLength(1)
    advance(2 * DAY)
    await service.get(['a.com'])
    expect(fetched).toHaveLength(2)
  })

  it('shares one fetch between callers asking at the same time', async () => {
    let release: (value: string | null) => void = () => undefined
    let calls = 0
    const service = createFaviconService({
      cache: () => memoryCache(),
      fetch: () => {
        calls += 1
        return new Promise((resolve) => {
          release = resolve
        })
      },
      now: () => 1,
      enabled: () => true
    })
    const one = service.get(['a.com'])
    const two = service.get(['a.com'])
    await Promise.resolve()
    release(ICON)
    expect((await one).icons[0]?.dataUri).toBe(ICON)
    expect((await two).icons[0]?.dataUri).toBe(ICON)
    expect(calls).toBe(1)
  })

  it('skips bad domains, drops duplicates and caps the batch', async () => {
    const { service, fetched } = setup({})
    const many = Array.from({ length: FAVICON_BATCH_MAX + 5 }, (_, index) => `site${index}.com`)
    const result = await service.get(['localhost', '', 'a.com', 'A.com', ...many])
    expect(result.icons).toHaveLength(FAVICON_BATCH_MAX)
    expect(result.icons[0]?.domain).toBe('a.com')
    expect(fetched).not.toContain('localhost')
  })

  it('answers nothing and fetches nothing when icons are off', async () => {
    const { service, fetched } = setup({ 'a.com': ICON }, false)
    expect(await service.get(['a.com'])).toEqual({ icons: [] })
    expect(fetched).toEqual([])
  })

  it('treats a fetch that throws as "no icon"', async () => {
    const service = createFaviconService({
      cache: () => memoryCache(),
      fetch: () => Promise.reject(new Error('boom')),
      now: () => 1,
      enabled: () => true
    })
    expect(await service.get(['a.com'])).toEqual({ icons: [{ domain: 'a.com', dataUri: null }] })
  })
})
