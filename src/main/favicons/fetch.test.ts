import { describe, expect, it } from 'vitest'
import type { HttpRequest, HttpResponse, HttpTransport } from '../providers/http'
import { faviconDomain, fetchFavicon, FAVICON_MAX_BYTES, iconLinks, toDataUri } from './fetch'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const PNG_URI = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`

type Route = HttpResponse | ((request: HttpRequest) => Promise<HttpResponse>)

/** A fake transport: one response per URL; anything else is a 404. Never the network. */
function routes(map: Record<string, Route>): HttpTransport & { seen: HttpRequest[] } {
  const seen: HttpRequest[] = []
  return {
    seen,
    request(request) {
      seen.push(request)
      const route = map[request.url]
      if (route === undefined) return Promise.resolve({ status: 404, body: '' })
      return typeof route === 'function' ? route(request) : Promise.resolve(route)
    }
  }
}

const image = (type: string, bytes: Uint8Array = PNG): HttpResponse => ({
  status: 200,
  body: '',
  bytes,
  headers: { 'Content-Type': type }
})

const publicHost = (): Promise<readonly string[]> => Promise.resolve(['93.184.216.34'])

describe('faviconDomain', () => {
  it('keeps bare public hostnames and strips scheme, path and www', () => {
    expect(faviconDomain('https://WWW.Example.com/pricing?x=1')).toBe('example.com')
    expect(faviconDomain('textbolt.com')).toBe('textbolt.com')
    expect(faviconDomain('localhost')).toBeNull()
    expect(faviconDomain('10.0.0.1')).toBeNull()
    expect(faviconDomain('not a domain')).toBeNull()
  })
})

describe('fetchFavicon', () => {
  it('returns /favicon.ico as a data URI and sends every request through the SSRF guard', async () => {
    const http = routes({ 'https://example.com/favicon.ico': image('image/png') })
    const guarded: string[] = []
    const uri = await fetchFavicon('example.com', {
      http,
      resolveHost: (host) => {
        guarded.push(host)
        return publicHost()
      }
    })
    expect(uri).toBe(PNG_URI)
    expect(http.seen[0]?.resolveHost).toBeDefined()
    expect(http.seen[0]?.maxBodyBytes).toBe(FAVICON_MAX_BYTES)
    expect(http.seen[0]?.timeoutMs).toBeGreaterThan(0)
  })

  it('falls back to the home page <link rel=icon>, resolved against the page URL', async () => {
    const http = routes({
      'https://example.com/': {
        status: 200,
        body: '<html><head><link rel="stylesheet" href="/a.css"><link rel="shortcut icon" href="/static/icon.png"></head></html>',
        headers: { 'content-type': 'text/html; charset=utf-8' }
      },
      'https://example.com/static/icon.png': image('image/png')
    })
    expect(await fetchFavicon('example.com', { http, resolveHost: publicHost })).toBe(PNG_URI)
  })

  it('follows an https redirect but never an http one', async () => {
    const http = routes({
      'https://example.com/favicon.ico': {
        status: 301,
        body: '',
        headers: { location: 'https://www.example.com/favicon.ico' }
      },
      'https://www.example.com/favicon.ico': image('image/x-icon')
    })
    expect(await fetchFavicon('example.com', { http, resolveHost: publicHost })).toMatch(
      /^data:image\/x-icon;base64,/u
    )
    const insecure = routes({
      'https://example.com/favicon.ico': {
        status: 302,
        body: '',
        headers: { location: 'http://example.com/favicon.ico' }
      }
    })
    expect(await fetchFavicon('example.com', { http: insecure, resolveHost: publicHost })).toBe(
      null
    )
  })

  it('gives up on a request that does not answer in time', async () => {
    const http = routes({
      'https://slow.example/favicon.ico': () => new Promise<HttpResponse>(() => undefined),
      'https://slow.example/': () => new Promise<HttpResponse>(() => undefined)
    })
    const started = Date.now()
    const uri = await fetchFavicon('slow.example', { http, resolveHost: publicHost, timeoutMs: 40 })
    expect(uri).toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('keeps nothing when the guard refuses the host (a private address)', async () => {
    const http = routes({ 'https://example.com/favicon.ico': image('image/png') })
    const refuse = (): Promise<readonly string[]> => Promise.reject(new Error('private address'))
    // The fake transport ignores the guard, so this proves the error path; the real
    // transport calls resolveHost before it connects.
    const guardedHttp: HttpTransport = {
      request: async (request) => {
        await request.resolveHost?.('example.com')
        return http.request(request)
      }
    }
    expect(await fetchFavicon('example.com', { http: guardedHttp, resolveHost: refuse })).toBe(null)
  })

  it('keeps nothing when the transport fails or the site has no icon', async () => {
    const failing: HttpTransport = { request: () => Promise.reject(new Error('offline')) }
    expect(await fetchFavicon('example.com', { http: failing, resolveHost: publicHost })).toBe(null)
    expect(await fetchFavicon('example.com', { http: routes({}), resolveHost: publicHost })).toBe(
      null
    )
  })
})

describe('toDataUri', () => {
  it('keeps only image content types', () => {
    expect(toDataUri(image('image/png'))).toBe(PNG_URI)
    expect(toDataUri(image('image/vnd.microsoft.icon'))).toMatch(/^data:image\/vnd.microsoft.icon/u)
    expect(toDataUri(image('text/html'))).toBeNull()
    expect(toDataUri(image('application/octet-stream'))).toBeNull()
    expect(toDataUri({ status: 200, body: '', bytes: PNG })).toBeNull()
  })

  it('refuses an icon over the size cap and an empty one', () => {
    expect(toDataUri(image('image/png', new Uint8Array(FAVICON_MAX_BYTES + 1)))).toBeNull()
    expect(toDataUri(image('image/png', new Uint8Array(0)))).toBeNull()
    expect(toDataUri(image('image/png', new Uint8Array(100)), 50)).toBeNull()
  })

  it('refuses an HTML page served as an image, and an SVG with script', () => {
    const html = new TextEncoder().encode('<!doctype html><title>404</title>')
    expect(toDataUri(image('image/x-icon', html))).toBeNull()
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(toDataUri(image('image/svg+xml', svg))).toMatch(/^data:image\/svg\+xml;base64,/u)
    const bad = new TextEncoder().encode('<svg onload="alert(1)"><script>x</script></svg>')
    expect(toDataUri(image('image/svg+xml', bad))).toBeNull()
  })
})

describe('iconLinks', () => {
  it('prefers rel=icon over apple-touch-icon and skips data URIs', () => {
    const html = `
      <link rel="apple-touch-icon" href="/touch.png">
      <link href='/fav.svg' rel='icon' type='image/svg+xml'>
      <link rel=icon href=data:image/png;base64,AAAA>
      <LINK REL="Shortcut Icon" HREF="/a&amp;b.ico">`
    expect(iconLinks(html)).toEqual(['/fav.svg', '/a&b.ico', '/touch.png'])
  })
})
