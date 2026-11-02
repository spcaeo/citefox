import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createIpcHandlers } from '../../src/main/handlers'
import { createLogger } from '../../src/main/logging/logger'
import type { CommandTransport } from '../../src/main/providers/command'
import type { HttpTransport } from '../../src/main/providers/http'
import { MemorySecretStore, SecretRegistry } from '../../src/main/secrets/secret-store'
import { openAppStorage, type AppStorage } from '../../src/main/storage/app-storage'
import { closeProjectDatabase, openProjectDatabase } from '../../src/main/storage/project-files'
import { projectDatabaseRelativePath } from '../../src/main/storage/slug'
import { seedTextboltTopic } from '../../src/main/topics/fixture-seed'
import { REPORTS_SEED, seedReportsProject } from '../e2e/reports-seed'

/**
 * The demo project for the browser demo and the sample reports (Docs/DEMO.md):
 * the same TextBolt project as the marketing media (tests/media/demo.spec.ts),
 * i.e. the e2e reports seed (3 checks, 3 engines, fixes, 2 markets) plus the
 * TextBolt topic. No network, no keys, no AI: every provider refuses.
 */

/** "Now" for the demo: two days after the last seeded check. */
export const DEMO_NOW = new Date('2026-10-21T15:00:00.000Z')

export const DEMO_PROJECT = {
  id: REPORTS_SEED.projectId,
  name: 'TextBolt',
  slug: 'textbolt',
  domain: 'textbolt.com'
} as const

export async function seedDemoProject(
  dir = mkdtempSync(join(tmpdir(), 'citefox-demo-'))
): Promise<string> {
  await seedReportsProject(dir)
  const storage = openAppStorage(dir)
  const db = openProjectDatabase(storage.paths.projectsDirectory, DEMO_PROJECT.slug)
  try {
    seedTextboltTopic(db, {
      ...DEMO_PROJECT,
      dbPath: projectDatabaseRelativePath(DEMO_PROJECT.slug),
      clientName: null,
      status: 'active'
    })
    // Nothing is ever searched: the queue stays paused.
    storage.db
      .prepare(
        `INSERT OR REPLACE INTO queue_pause (id, state, paused_on) VALUES (1, 'paused_all', NULL)`
      )
      .run()
  } finally {
    closeProjectDatabase(db)
    storage.close()
  }
  return dir
}

const offlineHttp: HttpTransport = {
  request: () => Promise.reject(new Error('The demo is offline'))
}

const noCommand: CommandTransport = {
  run: () =>
    Promise.resolve({
      exitCode: 127,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: 'not available in the demo'
    })
}

/** The real IPC handlers on the seeded demo folder, with every outside service off. */
export function demoHandlers(dir: string): {
  handlers: ReturnType<typeof createIpcHandlers>
  storage: AppStorage
} {
  const storage = openAppStorage(dir)
  const registry = new SecretRegistry()
  const secrets = new MemorySecretStore(registry)
  const logger = createLogger({ write: () => undefined, secrets: () => registry.list() })
  let sequence = 0
  const handlers = createIpcHandlers({
    appInfo: () => ({ name: 'CiteFox', version: '0.0.0' }),
    storage,
    secrets,
    logger,
    http: offlineHttp,
    claudeCommand: noCommand,
    claudeProbe: { exists: () => false, searchPath: () => null },
    emitCheckupProgress: () => undefined,
    emit: () => undefined,
    knownSecrets: () => registry.list(),
    now: () => DEMO_NOW,
    createId: () => `demo-${(sequence += 1)}`,
    startAutopilotOff: true
  })
  return { handlers, storage }
}
