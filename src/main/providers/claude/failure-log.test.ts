import { afterEach, describe, expect, test } from 'vitest'
import { closeDatabase, type SqliteDatabase } from '../../storage/database'
import { openAppDatabase } from '../../storage/app-database'
import { createCodexProvider } from '../codex/codex'
import { runCodexCheckup } from '../codex/checkup'
import { runClaudeCheckup } from './checkup'
import { createClaudeCodeProvider } from './claude-code'
import {
  BINARY,
  STAPLE,
  captureLogger,
  commandResult,
  commandScript,
  probeFor
} from './claude-test-fakes.test-helper'

const databases: SqliteDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) closeDatabase(db)
})

function memoryDb(): SqliteDatabase {
  const db = openAppDatabase(':memory:')
  databases.push(db)
  return db
}

const PROMPT = 'private-question-text-for-test'

describe('a failed AI call leaves one line with a short reason', () => {
  test('Claude Code that cannot start logs the reason code and no secret or prompt', async () => {
    const { logger, lines } = captureLogger()
    const command = commandScript({
      print: () => commandResult({ spawnError: 'ENOENT', exitCode: null, stderr: STAPLE })
    })
    const provider = createClaudeCodeProvider({
      command,
      probe: probeFor([BINARY]),
      logger,
      savedBinaryPath: BINARY,
      platform: 'linux',
      pathEnv: '',
      baseEnv: { PATH: '/usr/bin' },
      secrets: [STAPLE],
      sleep: async () => undefined
    })
    await expect(provider.complete({ prompt: PROMPT })).rejects.toMatchObject({
      code: 'not_installed'
    })
    const line = lines.find((entry) => entry.startsWith('claude call finished'))
    expect(line).toContain('"outcome":"error"')
    expect(line).toContain('"code":"not_installed"')
    expect(lines.join('\n')).not.toContain(STAPLE)
    expect(lines.join('\n')).not.toContain(PROMPT)
  })

  test('Claude Code that is not on this computer logs the reason code', async () => {
    const { logger, lines } = captureLogger()
    const provider = createClaudeCodeProvider({
      command: commandScript({}),
      probe: probeFor([]),
      logger,
      savedBinaryPath: null,
      platform: 'linux',
      pathEnv: '',
      baseEnv: { PATH: '/usr/bin' },
      sleep: async () => undefined
    })
    await expect(provider.complete({ prompt: PROMPT })).rejects.toMatchObject({
      code: 'not_installed'
    })
    const line = lines.find((entry) => entry.startsWith('claude call finished'))
    expect(line).toContain('"code":"not_installed"')
    expect(lines.join('\n')).not.toContain(PROMPT)
  })

  test('Codex that is not installed logs the reason code and no prompt', async () => {
    const { logger, lines } = captureLogger()
    const provider = createCodexProvider({
      command: commandScript({}),
      probe: probeFor([]),
      logger,
      savedBinaryPath: null,
      platform: 'linux',
      pathEnv: '',
      home: '/nowhere',
      baseEnv: { PATH: '/usr/bin' },
      secrets: [STAPLE],
      sleep: async () => undefined
    })
    await expect(provider.complete({ prompt: PROMPT })).rejects.toMatchObject({
      code: 'not_installed'
    })
    const line = lines.find((entry) => entry.startsWith('codex call finished'))
    expect(line).toContain('"outcome":"error"')
    expect(line).toContain('"code":"not_installed"')
    expect(lines.join('\n')).not.toContain(PROMPT)
  })

  test('a Claude Code check that cannot find the program logs where it stopped', async () => {
    const { logger, lines } = captureLogger()
    await runClaudeCheckup({
      command: commandScript({}),
      probe: probeFor([]),
      logger,
      db: memoryDb(),
      binaryPath: '/Users/someone/secret-folder/claude',
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      secrets: [STAPLE]
    })
    const line = lines.find((entry) => entry.startsWith('ai check did not pass'))
    expect(line).toContain('"provider":"claude-code"')
    expect(line).toContain('"binaryFound":false')
    expect(line).toContain('"login":"skipped"')
    expect(lines.join('\n')).not.toContain('secret-folder')
  })

  test('a Codex check that cannot find the program logs where it stopped', async () => {
    const { logger, lines } = captureLogger()
    await runCodexCheckup({
      command: commandScript({}),
      probe: probeFor([]),
      logger,
      db: memoryDb(),
      binaryPath: '/Users/someone/secret-folder/codex',
      savedBinaryPath: null,
      pathEnv: '',
      home: '/home/tester',
      platform: 'linux',
      secrets: [STAPLE]
    })
    const line = lines.find((entry) => entry.startsWith('ai check did not pass'))
    expect(line).toContain('"provider":"codex"')
    expect(line).toContain('"binaryFound":false')
    expect(lines.join('\n')).not.toContain('secret-folder')
  })
})
