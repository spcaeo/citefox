import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, seed } from '../../engine/checks/checks.test-helper'
import { getPage, getPageMarketFirstCheckNotBefore } from '../../storage/pages'
import { getProject } from '../../storage/records'
import { readProjectCheckSlice } from '../../headless/check-catalog'
import { seedTextboltTopic } from '../fixture-seed'

afterEach(() => {
  closeSeeds()
})

async function seeded(): Promise<Awaited<ReturnType<typeof seed>> & { topicId: string }> {
  const seededProject = await seed({
    progress: [],
    secondPage: true,
    secondPrompt: true,
    http: () => ({ status: 500, body: '{}' })
  })
  const project = getProject(seededProject.storage.db, 'proj-1')
  if (project === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(seededProject.projectDb, project)
  return { ...seededProject, topicId }
}

function jobCount(db: Awaited<ReturnType<typeof seed>>['projectDb']): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM check_jobs').get() as { n: number }).n
}

describe('topics:createEmpty', () => {
  test('makes a named topic with no question, listed and openable, never scheduled', async () => {
    const { handlers, projectDb, storage } = await seeded()
    const jobs = jobCount(projectDb)
    const created = await handlers['topics:createEmpty']({
      projectId: 'proj-1',
      name: '  Pricing  '
    })
    expect(created.name).toBe('Pricing')
    expect(created.questions).toBe(0)
    expect(created.message).toMatch(/^Created Pricing\./u)
    const listed = (await handlers['topics:list']({ projectId: 'proj-1' })).topics.find(
      (topic) => topic.id === created.topicId
    )
    expect(listed).toMatchObject({ name: 'Pricing', status: 'tracked', questions: 0 })
    const results = await handlers['topics:results']({
      projectId: 'proj-1',
      topicId: created.topicId,
      marketId: null,
      runId: null
    })
    expect(results.rows).toEqual([])
    expect(results.topic.questions).toBe(0)
    // Nothing is searched, and the scheduler leaves it out while it is empty.
    expect(jobCount(projectDb)).toBe(jobs)
    const project = getProject(storage.db, 'proj-1')
    if (project === null) throw new Error('no project')
    const slice = readProjectCheckSlice(projectDb, project)
    const page = slice.pages.find((item) => item.pageId === created.topicId)
    expect(page?.noQuestions).toBe(true)
  })

  test('takes questions afterwards through prompts:addQuestions', async () => {
    const { handlers } = await seeded()
    const created = await handlers['topics:createEmpty']({ projectId: 'proj-1', name: 'Pricing' })
    const added = await handlers['prompts:addQuestions']({
      projectId: 'proj-1',
      pageId: created.topicId,
      questions: [{ text: 'How much does a business text alert service cost per month?' }]
    })
    expect(added.promptIds).toHaveLength(1)
    const listed = (await handlers['topics:list']({ projectId: 'proj-1' })).topics.find(
      (topic) => topic.id === created.topicId
    )
    expect(listed?.questions).toBe(1)
  })

  test('refuses a blank name and an unknown market', async () => {
    const { handlers } = await seeded()
    await expect(
      handlers['topics:createEmpty']({ projectId: 'proj-1', name: '   ' })
    ).rejects.toThrow(/name/u)
    await expect(
      handlers['topics:createEmpty']({ projectId: 'proj-1', name: 'X', marketIds: ['mkt-nowhere'] })
    ).rejects.toThrow(/markets/u)
  })
})

describe('topics:duplicate', () => {
  test('copies questions, stages, targets, markets and bands, no history, held check', async () => {
    const { handlers, topicId, projectDb } = await seeded()
    const jobs = jobCount(projectDb)
    const before = await handlers['topics:results']({
      projectId: 'proj-1',
      topicId,
      marketId: null,
      runId: null
    })
    const copy = await handlers['topics:duplicate']({ projectId: 'proj-1', topicId })
    expect(copy.name).toBe(`${before.topic.name} (copy)`)
    expect(copy.questions).toBe(before.rows.length)
    const after = await handlers['topics:results']({
      projectId: 'proj-1',
      topicId: copy.topicId,
      marketId: null,
      runId: null
    })
    expect(after.rows.map((row) => row.text).sort()).toEqual(
      before.rows.map((row) => row.text).sort()
    )
    expect(after.rows.map((row) => row.stage).sort()).toEqual(
      before.rows.map((row) => row.stage).sort()
    )
    expect(after.topic.targetPages).toBe(before.topic.targetPages)
    expect(after.topic.bands).toEqual(before.topic.bands)
    expect(after.topic.markets.map((market) => market.id)).toEqual(
      before.topic.markets.map((market) => market.id)
    )
    expect(after.topic.checkedAt).toBeNull()
    expect(jobCount(projectDb)).toBe(jobs)
    const marketId = after.topic.markets[0]?.id ?? ''
    expect(getPageMarketFirstCheckNotBefore(projectDb, copy.topicId, marketId)).not.toBeNull()

    const second = await handlers['topics:duplicate']({ projectId: 'proj-1', topicId })
    expect(second.name).toBe(`${before.topic.name} (copy 2)`)
    const named = await handlers['topics:duplicate']({ projectId: 'proj-1', topicId, name: 'Mine' })
    expect(named.name).toBe('Mine')
  })

  test('pause leaves it listed as paused; a removed topic cannot be copied', async () => {
    const { handlers, topicId, projectDb } = await seeded()
    const paused = await handlers['topics:update']({
      projectId: 'proj-1',
      topicId,
      status: 'paused'
    })
    expect(paused.status).toBe('paused')
    expect(getPage(projectDb, topicId, 'proj-1')?.status).toBe('paused')
    await handlers['topics:update']({ projectId: 'proj-1', topicId, status: 'removed' })
    await expect(handlers['topics:duplicate']({ projectId: 'proj-1', topicId })).rejects.toThrow(
      /deleted/u
    )
  })
})
