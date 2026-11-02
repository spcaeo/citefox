import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LoggedFix } from '@shared/domain'
import type { CreateFixRequest } from '@shared/ipc'
import { readStoredCheckCatalog } from '../headless/storage-pass'
import { deleteApiKey } from '../storage/records'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const [, TWO, THREE] = PROGRESS_SEED.prompts
const GO_LIVE = '2026-10-08T00:00:00.000Z'

describe('logging a fix and its follow-up (FR-14.5 to FR-14.7) on real IPC', () => {
  test('plans the follow-up, runs it now as a partial check, and gives a verdict', async () => {
    const seed = await baseline()
    seed.setClock('2026-10-08T09:00:00.000Z')
    const preview = await seed.handlers['fixes:preview']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      goLiveAt: GO_LIVE,
      promptIds: [TWO.id, THREE.id],
      marketIds: [PROGRESS_SEED.us, PROGRESS_SEED.uk]
    })
    expect(preview).toMatchObject({
      nextFixNumber: 1,
      samples: 1,
      searchesMin: 4,
      searchesMax: 8,
      followUpAt: {
        after_3_days: '2026-10-11T00:00:00.000Z',
        after_7_days: '2026-10-15T00:00:00.000Z'
      }
    })
    expect(preview.followUpAt.next_scheduled).not.toBeNull()
    expect(String(preview.followUpAt.next_scheduled) >= GO_LIVE).toBe(true)

    const created = await seed.handlers['fixes:create'](fixRequest())
    expect(created).toMatchObject({
      number: 1,
      description: 'Added a pricing FAQ.',
      status: 'planned',
      promptIds: [TWO.id],
      marketIds: [PROGRESS_SEED.us],
      followUpAt: '2026-10-11T00:00:00.000Z',
      createdAt: '2026-10-08T09:00:01.000Z'
    })
    expect(created.markets).toHaveLength(1)
    expect(created.markets[0]).toMatchObject({ verdict: 'waiting', afterRunId: null })
    expect(created.markets[0]?.beforeRunId).not.toBeNull()
    expect(plannedFixIds(seed)).toEqual([created.id])

    // The recorded follow-up body for prompt 2 now cites the page.
    seed.bodies.set(`us|${TWO.text}`, 'google-ai-overview.json')
    seed.setClock('2026-10-12T09:00:00.000Z')
    const run = await seed.handlers['fixes:runFollowUp']({
      projectId: PROGRESS_SEED.projectId,
      fixId: created.id
    })
    expect(run.fix.status).toBe('started')
    expect(run.fix.followUpJobId).toBe(run.jobId)
    expect(plannedFixIds(seed)).toEqual([])

    const done = await waitForCompleted(seed)
    expect(done.verdict).toBe('Worked')
    const market = done.markets[0]
    expect(market).toMatchObject({ verdict: 'worked', compared: 1, worked: 1, afterPartial: true })
    expect(market?.prompts).toEqual([
      expect.objectContaining({
        promptId: TWO.id,
        promptPosition: 2,
        before: { status: 'other_own_page', position: expect.any(Number) },
        after: { status: 'page_cited', position: expect.any(Number) },
        result: 'worked'
      })
    ])
    expect(market?.others).toBeNull()

    // NFR-14: the after state is the one Results shows for that run.
    const results = await seed.handlers['results:get']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      marketId: PROGRESS_SEED.us,
      runId: market?.afterRunId ?? null
    })
    expect(results.run?.partial).toBe(true)
    expect(results.prompts.map((row) => row.promptId)).toEqual([TWO.id])
    expect(results.prompts[0]?.status).toBe(market?.prompts[0]?.after?.status)
    const history = await seed.handlers['results:history']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      marketId: PROGRESS_SEED.us
    })
    expect(history.points.map((point) => point.partial)).toEqual([false, true])

    // A later full check gives the comparison: prompt 3 moved, prompt 1 did not.
    seed.bodies.set(`us|${THREE.text}`, 'google-own-page.json')
    await seed.check(PROGRESS_SEED.second)
    const later = await seed.handlers['fixes:list']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId
    })
    expect(later.nextFixNumber).toBe(2)
    expect(later.fixes[0]?.markets[0]?.others).toMatchObject({
      total: 2,
      moved: 1,
      promptIds: [THREE.id]
    })
  })

  test('a follow-up that cannot start says why and stays planned', async () => {
    const seed = await baseline()
    const created = await seed.handlers['fixes:create'](fixRequest())
    deleteApiKey(seed.storage.db, 'key-1')
    await expect(
      seed.handlers['fixes:runFollowUp']({ projectId: PROGRESS_SEED.projectId, fixId: created.id })
    ).rejects.toThrow(/fixes:runFollowUp: /)
    const listed = await seed.handlers['fixes:list']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId
    })
    expect(listed.fixes[0]).toMatchObject({ status: 'planned', followUpJobId: null })
    expect(plannedFixIds(seed)).toEqual([created.id])
  })

  test('refuses a fix without words, prompts outside the set, or an unknown market', async () => {
    const seed = await baseline()
    await expect(
      seed.handlers['fixes:create']({ ...fixRequest(), description: '   ' })
    ).rejects.toThrow('Describe what you changed first')
    await expect(seed.handlers['fixes:create']({ ...fixRequest(), promptIds: [] })).rejects.toThrow(
      'Pick at least one prompt'
    )
    await expect(
      seed.handlers['fixes:create']({ ...fixRequest(), promptIds: ['prompt-x'] })
    ).rejects.toThrow('Pick prompts from the current prompt set')
    await expect(
      seed.handlers['fixes:create']({ ...fixRequest(), marketIds: ['mkt-mx'] })
    ).rejects.toThrow('Unknown page market')
    await expect(
      seed.handlers['fixes:create']({ ...fixRequest(), goLiveAt: 'tomorrow' })
    ).rejects.toThrow('Pick a valid date')
    await expect(
      seed.handlers['fixes:runFollowUp']({ projectId: PROGRESS_SEED.projectId, fixId: 'nope' })
    ).rejects.toThrow('That fix was not found')
  })

  test('deletes a planned fix and renumbers nothing', async () => {
    const seed = await baseline()
    const first = await seed.handlers['fixes:create'](fixRequest())
    const second = await seed.handlers['fixes:create']({
      ...fixRequest(),
      description: 'Rewrote the intro.'
    })
    expect(second.number).toBe(2)
    const after = await seed.handlers['fixes:delete']({
      projectId: PROGRESS_SEED.projectId,
      fixId: first.id
    })
    expect(after.fixes.map((fix) => fix.number)).toEqual([2])
    expect(after.nextFixNumber).toBe(3)
    expect(plannedFixIds(seed)).toEqual([second.id])
  })
})

