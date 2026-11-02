import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AutoExport, ExportSpec } from '@shared/domain'
import type { AutoExportUnavailable, SetAutoExportRequest } from '@shared/ipc'
import { afterEach, describe, expect, test } from 'vitest'
import { runCheckDueCommand } from '../../headless/storage-pass'
import { fixtureCheckRunner } from '../../queue/runner'
import { bindScheduleQueueTray } from '../../scheduler/ipc'
import { listAutoExportRuns } from '../../storage/auto-exports'
import { projectDatabasePool } from '../../storage/project-db-pool'
import {
  RAW_MARKER,
  cleanupExportSeeds,
  exportRequest,
  run,
  seed,
  tempDir
} from '../ipc-seed.test-helper'
import { readStoredZip } from '../zip'
import { configureAutoExportFolderDialog } from './ipc'
import { runAutoExports } from './run'
import { createAutoExportTracker } from './tracker'

const NOW = new Date('2026-10-20T12:00:00.000Z')

afterEach(() => {
  configureAutoExportFolderDialog(null)
  cleanupExportSeeds()
})

function spec(overrides: Partial<ExportSpec> = {}): ExportSpec {
  const { logoBase64, ...rest } = exportRequest()
  void logoBase64
  return { ...rest, ...overrides }
}

function setRequest(overrides: Partial<SetAutoExportRequest> = {}): SetAutoExportRequest {
  return {
    projectId: 'proj-1',
    pageId: 'page-1',
    enabled: true,
    destination: 'folder',
    folder: null,
    emailTo: null,
    spec: spec(),
    ...overrides
  }
}

function pickFolder(folder: string | null): void {
  configureAutoExportFolderDialog(async () =>
    folder === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [folder] }
  )
}

function asAuto(value: AutoExport | AutoExportUnavailable): AutoExport {
  if ('code' in value) throw new Error(`expected an AutoExport, got ${value.code}`)
  return value
}

let ids = 0
function runDeps(
  storage: ReturnType<typeof seed>['storage']
): Parameters<typeof runAutoExports>[0] {
  return {
    storage,
    now: () => NOW,
    createId: () => `auto-${(ids += 1)}`,
    knownSecrets: () => [RAW_MARKER]
  }
}

describe('automatic export settings (exports:getAuto, setAuto, chooseAutoFolder)', () => {
  test('starts off with no folder, and turning it on needs a dialog-chosen folder', async () => {
    const { handlers } = seed([])
    const empty = asAuto(await handlers['exports:getAuto']({ projectId: 'proj-1', pageId: null }))
    expect(empty).toEqual({
      projectId: 'proj-1',
      pageId: null,
      enabled: false,
      destination: 'folder',
      folder: null,
      emailTo: null,
      spec: null,
      runs: []
    })
    expect(await handlers['exports:setAuto'](setRequest())).toEqual({
      code: 'no_folder',
      message: 'Choose a folder for automatic exports first.',
      nextStep: 'Choose a folder, then turn automatic export on.'
    })

    const folder = tempDir()
    pickFolder(folder)
    const chosen = asAuto(
      await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: 'page-1' })
    )
    expect(chosen).toMatchObject({ folder, enabled: false })

    const saved = asAuto(await handlers['exports:setAuto'](setRequest({ folder })))
    expect(saved).toMatchObject({ enabled: true, folder, spec: spec() })
    const again = asAuto(
      await handlers['exports:getAuto']({ projectId: 'proj-1', pageId: 'page-1' })
    )
    expect(again).toEqual(saved)
    // Another scope of the same project is separate.
    expect(
      asAuto(await handlers['exports:getAuto']({ projectId: 'proj-1', pageId: null })).folder
    ).toBeNull()

    // A cancelled dialog changes nothing.
    pickFolder(null)
    expect(
      asAuto(await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: 'page-1' }))
    ).toEqual(saved)

    // Turning it off keeps the folder and the last good settings.
    const off = asAuto(await handlers['exports:setAuto'](setRequest({ enabled: false })))
    expect(off).toMatchObject({ enabled: false, folder, spec: spec() })
  })

  test('the renderer cannot set a path, and unusable folders are refused', async () => {
    const { handlers } = seed([])
    await expect(
      handlers['exports:setAuto'](setRequest({ folder: '/tmp/../etc' }))
    ).rejects.toThrow('Choose the folder with Choose folder')

    const missing = join(tempDir(), 'gone')
    pickFolder(missing)
    expect(
      await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: null })
    ).toMatchObject({ code: 'folder', message: "CiteFox can't write to that folder." })
    pickFolder('relative/folder')
    expect(
      await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: null })
    ).toMatchObject({ code: 'folder' })
    pickFolder(`${tempDir()}/../escape`)
    expect(
      await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: null })
    ).toMatchObject({ code: 'folder' })

    // A folder removed after it was chosen cannot be turned on.
    const later = join(tempDir(), 'later')
    mkdirSync(later)
    pickFolder(later)
    await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: 'page-1' })
    rmSync(later, { recursive: true })
    expect(await handlers['exports:setAuto'](setRequest())).toMatchObject({ code: 'folder' })

    await expect(handlers['exports:getAuto']({ projectId: 'nope', pageId: null })).rejects.toThrow(
      'Unknown project'
    )
    configureAutoExportFolderDialog(null)
    expect(
      await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: null })
    ).toMatchObject({ code: 'unavailable' })
  })

  test('email and settings that cannot be repeated are refused with a fixed sentence', async () => {
    const { handlers } = seed([])
    pickFolder(tempDir())
    await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: 'page-1' })
    expect(
      await handlers['exports:setAuto'](
        setRequest({ destination: 'email', emailTo: 'me@example.com' })
      )
    ).toMatchObject({
      code: 'email',
      nextStep: 'To email a report, add a scheduled report in Reports.'
    })
    expect(
      await handlers['exports:setAuto'](setRequest({ spec: spec({ sections: [] }) }))
    ).toMatchObject({ code: 'invalid' })
    expect(
      await handlers['exports:setAuto'](setRequest({ spec: spec({ projectId: 'proj-2' }) }))
    ).toMatchObject({ code: 'invalid' })
    expect(
      await handlers['exports:setAuto'](
        setRequest({ spec: spec({ sections: ['raw'], format: 'csv' }) })
      )
    ).toMatchObject({ code: 'invalid' })
  })
})

