import { describe, expect, test } from 'vitest'
import { textboltCatalog, type ProjectRecord } from './catalog'
import { checkDueFor, pageScoreList, projectScoreList, queueFor, scheduleFor } from './schedule'

const NOW = new Date(2026, 9, 20, 8, 0, 0)

function records(): ProjectRecord[] {
  return textboltCatalog().projects.map((project) => ({
    ...project,
    detail: { ...project.detail },
    pages: project.pages
  }))
}

describe('textbolt score contract', () => {
  test('a paused project keeps nextCheckAt and reports no pages due', () => {
    const fieldpro = records().find((project) => project.detail.id === 'fieldpro')
    if (!fieldpro) throw new Error('missing fieldpro')
    expect(fieldpro.detail.status).toBe('paused')
    const schedule = scheduleFor(fieldpro, NOW)
    expect(schedule.paused).toBe(true)
    expect(schedule.nextCheckAt).not.toBeNull()
    expect(schedule.pagesDueToday).toBe(0)
    const pages = pageScoreList(fieldpro, NOW)
    expect(pages.summary.pagesDueToday).toBe(0)
    expect(pages.summary.nextCheckAt).toBe(schedule.nextCheckAt)
    const tracked = pages.pages.filter((page) => page.nextCheckAt !== null)
    expect(tracked.length).toBeGreaterThan(0)
    expect(tracked.every((page) => page.nextCheckAt === schedule.nextCheckAt)).toBe(true)
  })

  test('an archived project is never due', () => {
    const textbolt = records().find((project) => project.detail.id === 'textbolt')
    if (!textbolt) throw new Error('missing textbolt')
    textbolt.detail.status = 'archived'
    const schedule = scheduleFor(textbolt, NOW)
    expect(schedule.nextCheckAt).toBeNull()
    expect(schedule.pagesDueToday).toBe(0)
    expect(schedule.paused).toBe(false)
    const pages = pageScoreList(textbolt, NOW)
    expect(pages.pages.every((page) => page.nextCheckAt === null)).toBe(true)
  })

  test('glance totals add up, and a paused project still counts toward the soonest check', () => {
    const list = projectScoreList(records(), NOW)
    const schedules = records().map((record) => scheduleFor(record, NOW))
    expect(list.searchesUsed).toBe(
      list.projects.reduce((sum, project) => sum + project.searchesUsed, 0)
    )
    expect(list.projects.reduce((sum, project) => sum + project.pagesDueToday, 0)).toBe(14)
    expect(list.nextCheckAt).not.toBeNull()
    expect(schedules.every((schedule) => schedule.projectId.length > 0)).toBe(true)
    const fieldpro = schedules.find((schedule) => schedule.projectId === 'fieldpro')
    expect(fieldpro?.nextCheckAt).toBe(list.nextCheckAt)
  })

  test('pausing a project does not block check now, and a paused queue does', () => {
    const sample = records()
    const running = checkDueFor({ records: sample, state: 'running', alreadyRan: null, now: NOW })
    expect(running.started).toBe(true)
    expect(running.pages).toBe(14)
    expect(running.jobIds).toEqual(['check-textbolt'])
    const queue = queueFor(sample, 'running', NOW)
    expect(queue.pagesDue).toBe(14)
    expect(queue.projects.find((project) => project.projectId === 'fieldpro')?.paused).toBe(true)
    expect(queue.nextRunAt).not.toBeNull()
    const pausedQueue = checkDueFor({
      records: sample,
      state: 'paused_all',
      alreadyRan: null,
      now: NOW
    })
    expect(pausedQueue).toEqual({ started: false, jobIds: [], pages: 0 })
    expect(queueFor(sample, 'paused_today', NOW).nextRunAt).toBeNull()
    const again = checkDueFor({ records: sample, state: 'running', alreadyRan: running, now: NOW })
    expect(again.started).toBe(false)
    expect(again.jobIds).toEqual(running.jobIds)
  })
})
