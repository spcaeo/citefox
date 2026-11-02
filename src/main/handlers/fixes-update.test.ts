import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const [ONE, TWO, THREE] = PROGRESS_SEED.prompts
const base = { projectId: PROGRESS_SEED.projectId }

async function withFix(): Promise<{ seed: ProgressSeed; fixId: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-fixes-update-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  await seed.check(PROGRESS_SEED.first)
  seed.setClock('2026-10-08T09:00:00.000Z')
  const fix = await seed.handlers['fixes:create']({
    ...base,
    pageId: PROGRESS_SEED.pageId,
    description: 'Added a pricing FAQ.',
    goLiveAt: '2026-10-08T00:00:00.000Z',
    rule: 'after_3_days',
    promptIds: [TWO.id],
    marketIds: [PROGRESS_SEED.us]
  })
  return { seed, fixId: fix.id }
}

describe('fixes:update', () => {
  test('edits the text, date, rule, prompts and markets and re-plans the follow-up', async () => {
    const { seed, fixId } = await withFix()
    const updated = await seed.handlers['fixes:update']({
      ...base,
      fixId,
      description: 'Added a pricing FAQ and a table.',
      goLiveAt: '2026-10-10T00:00:00.000Z',
      rule: 'after_7_days',
      promptIds: [ONE.id, THREE.id],
      marketIds: [PROGRESS_SEED.us, PROGRESS_SEED.uk]
    })
    expect(updated).toMatchObject({
      id: fixId,
      number: 1,
      description: 'Added a pricing FAQ and a table.',
      goLiveAt: '2026-10-10T00:00:00.000Z',
      rule: 'after_7_days',
      promptIds: [ONE.id, THREE.id],
      marketIds: [PROGRESS_SEED.us, PROGRESS_SEED.uk],
      status: 'planned'
    })
    expect(updated.followUpAt?.startsWith('2026-10-17')).toBe(true)
    const list = await seed.handlers['fixes:list']({ ...base, pageId: PROGRESS_SEED.pageId })
    expect(list.fixes).toHaveLength(1)
    expect(list.fixes[0]?.description).toBe('Added a pricing FAQ and a table.')
  })

  test('keeps omitted fields and refuses bad requests', async () => {
    const { seed, fixId } = await withFix()
    const updated = await seed.handlers['fixes:update']({
      ...base,
      fixId,
      description: 'New words'
    })
    expect(updated).toMatchObject({ rule: 'after_3_days', promptIds: [TWO.id] })
    await expect(seed.handlers['fixes:update']({ ...base, fixId, promptIds: [] })).rejects.toThrow(
      /at least one prompt/
    )
    await expect(
      seed.handlers['fixes:update']({ ...base, fixId, description: '   ' })
    ).rejects.toThrow(/Describe what you changed/)
    await expect(
      seed.handlers['fixes:update']({ ...base, fixId: 'nope', description: 'x' })
    ).rejects.toThrow(/not found/)
    await expect(
      seed.handlers['fixes:update']({ ...base, fixId, color: 'red' } as never)
    ).rejects.toThrow()
    await expect(
      seed.handlers['fixes:update']({ ...base, fixId, kind: 'redesign' } as never)
    ).rejects.toThrow()
  })

  test('changes the kind without re-planning the follow-up', async () => {
    const { seed, fixId } = await withFix()
    const before = (await seed.handlers['fixes:list']({ ...base, pageId: PROGRESS_SEED.pageId }))
      .fixes[0]
    expect(before?.kind).toBe('fix')
    const updated = await seed.handlers['fixes:update']({ ...base, fixId, kind: 'rewrite' })
    expect(updated).toMatchObject({ kind: 'rewrite', rule: 'after_3_days' })
    expect(updated.followUpAt).toBe(before?.followUpAt)
    const ledger = await seed.handlers['fixes:ledger'](base)
    expect(ledger.rows.find((row) => row.fixId === fixId)?.kind).toBe('rewrite')
  })
})

describe('fixes:restore', () => {
  test('puts a deleted fix back with its number, once', async () => {
    const { seed, fixId } = await withFix()
    await seed.handlers['fixes:update']({ ...base, fixId, kind: 'new_page' })
    await seed.handlers['fixes:delete']({ ...base, fixId })
    const back = await seed.handlers['fixes:restore']({ ...base, fixId })
    expect(back).toMatchObject({ id: fixId, number: 1, promptIds: [TWO.id], kind: 'new_page' })
    const list = await seed.handlers['fixes:list']({ ...base, pageId: PROGRESS_SEED.pageId })
    expect(list.fixes.map((fix) => fix.id)).toEqual([fixId])
    await expect(seed.handlers['fixes:restore']({ ...base, fixId })).rejects.toThrow(
      /no longer be put back/
    )
  })

  test('refuses a fix that was never deleted here', async () => {
    const { seed, fixId } = await withFix()
    await expect(seed.handlers['fixes:restore']({ ...base, fixId })).rejects.toThrow(
      /no longer be put back/
    )
  })
})