describe('automatic export runs (FR-22.6)', () => {
  test('writes a new file per run with the save-dialog name and never replaces one', async () => {
    const { handlers, storage } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const folder = tempDir()
    pickFolder(folder)
    await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: 'page-1' })
    asAuto(await handlers['exports:setAuto'](setRequest()))

    const checked = [{ projectId: 'proj-1', pageIds: new Set(['page-1']) }]
    const first = await runAutoExports(runDeps(storage), checked)
    expect(first).toMatchObject([
      { outcome: 'ok', filename: 'TextBolt-alerts-2026-10-19.zip', format: 'csv' }
    ])
    const firstBytes = readFileSync(join(folder, 'TextBolt-alerts-2026-10-19.zip'))
    const text = readStoredZip(firstBytes)
      .map((entry) => entry.data.toString('utf8'))
      .join('\n')
    expect(text).toContain('How do I alert the crew?')
    expect(text).not.toContain(RAW_MARKER)

    const second = await runAutoExports(runDeps(storage), checked)
    expect(second[0]).toMatchObject({
      outcome: 'ok',
      filename: 'TextBolt-alerts-2026-10-19 (2).zip'
    })
    expect(readFileSync(join(folder, 'TextBolt-alerts-2026-10-19.zip'))).toEqual(firstBytes)
    expect(readdirSync(folder).sort()).toEqual([
      'TextBolt-alerts-2026-10-19 (2).zip',
      'TextBolt-alerts-2026-10-19.zip'
    ])

    const view = asAuto(
      await handlers['exports:getAuto']({ projectId: 'proj-1', pageId: 'page-1' })
    )
    expect(view.runs.map((item) => item.filename)).toEqual([
      'TextBolt-alerts-2026-10-19 (2).zip',
      'TextBolt-alerts-2026-10-19.zip'
    ])
    expect(view.runs[0]).toMatchObject({ outcome: 'ok', reason: null, format: 'csv' })
  })

  test('records a failure when the folder is gone, and skips specs the pass did not touch', async () => {
    const { handlers, storage } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const folder = join(tempDir(), 'exports')
    mkdirSync(folder)
    pickFolder(folder)
    await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: 'page-1' })
    asAuto(await handlers['exports:setAuto'](setRequest()))

    // A pass that checked another page leaves this page's spec alone.
    expect(
      await runAutoExports(runDeps(storage), [
        { projectId: 'proj-1', pageIds: new Set(['page-9']) }
      ])
    ).toEqual([])

    rmSync(folder, { recursive: true })
    const failed = await runAutoExports(runDeps(storage), [
      { projectId: 'proj-1', pageIds: new Set(['page-1']) }
    ])
    expect(failed).toMatchObject([
      {
        outcome: 'failed',
        filename: null,
        reason: 'The export folder is missing or CiteFox cannot write to it.',
        nextStep: 'Open Export and choose the folder again.'
      }
    ])
    expect(existsSync(folder)).toBe(false)
    const db = projectDatabasePool(storage).get('textbolt')
    expect(listAutoExportRuns(db, 'page-1')).toHaveLength(1)

    // Turned off: nothing runs.
    await handlers['exports:setAuto'](setRequest({ enabled: false }))
    expect(
      await runAutoExports(runDeps(storage), [
        { projectId: 'proj-1', pageIds: new Set(['page-1']) }
      ])
    ).toEqual([])
  })

  test('a project-wide spec runs for any checked page and a name clash gets a suffix', async () => {
    const { handlers, storage } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const folder = tempDir()
    writeFileSync(join(folder, 'TextBolt-project-2026-10-19.json'), 'keep me')
    pickFolder(folder)
    await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: null })
    asAuto(
      await handlers['exports:setAuto'](
        setRequest({
          pageId: null,
          spec: spec({
            scope: 'project',
            pageIds: [],
            format: 'json',
            csv: null,
            filenamePattern: '{project}-project-{date}.{ext}'
          })
        })
      )
    )
    const result = await runAutoExports(runDeps(storage), [
      { projectId: 'proj-1', pageIds: new Set(['page-1']) }
    ])
    expect(result).toMatchObject([
      { outcome: 'ok', filename: 'TextBolt-project-2026-10-19 (2).json' }
    ])
    expect(readFileSync(join(folder, 'TextBolt-project-2026-10-19.json'), 'utf8')).toBe('keep me')
  })
})

