import type { ElectronApplication, Page } from '@playwright/test'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchCiteFox } from './launch'
import { installRawMarkdown } from './raw-hook'
import { openAllPages } from './nav-helpers'

const ROOT = process.cwd()
const SHIM = path.join(ROOT, 'tests/e2e/claude-shim.mjs')
const FIXTURES = path.join(ROOT, 'src/main/communities/fixtures')
const ANTHROPIC_FIXTURES = path.join(ROOT, 'src/main/providers/fixtures/anthropic')

export interface CommunitiesApp {
  app: ElectronApplication
  page: Page
  dir: string
  /** Every Reddit, YouTube, or FoxCue URL the main process tried to fetch. */
  fetched: () => Promise<string[]>
  close: () => Promise<void>
}

/**
 * Seeds the Communities project (two checks, two markets, recorded overviews
 * that cite Reddit, YouTube, LinkedIn, review sites and forums) through the
 * real IPC handlers, then launches the production app on that temp folder.
 * Reddit's public JSON is answered from recorded fixtures inside the main
 * process; nothing reaches the network. Claude is the fixture shim.
 */
export async function openCommunitiesApp(prefix: string): Promise<CommunitiesApp> {
  installRawMarkdown()
  const { seedCommunitiesProject } = await import('../../src/main/communities/seed.test-helper')
  const dir = await mkdtemp(path.join(os.tmpdir(), `citefox-${prefix}-`))
  const seeded = await seedCommunitiesProject(dir, { cacheVideoDetails: true })
  seeded.close()
  const bin = path.join(dir, 'bin')
  await mkdir(bin, { recursive: true })
  const claude = path.join(bin, 'claude')
  await writeFile(claude, `#!/bin/sh\nexec node ${JSON.stringify(SHIM)} "$@"\n`)
  await chmod(claude, 0o755)
  const { app, page } = await launchCiteFox({
    userDataDir: dir,
    viewport: { width: 1280, height: 900 },
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      CITEFOX_FIXTURE_DIR: ANTHROPIC_FIXTURES,
      CITEFOX_SHIM_LOG: path.join(dir, 'claude-shim.log')
    }
  })
  await installCommunityFetch(app)
  await openAllPages(page)
  return {
    app,
    page,
    dir,
    fetched: () =>
      app.evaluate(() => {
        const store = globalThis as unknown as { __citefoxFetched?: string[] }
        return store.__citefoxFetched ?? []
      }),
    close: async () => {
      await app.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

async function installCommunityFetch(app: ElectronApplication): Promise<void> {
  const read = async (name: string): Promise<{ status: number; body: string }> => {
    const file = JSON.parse(await readFile(path.join(FIXTURES, name), 'utf8')) as {
      status: number
      body: unknown
    }
    return { status: file.status, body: JSON.stringify(file.body) }
  }
  const replies = {
    open: await read('reddit-thread-open.json'),
    archived: await read('reddit-thread-archived.json')
  }
  await app.evaluate((_electron, config) => {
    const store = globalThis as unknown as { __citefoxFetched?: string[] }
    store.__citefoxFetched = []
    const original = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const respond = (reply: { status: number; body: string }): Response =>
        new Response(reply.body, {
          status: reply.status,
          headers: { 'content-type': 'application/json' }
        })
      if (/reddit\.com|googleapis\.com|foxcue\.com/.test(url)) store.__citefoxFetched?.push(url)
      if (url.startsWith('https://www.reddit.com/comments/1abc23x.json'))
        return respond(config.open)
      if (url.startsWith('https://www.reddit.com/comments/1def45y.json')) {
        return respond(config.archived)
      }
      if (/reddit\.com|googleapis\.com|foxcue\.com/.test(url)) {
        return respond({ status: 599, body: '{"error":"no e2e fixture"}' })
      }
      return original(input, init)
    }
  }, replies)
}
