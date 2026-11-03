import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { EngineHost } from '../engine/host'
import { createLogger } from '../logging/logger'
import { resetSharedReadPoolForTests } from '../pipeline/read-pool'
import { ProviderError } from '../providers/errors'
import type { SqliteDatabase } from '../storage/database'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { readOne } from './site'

const directories: string[] = []
const databases: SqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) closeProjectDatabase(db)
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  resetSharedReadPoolForTests()
})

test('a page the reader could not fetch logs a reason code and no address', async () => {
  const lines: string[] = []
  const directory = mkdtempSync(join(tmpdir(), 'citefox-topic-log-'))
  directories.push(directory)
  const db = createProjectDatabase(directory, 'textbolt')
  databases.push(db)
  const host = {
    now: () => new Date('2026-11-03T12:00:00.000Z'),
    logger: createLogger({ write: (_level, line) => lines.push(line) }),
    knownSecrets: () => [],
    pageDns: { lookup: async () => ['10.0.0.5'] },
    http: {
      request: async () => {
        throw new ProviderError('Network request failed for secret-address.example', {
          code: 'network',
          state: 'warning',
          nextStep: null
        })
      }
    }
  } as unknown as EngineHost
  const read = await readOne(host, db, 'https://secret-address.example/', 'home', true)
  expect(read.ok).toBe(false)
  const line = lines.find((entry) => entry.includes('through the reader failed'))
  expect(line).toContain('"reason":"network"')
  expect(lines.join('\n')).not.toContain('secret-address')
})