describe('automatic exports follow scheduled checks', () => {
  test('the tracker ignores Check now, batches per project, and never overlaps', async () => {
    const batches: string[][] = []
    let active = 0
    let overlapped = false
    const tracker = createAutoExportTracker(async (checked) => {
      active += 1
      if (active > 1) overlapped = true
      await new Promise((resolve) => setTimeout(resolve, 5))
      batches.push(
        checked.flatMap((item) => [...item.pageIds].map((p) => `${item.projectId}/${p}`))
      )
      active -= 1
    })
    tracker.note({ projectId: 'a', pageId: 'p1', reason: 'manual' })
    expect(tracker.pending()).toEqual([])
    tracker.note({ projectId: 'a', pageId: 'p1', reason: 'scheduled' })
    tracker.note({ projectId: 'a', pageId: 'p2', reason: 'follow_up' })
    tracker.note({ projectId: 'a', pageId: 'p1', reason: 'scheduled' })
    const first = tracker.flush()
    tracker.note({ projectId: 'b', pageId: 'p3', reason: 'scheduled' })
    const second = tracker.flush()
    await Promise.all([first, second, tracker.flush()])
    expect(batches).toEqual([['a/p1', 'a/p2'], ['b/p3']])
    expect(overlapped).toBe(false)
  })

  test('the window due pass and the headless --check-due pass both run them', async () => {
    const { handlers, storage } = seed([
      run('run-late', '2026-10-19T15:00:00.000Z', '2026-10-19T16:00:00.000Z')
    ])
    const folder = tempDir()
    pickFolder(folder)
    await handlers['exports:chooseAutoFolder']({ projectId: 'proj-1', pageId: 'page-1' })
    asAuto(await handlers['exports:setAuto'](setRequest()))
    const tracker = createAutoExportTracker((checked) => runAutoExports(runDeps(storage), checked))

    const headless = await runCheckDueCommand({
      storage,
      clock: { now: () => NOW.getTime() },
      timeZone: 'UTC',
      runner: fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] })),
      autoExport: tracker
    })
    expect(headless).toBe(0)
    expect(readdirSync(folder)).toEqual(['TextBolt-alerts-2026-10-19.zip'])

    // The window's pass: a later day, so the page is due again.
    const later = new Date('2026-11-20T12:00:00.000Z')
    const bound = bindScheduleQueueTray({
      now: () => later,
      timeZone: 'UTC',
      emit: () => undefined,
      claudeConcurrency: () => 2,
      keys: () => [],
      storage,
      runner: fixtureCheckRunner(() => ({ outcome: 'ok', searches: [] })),
      autoExport: tracker
    })
    const pass = await bound.queue.checkDue()
    expect(pass.pages).toBe(1)
    await tracker.flush()
    expect(readdirSync(folder).sort()).toEqual([
      'TextBolt-alerts-2026-10-19 (2).zip',
      'TextBolt-alerts-2026-10-19.zip'
    ])
  })
})
