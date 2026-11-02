import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'

/**
 * A tiny static server for the demo checks (tests/demo/*.e2e.ts): serves a
 * folder the way GitHub Pages does under /citefox/, and optionally answers
 * POST /__demo/invoke for the recording build.
 */

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml'
}

export const SITE_PREFIX = '/citefox/'

export type InvokeHandler = (channel: string, arg: unknown) => Promise<unknown>

function body(request: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => parts.push(part))
    request.on('end', () => done(Buffer.concat(parts).toString('utf8')))
    request.on('error', fail)
  })
}

export async function startSiteServer(
  siteDir: string,
  invoke?: InvokeHandler
): Promise<{ server: Server; origin: string; close: () => Promise<void> }> {
  const root = resolve(siteDir)
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'POST' && url.pathname === '/__demo/invoke' && invoke) {
        const { channel, arg } = JSON.parse(await body(request)) as {
          channel: string
          arg: unknown
        }
        let reply: unknown
        try {
          reply = { ok: true, value: await invoke(channel, arg) }
        } catch (error) {
          reply = { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(reply))
        return
      }
      if (!url.pathname.startsWith(SITE_PREFIX)) {
        response.writeHead(404).end()
        return
      }
      let file = normalize(join(root, decodeURIComponent(url.pathname.slice(SITE_PREFIX.length))))
      if (!file.startsWith(root)) {
        response.writeHead(403).end()
        return
      }
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
      if (!existsSync(file)) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream'
      })
      response.end(readFileSync(file))
    })().catch((error: unknown) => {
      response.writeHead(500).end(String(error))
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => server.close(() => done()))
  }
}
