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

const base = { projectId: PROGRESS_SEED.projectId }

/** The seed saves simpletexting.com and twilio.com as competitors; Oct 5 cites both. */
async function checked(): Promise<ProgressSeed> {
  const directory = mkdtempSync(join(tmpdir(), 'citefox-competitors-crud-'))
  directories.push(directory)
  const seed = openProgressSeed(directory)
  opened.push(seed)
  await seed.check(PROGRESS_SEED.first)
  seed.setClock('2026-10-06T12:00:00.000Z')
  return seed
}

async function idOf(seed: ProgressSeed, name: string): Promise<string> {
  const list = await seed.handlers['competitors:list'](base)
  const found = list.competitors.find((item) => item.name === name)
  if (found === undefined) throw new Error(`no competitor ${name}`)
  return found.id
}

describe('competitors:overview drill lists', () => {
  test('every row lists exactly the links, questions and names its numbers count', async () => {
    const seed = await checked()
    const overview = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    for (const row of overview.rows) {
      expect(row.links).toHaveLength(row.citations)
      expect(row.citedQuestions).toHaveLength(row.questions)
      expect(row.namedQuestions).toHaveLength(row.named ?? 0)
      expect(row.citedQuestions.reduce((sum, item) => sum + item.links, 0)).toBe(row.citations)
    }
    const simple = overview.rows.find((item) => item.name === 'simpletexting.com')
    expect(simple?.links[0]?.url).toMatch(/^https:\/\/[^/]*simpletexting\.com/)
  })
})

describe('competitor CRUD on a real project file', () => {
  test('lists saved competitors with the ids the Competitors rows use', async () => {
    const seed = await checked()
    const list = await seed.handlers['competitors:list'](base)
    expect(list.competitors.map((item) => [item.name, item.domain, item.tier])).toEqual([
      ['simpletexting.com', 'simpletexting.com', 'direct'],
      ['twilio.com', 'twilio.com', 'direct']
    ])
    const overview = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    const row = overview.rows.find((item) => item.name === 'simpletexting.com')
    expect(row?.id).toBe(list.competitors[0]?.id)
    expect(list.competitors[0]?.id).not.toContain('simpletexting')
  })

  test('adds, edits with an alias, and the overview counts the new name', async () => {
    const seed = await checked()
    const added = await seed.handlers['competitors:save']({
      ...base,
      id: null,
      name: 'ClickSend',
      domain: 'https://www.clicksend.com/us',
      aliases: [],
      tier: 'partial'
    })
    expect(added.competitor).toMatchObject({
      name: 'ClickSend',
      domain: 'clicksend.com',
      tier: 'partial',
      productIds: [null]
    })
    await expect(
      seed.handlers['competitors:save']({
        ...base,
        id: null,
        name: 'Another',
        domain: 'clicksend.com',
        aliases: [],
        tier: 'direct'
      })
    ).rejects.toThrow(/already a saved competitor/)

    const simple = await idOf(seed, 'simpletexting.com')
    const edited = await seed.handlers['competitors:save']({
      ...base,
      id: simple,
      name: 'SimpleTexting',
      domain: 'simpletexting.com',
      aliases: ['app.simpletexting.io'],
      tier: 'direct'
    })
    expect(edited.competitor).toMatchObject({
      name: 'SimpleTexting',
      aliases: ['app.simpletexting.io']
    })
    const overview = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    const row = overview.rows.find((item) => item.name === 'SimpleTexting')
    expect(row).toMatchObject({ kind: 'competitor', citations: 4 })
    const project = await seed.handlers['projects:get'](base)
    expect(project.competitors).toEqual(['simpletexting.com', 'twilio.com', 'clicksend.com'])
  })

  test('removes with undo, and merges two into one with every domain', async () => {
    const seed = await checked()
    const twilio = await idOf(seed, 'twilio.com')
    const removed = await seed.handlers['competitors:remove']({ ...base, ids: [twilio] })
    expect(removed.names).toEqual(['twilio.com'])
    expect((await seed.handlers['competitors:list'](base)).competitors).toHaveLength(1)
    const back = await seed.handlers['competitors:restore']({
      ...base,
      undoToken: removed.undoToken
    })
    expect(back.competitors.map((item) => item.name)).toEqual(['simpletexting.com', 'twilio.com'])
    await expect(
      seed.handlers['competitors:restore']({ ...base, undoToken: removed.undoToken })
    ).rejects.toThrow(/no longer be undone/)

    const simple = await idOf(seed, 'simpletexting.com')
    const merged = await seed.handlers['competitors:merge']({
      ...base,
      ids: [simple, twilio],
      intoId: simple,
      name: 'Texting rivals'
    })
    expect(merged.names).toEqual(['twilio.com'])
    expect(merged.competitor).toMatchObject({
      name: 'Texting rivals',
      domain: 'simpletexting.com',
      aliases: ['twilio.com']
    })
    const overview = await seed.handlers['competitors:overview']({ ...base, period: 30 })
    const row = overview.rows.find((item) => item.name === 'Texting rivals')
    // SimpleTexting's 4 links and Twilio's 1 now count as one competitor.
    expect(row).toMatchObject({ kind: 'competitor', citations: 5 })
    await seed.handlers['competitors:restore']({ ...base, undoToken: merged.undoToken })
    expect((await seed.handlers['competitors:list'](base)).competitors).toHaveLength(2)
  })

  test('sets the kind of a cited site and refuses bad requests', async () => {
    const seed = await checked()
    await expect(
      seed.handlers['competitors:setSiteKind']({ ...base, domain: 'reddit.com', kind: 'services' })
    ).resolves.toEqual({ domain: 'reddit.com', kind: 'services' })
    await expect(
      seed.handlers['competitors:setSiteKind']({
        ...base,
        domain: 'reddit.com',
        kind: 'competitors' as never
      })
    ).rejects.toThrow()
    await expect(
      seed.handlers['competitors:save']({
        ...base,
        id: null,
        name: '  ',
        domain: null,
        aliases: [],
        tier: 'direct'
      })
    ).rejects.toThrow(/Give the competitor a name/)
    await expect(
      seed.handlers['competitors:merge']({ ...base, ids: ['sabc'], intoId: 'sabc' })
    ).rejects.toThrow(/two or more/)
    await expect(seed.handlers['competitors:remove']({ ...base, ids: ['nope'] })).rejects.toThrow(
      /not found/
    )
  })
})
