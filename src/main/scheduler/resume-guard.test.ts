import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import { insertStoredCheckJob } from '../storage/check-records'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'
import { guardResumingPages } from './resume-guard'

const dirs: string[] = []
const opened: AppStorage[] = []

afterEach(() => {
  for (const storage of opened.splice(0)) storage.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('pages an interrupted check will resume', () => {
  test('are busy for the due pass until startup resume settles', async () => {
    const storage = seed()
    const guard = guardResumingPages(storage)
    expect(guard.busy('proj-1', 'page-1')).toBe(true)
    expect(guard.busy('proj-1', 'page-2')).toBe(true)
    expect(guard.busy('proj-1', 'page-3')).toBe(false)

    let finish: () => void = () => undefined
    const resume = new Promise<void>((resolve) => {
      finish = resolve
    })
    const tracked = guard.track(resume)
    expect(guard.busy('proj-1', 'page-1')).toBe(true)
    finish()
    await tracked
    expect(guard.busy('proj-1', 'page-1')).toBe(false)
  })

  test('a failed resume also releases the pages', async () => {
    const storage = seed()
    const guard = guardResumingPages(storage)
    await expect(guard.track(Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(guard.busy('proj-1', 'page-1')).toBe(false)
  })
})

function seed(): AppStorage {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-resume-guard-'))
  dirs.push(dir)
  const storage = openAppStorage(dir)
  opened.push(storage)
  insertProject(storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  insertStoredCheckJob(db, {
    id: 'due-interrupted',
    startedAt: '2026-04-20T11:00:00.000Z',
    status: 'running',
    pageIds: ['page-1', 'page-2'],
    marketIds: null,
    promptIds: null,
    reason: 'scheduled',
    message: null,
    nextStep: null
  })
  closeProjectDatabase(db)
  return storage
}
