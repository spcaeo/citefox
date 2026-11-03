import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { createLogger } from '../logging/logger'
import {
  createKeychainRef,
  maskedHint,
  MemorySecretStore,
  SecretRegistry
} from '../secrets/secret-store'
import { openAppStorage } from './app-storage'
import { insertApiKey, insertProject } from './records'
import { defaultSettings } from './settings'
import { projectDatabaseRelativePath } from './slug'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('secrets stay out of app files', () => {
  test('writes the keychain ref and masked hint only', () => {
    const secret = `sk-ant-api03-${'d'.repeat(24)}wxyz`
    const registry = new SecretRegistry()
    const store = new MemorySecretStore(registry)
    const keychainRef = createKeychainRef('anthropic')
    store.set(keychainRef, secret)
    const hint = maskedHint(secret)
    expect(hint).toBe('wxyz')
    expect(secret.includes(hint)).toBe(true)
    expect(hint.includes(secret)).toBe(false)

    const directory = mkdtempSync(join(tmpdir(), 'citefox-persist-'))
    directories.push(directory)
    const storage = openAppStorage(directory)
    const slug = 'textbolt'
    insertProject(storage.db, {
      id: 'project-1',
      name: 'TextBolt',
      slug,
      domain: 'textbolt.example',
      dbPath: projectDatabaseRelativePath(slug),
      clientName: 'Northwind',
      status: 'active'
    })
    insertApiKey(storage.db, {
      id: 'key-1',
      provider: 'anthropic',
      name: 'Claude',
      keychainRef,
      rotationOrder: 0,
      cap: null,
      on: true,
      projectIds: [],
      hint,
      state: 'unchecked',
      lastReason: null,
      serpapiUsage: null
    })
    storage.writeSettings(defaultSettings())
    storage.close()

    const dumped = dump(directory)
    expect(dumped).not.toContain(secret)
    expect(dumped).toContain(keychainRef)
    expect(dumped).toContain(hint)
    // Windows has no POSIX file modes; there the files sit in the user's own profile folder.
    if (process.platform !== 'win32') {
      expect(statSync(join(directory, 'settings.json')).mode & 0o777).toBe(0o600)
      expect(statSync(join(directory, 'app.sqlite')).mode & 0o777).toBe(0o600)
    }

    const lines: string[] = []
    const logger = createLogger({
      write: (_level, line) => lines.push(line),
      secrets: () => registry.list()
    })
    logger.error(`checkup failed for ${secret}`, new Error(`upstream said ${secret}`))
    expect(lines.join('\n')).not.toContain(secret)
    expect(lines.join('\n')).toContain('[REDACTED]')
  })
})

function dump(directory: string): string {
  const chunks: Buffer[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const filePath = join(current, entry.name)
      if (entry.isDirectory()) visit(filePath)
      else if (entry.isFile()) chunks.push(readFileSync(filePath))
    }
  }
  visit(directory)
  return Buffer.concat(chunks).toString('utf8')
}
