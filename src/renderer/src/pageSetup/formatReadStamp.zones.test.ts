import { spawnSync } from 'node:child_process'
import { expect, test } from 'vitest'

const FILE = 'src/renderer/src/pageSetup/formatReadStamp.test.ts'

test('page-read stamps match America/Toronto and UTC', () => {
  for (const tz of ['America/Toronto', 'UTC']) {
    const env: NodeJS.ProcessEnv = { ...process.env, TZ: tz }
    for (const key of Object.keys(env)) {
      if (key.startsWith('VITEST')) delete env[key]
    }
    const result = spawnSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', FILE, '--reporter=dot'],
      { env, encoding: 'utf8', cwd: process.cwd() }
    )
    expect(result.status, `${tz}\n${result.stdout}\n${result.stderr}`).toBe(0)
  }
}, 60_000)
