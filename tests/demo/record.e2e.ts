import { rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { callIpcHandler, isIpcInvokeChannel } from '@shared/ipc'
import { expect, test } from 'vitest'
import { demoPolicy } from '../../src/renderer/demo/policy'
import { stableJson, type DemoEntry, type DemoSnapshot } from '../../src/renderer/demo/snapshot'
import { openBrowser } from './browser'
import { crawl } from './crawl'
import { demoHandlers, seedDemoProject } from './project'
import { scrubSnapshot } from './scrub'
import { SITE_PREFIX, startSiteServer } from './server'

/**
 * `npm run demo:record` (Docker only, scripts/demo/docker.mjs): records the
 * browser demo's answers (src/renderer/demo/snapshot.json).
 *
 * Seeds the demo project, serves the recording build (out/demo-record, made with
 * VITE_CITEFOX_DEMO_RECORD=1) whose bridge sends each read to the real handlers
 * here, walks the tour (crawl.ts) in a headless window, and stores every answer.
 * Blocked channels never reach the handlers (the same policy as the demo).
 */

const BUILD = resolve(process.env.DEMO_RECORD_BUILD ?? 'out/demo-record')
const SNAPSHOT = resolve(process.env.DEMO_SNAPSHOT ?? 'src/renderer/demo/snapshot.json')

test('records the demo snapshot', async () => {
  const dir = await seedDemoProject()
  const { handlers, storage } = demoHandlers(dir)
  const entries = new Map<string, Map<string, DemoEntry>>()
  const failed = new Set<string>()
  const crashes: string[] = []
  const invoke = async (channel: string, arg: unknown): Promise<unknown> => {
    if (!isIpcInvokeChannel(channel) || demoPolicy(channel) === 'blocked') {
      throw new Error(`Not recorded: ${channel}`)
    }
    let result: unknown
    try {
      result = await callIpcHandler(handlers, channel, arg === null ? [] : [arg])
    } catch (error) {
      if (!(error instanceof Error) || !/unexpected arguments/.test(error.message)) {
        failed.add(`${channel}: ${error instanceof Error ? error.message : error}`)
        throw error
      }
      result = await callIpcHandler(handlers, channel, arg === null ? [null] : [])
    }
    const json = JSON.parse(JSON.stringify(result ?? null)) as unknown
    const list = entries.get(channel) ?? new Map<string, DemoEntry>()
    list.set(stableJson(arg), { args: arg, result: json })
    entries.set(channel, list)
    return json
  }
  const site = await startSiteServer(resolve(BUILD, '..'), invoke)
  const { app, page, errors } = await openBrowser(
    `${site.origin}${SITE_PREFIX}${BUILD.split('/').pop()}/`
  )
  try {
    await page.waitForSelector('#main', { timeout: 60_000 })
    await crawl(page, {
      onStep: (name) => console.log(`[record] ${name}`),
      onCrash: (name) => crashes.push(name)
    })
  } finally {
    await app.close()
    await site.close()
    storage.close()
    rmSync(dir, { recursive: true, force: true })
  }
  const snapshot: DemoSnapshot = {
    version: 1,
    recordedAt: new Date().toISOString(),
    entries: Object.fromEntries(
      [...entries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([channel, list]) => [channel, [...list.values()]])
    )
  }
  const clean = scrubSnapshot(snapshot, dir)
  writeFileSync(SNAPSHOT, `${JSON.stringify(clean)}\n`)
  const calls = Object.values(clean.entries).reduce((sum, list) => sum + list.length, 0)
  console.log(
    `[record] ${Object.keys(clean.entries).length} channels, ${calls} answers, ` +
      `${(JSON.stringify(clean).length / 1024).toFixed(0)} KB`
  )
  if (failed.size > 0) console.log(`[record] handler errors:\n  ${[...failed].join('\n  ')}`)
  if (crashes.length > 0) console.log(`[record] the app crashed after: ${crashes.join(', ')}`)
  if (errors.length > 0) console.log(`[record] console errors:\n  ${errors.join('\n  ')}`)
  expect(calls).toBeGreaterThan(50)
}, 1_200_000)