describe('page history and notes (FR-15.1 to FR-15.3) on real IPC', () => {
  test('lists checks with score and change, content changes, prompt sets, fixes and notes', async () => {
    const seed = await baseline()
    seed.readPage('snap-2', '2026-10-15T12:00:00.000Z', {
      body: 'TextBolt sends text alerts from email. Schedule them for Saturday. No developer required.',
      faqs: [
        { question: 'Does it work with Gmail?', answer: 'Yes.', typo: null },
        { question: 'Can staff reply?', answer: 'Yes, by email.', typo: null }
      ]
    })
    seed.bodies.set(`us|${TWO.text}`, 'google-ai-overview.json')
    await seed.check(PROGRESS_SEED.second)
    await seed.handlers['fixes:create'](fixRequest())
    const note = await seed.handlers['history:addNote']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      date: '2026-10-16',
      text: '  Rewrote the intro.  '
    })
    expect(note).toMatchObject({ date: '2026-10-16', text: 'Rewrote the intro.' })

    const history = await seed.handlers['history:list']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      marketId: null
    })
    expect(history.marketId).toBe(PROGRESS_SEED.us)
    expect(history.events.map((event) => event.primary)).toEqual([
      'check',
      'note',
      'fix',
      'check',
      'content',
      'prompt_set'
    ])
    const [latest, , fix, baselineCheck, firstRead, promptSet] = history.events
    expect(latest?.kinds).toEqual(['check', 'content'])
    expect(latest?.check).toMatchObject({ kind: 'manual', partial: false, contentChanged: true })
    expect(latest?.title).toBe('Manual check')
    expect(latest?.content).toMatchObject({
      fromSnapshotId: 'snap-1',
      toSnapshotId: 'snap-2',
      summary: expect.stringContaining('2 FAQs added')
    })
    expect(baselineCheck?.title).toBe('Baseline check')
    expect(baselineCheck?.check).toMatchObject({ scoreChange: null, contentChanged: null })
    expect(firstRead?.content?.fromSnapshotId).toBeNull()
    expect(fix?.title).toBe('Fix 1 · Added a pricing FAQ.')
    expect(fix?.detail).toContain('Targets prompt 2')
    expect(promptSet?.promptSet).toMatchObject({ version: 1, promptCount: 3, active: true })

    // NFR-14: each check's score and change are the Results numbers.
    const trend = await seed.handlers['results:history']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      marketId: PROGRESS_SEED.us
    })
    const [firstPoint, secondPoint] = trend.points
    expect(baselineCheck?.check?.score).toBe(firstPoint?.visibilityScore)
    expect(latest?.check?.score).toBe(secondPoint?.visibilityScore)
    expect(latest?.check?.scoreChange).toBe(
      (secondPoint?.visibilityScore ?? 0) - (firstPoint?.visibilityScore ?? 0)
    )

    const diff = await seed.handlers['history:compare']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      fromSnapshotId: 'snap-1',
      toSnapshotId: 'snap-2'
    })
    expect(diff.summary).toContain('2 FAQs added')
    expect(diff.body).toContainEqual({ op: 'added', text: 'Schedule them for Saturday.' })
    expect(diff.faqs).toContainEqual({ op: 'added', text: 'Q: Can staff reply?' })

    const edited = await seed.handlers['history:updateNote']({
      projectId: PROGRESS_SEED.projectId,
      noteId: note.id,
      date: '2026-10-17',
      text: 'Rewrote the intro and the CTA.'
    })
    expect(edited).toMatchObject({ date: '2026-10-17', text: 'Rewrote the intro and the CTA.' })
    await expect(
      seed.handlers['history:deleteNote']({ projectId: PROGRESS_SEED.projectId, noteId: note.id })
    ).resolves.toEqual({ noteId: note.id })
    const without = await seed.handlers['history:list']({
      projectId: PROGRESS_SEED.projectId,
      pageId: PROGRESS_SEED.pageId,
      marketId: PROGRESS_SEED.us
    })
    expect(without.events.some((event) => event.primary === 'note')).toBe(false)
  })

  test('refuses an empty note, a bad date, an unknown note and reads of another page', async () => {
    const seed = await baseline()
    const base = { projectId: PROGRESS_SEED.projectId, pageId: PROGRESS_SEED.pageId }
    await expect(
      seed.handlers['history:addNote']({ ...base, date: '2026-10-16', text: ' ' })
    ).rejects.toThrow('Write the note first')
    await expect(
      seed.handlers['history:addNote']({ ...base, date: '2026-13-01', text: 'Hi' })
    ).rejects.toThrow('Pick a valid date')
    await expect(
      seed.handlers['history:deleteNote']({ projectId: PROGRESS_SEED.projectId, noteId: 'nope' })
    ).rejects.toThrow('That note was not found')
    await expect(
      seed.handlers['history:compare']({ ...base, fromSnapshotId: 'snap-1', toSnapshotId: 'nope' })
    ).rejects.toThrow('Those page reads were not found')
    await expect(
      seed.handlers['history:list']({ ...base, pageId: 'page-x', marketId: null })
    ).rejects.toThrow('That page is not in this project')
  })
})

async function baseline(): Promise<ProgressSeed> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-progress-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  await seed.check(PROGRESS_SEED.first)
  return seed
}

function fixRequest(): CreateFixRequest {
  return {
    projectId: PROGRESS_SEED.projectId,
    pageId: PROGRESS_SEED.pageId,
    description: 'Added a pricing FAQ.',
    goLiveAt: GO_LIVE,
    rule: 'after_3_days',
    promptIds: [TWO.id],
    marketIds: [PROGRESS_SEED.us]
  }
}

function plannedFixIds(seed: ProgressSeed): string[] {
  return (readStoredCheckCatalog(seed.storage).catalog.followUps ?? []).map((fix) => fix.id)
}

async function waitForCompleted(seed: ProgressSeed): Promise<LoggedFix> {
  return vi.waitFor(
    async () => {
      const list = await seed.handlers['fixes:list']({
        projectId: PROGRESS_SEED.projectId,
        pageId: PROGRESS_SEED.pageId
      })
      const fix = list.fixes[0]
      if (fix?.status !== 'completed') throw new Error('follow-up still running')
      return fix
    },
    { timeout: 10_000, interval: 50 }
  )
}
