import { afterEach, describe, expect, test } from 'vitest'
import { cleanupHarness, harness } from '../handlers/test-harness'
import { closeProjectDatabase, createProjectDatabase } from '../storage/project-files'
import { defaultProjectSchedule, writeProjectSchedule } from '../storage/project-schedule'
import { insertProject } from '../storage/records'
import { projectDatabaseRelativePath } from '../storage/slug'

/**
 * A new topic starts on the project's "Re-check every" (setup step 7 sets it), not on
 * a fixed number: 7 days when the project never chose one (owner, 2026-11-01).
 */

afterEach(() => {
  cleanupHarness()
})

function setup(defaultIntervalDays: 1 | 14 | null): ReturnType<typeof harness> {
  const h = harness({})
  insertProject(h.storage.db, {
    id: 'proj-1',
    name: 'TextBolt',
    slug: 'textbolt',
    domain: 'textbolt.com',
    dbPath: projectDatabaseRelativePath('textbolt'),
    clientName: null,
    status: 'active'
  })
  const db = createProjectDatabase(h.storage.paths.projectsDirectory, 'textbolt')
  if (defaultIntervalDays !== null) {
    writeProjectSchedule(db, { ...defaultProjectSchedule('proj-1'), defaultIntervalDays })
  }
  closeProjectDatabase(db)
  return h
}

async function draftInterval(defaultIntervalDays: 1 | 14 | null): Promise<number> {
  const { handlers } = setup(defaultIntervalDays)
  const draft = await handlers['topics:createDraft']({
    projectId: 'proj-1',
    path: 'seed',
    seed: 'Texting crews from Outlook'
  })
  return draft.intervalDays
}

describe('a new topic draft’s re-check interval', () => {
  test('is 7 days when the project never chose one', async () => {
    expect(await draftInterval(null)).toBe(7)
  })

  test('follows the project: every day, or a saved 14 days', async () => {
    expect(await draftInterval(1)).toBe(1)
    cleanupHarness()
    expect(await draftInterval(14)).toBe(14)
  })
})
