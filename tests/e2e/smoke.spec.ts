import { IPC_CHANNELS, type CiteFoxApi, type ConnectionsOverview } from '@shared/ipc'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { launchCiteFox } from './launch'

test('boots, isolates the renderer, and reads app info over IPC', async () => {
  const root = process.cwd()
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    version?: string
  }
  const version = packageJson.version
  if (!version) {
    throw new Error('package.json version is missing')
  }

  const { app, page } = await launchCiteFox()

  try {
    await expect(page.getByRole('heading', { level: 1, name: /See whether Google/ })).toBeVisible()

    const exposed = await page.evaluate(async () => {
      const globals = globalThis as typeof globalThis & {
        require?: unknown
        process?: unknown
        citefox: CiteFoxApi
      }
      const info = await globals.citefox['app:getInfo']()
      return {
        hasRequire: typeof globals.require === 'function',
        hasProcess: typeof globals.process === 'object' && globals.process !== null,
        channels: Object.keys(globals.citefox).sort(),
        info
      }
    })
    // The build (commit and time) rides along for the header chip (batch 2, item 1).
    expect(exposed.info).toMatchObject({ name: 'CiteFox', version })
    expect(typeof exposed.info.build?.builtAt).toBe('string')
    expect({
      hasRequire: exposed.hasRequire,
      hasProcess: exposed.hasProcess,
      channels: exposed.channels
    }).toEqual({
      hasRequire: false,
      hasProcess: false,
      channels: [...IPC_CHANNELS].sort()
    })

    const overview = await page.evaluate(() => {
      const globals = globalThis as typeof globalThis & { citefox: CiteFoxApi }
      return globals.citefox['connections:getOverview']()
    })
    const expected: ConnectionsOverview = {
      serpapiRotation: 'in_order',
      keys: [],
      serpapi: 'off',
      claudeCode: 'unchecked',
      jina: 'off',
      youtube: 'off',
      claudeCheckup: null,
      searchesLeft: null,
      issueCount: 0
    }
    expect(overview).toEqual(expected)
  } finally {
    await app.close()
  }
})
