import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AssistantContextInput } from '@shared/ipc'
import { seedTwoMarketProject } from '../../../tests/e2e/screens-seed'
import { openAppStorage, type AppStorage } from '../storage/app-storage'
import type { SqliteDatabase } from '../storage/database'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { getProject, type ProjectRecord } from '../storage/records'
import { buildContextPacket } from './packet'
import { numbersText, rowsText } from './packet-text'

/**
 * The context packet over the two-market TextBolt seed: page-1 "Alerts", two
 * prompts in US · EN and UK · EN. Every count is made here in code.
 */

const NOW = new Date('2026-10-20T09:00:00.000Z')
let dir = ''
let storage: AppStorage
let db: SqliteDatabase
let project: ProjectRecord

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'citefox-packet-'))
  await seedTwoMarketProject(dir)
  storage = openAppStorage(dir)
  db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
  const found = getProject(storage.db, 'proj-1')
  if (!found) throw new Error('The seed has no proj-1')
  project = found
})

afterAll(() => {
  closeProjectDatabase(db)
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

function context(patch: Partial<AssistantContextInput> = {}): AssistantContextInput {
  return {
    screen: 'overview',
    screenLabel: 'Summary',
    crumbs: [],
    pageId: null,
    topicId: null,
    promptId: null,
    marketId: null,
    runId: null,
    about: null,
    entities: [],
    selection: [],
    filters: {},
    numbers: [],
    facts: [],
    capabilities: [],
    ...patch
  }
}

function number(packet: ReturnType<typeof buildContextPacket>, label: string): number | undefined {
  return packet.numbers.find((item) => item.label === label)?.value
}

describe('buildContextPacket', () => {
  it('counts the whole project from the latest check of each question and market', () => {
    const packet = buildContextPacket(db, project, context(), NOW)
    expect(packet.scopeLabel).toBe('Whole project')
    expect(packet.scopeRows).toBe(4)
    expect(packet.marketIds).toHaveLength(2)
    expect(packet.rows.map((row) => row.ref)).toEqual(['R1', 'R2', 'R3', 'R4'])
    expect(number(packet, 'Prompt checks (question × market, latest check)')).toBe(4)
    expect(number(packet, 'Questions in scope')).toBe(2)
    expect(number(packet, 'Goal band, low end (share cited)')).toBe(50)
    expect(packet.rivals.map((rival) => rival.domain)).toContain('simpletexting.com')
    expect(packet.pages[0]).toMatchObject({ ref: 'P1', id: 'page-1' })
    // Every number in the prompt carries its ref.
    expect(numbersText(packet)).toMatch(/N1 /)
  })

  it('narrows to the page and market in view and puts the question in view first', () => {
    const packet = buildContextPacket(
      db,
      project,
      context({ screen: 'prompt', pageId: 'page-1', promptId: 'prompt-2', marketId: 'mkt-uk' }),
      NOW
    )
    expect(packet.scopeLabel).toBe('Page: Alerts · UK · EN')
    expect(packet.scopeRows).toBe(2)
    expect(packet.rows[0]).toMatchObject({ promptId: 'prompt-2', marketId: 'mkt-uk', focus: true })
    expect(packet.rows.every((row) => row.marketId === 'mkt-uk')).toBe(true)
    expect(rowsText(packet)).toContain('R1')
  })

  it('keeps every market when the picked one has no checks for the subject', () => {
    const packet = buildContextPacket(
      db,
      project,
      context({ pageId: 'page-1', marketId: 'mkt-nowhere' }),
      NOW
    )
    expect(packet.scopeRows).toBe(4)
  })
})
