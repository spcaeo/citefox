import type { Market } from '@shared/domain'
import type {
  ImportCounts,
  ImportRowCheck,
  ImportValues,
  QuestionsDraft,
  QuestionTarget,
  QuestionTargets
} from '@shared/ipc'
import { runMockAssist } from '../assist/mock'
import { mockStartCheck } from '../assistant/mock'
import { emptyCatalog, textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, type ProjectMemory } from '../mocks/m2/memory'
import { readMockCatalog } from '../projects/mockClient'
import { mockHelpFillSource } from './mockHelpFill'
import type { AddQuestionsSource } from './source'

/**
 * Add questions on the in-memory mock (the Vite harness and the e2e mock
 * build, W3I-G). The mock shell's projects exist only in the renderer, so the
 * real main process answers "That project was not found" for them; this source
 * answers from the same sample catalog instead. Rows are checked with the
 * plain rules (empty, repeated, already added) and kept in memory until the
 * window reloads. Loaded only through a dynamic import behind `mocksAllowed()`.
 */

interface Added {
  promptId: string
  sourceId: string
  text: string
  batchId: string
}

interface MockState {
  memory: ProjectMemory
  added: Added[]
  sequence: number
  drafts: Map<string, QuestionsDraft>
}

let state: MockState | null = null

function current(): MockState {
  state ??= {
    memory: createProjectMemory(
      readMockCatalog() === 'textbolt' ? textboltCatalog() : emptyCatalog()
    ),
    added: [],
    sequence: 0,
    drafts: new Map()
  }
  return state
}

/** Fresh catalog and no added questions (tests). */
export function resetMockAddQuestions(): void {
  state = null
}

function fold(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/[?.!]+$/u, '')
}

function targets(projectId: string): QuestionTargets {
  const { memory, added } = current()
  const project = memory.get(projectId)
  const pages = memory.listPages(projectId).pages
  const list: QuestionTarget[] = pages.map((page) => {
    const markets = memory.getPage(projectId, page.id).markets
    return {
      id: page.id,
      kind: page.kind ?? 'page',
      name: page.label ?? page.title ?? page.url ?? page.id,
      url: page.url,
      status: page.status,
      questions: page.promptCount + added.filter((item) => item.sourceId === page.id).length,
      keywords: 0,
      samples: page.samples,
      marketIds: markets.map((item) => item.id),
      nextCheckAt: null,
      intervalDays: page.intervalDays
    }
  })
  const markets = new Map<string, Market>()
  if (project.defaultMarket) markets.set(project.defaultMarket.id, project.defaultMarket)
  for (const page of pages) {
    for (const item of memory.getPage(projectId, page.id).markets) markets.set(item.id, item)
  }
  return { projectId, markets: [...markets.values()], searchesLeft: 500, targets: list }
}

function check(values: ImportValues, targetId: string | null, seen: Set<string>): ImportRowCheck {
  const text = (values.question ?? '').trim()
  if (text.length === 0) {
    return {
      result: 'fix',
      reason: 'The question is empty.',
      fix: 'empty',
      match: null,
      kind: null
    }
  }
  const key = fold(text)
  const tracked = current().added.find((item) => fold(item.text) === key)
  if (tracked) {
    return {
      result: 'duplicate',
      reason: 'Already tracked.',
      fix: null,
      match: {
        text: tracked.text,
        sourceId: tracked.sourceId,
        sourceName: tracked.sourceId,
        sameTarget: tracked.sourceId === targetId
      },
      kind: 'question'
    }
  }
  if (seen.has(key)) {
    return {
      result: 'duplicate',
      reason: 'Repeated above.',
      fix: null,
      match: null,
      kind: 'question'
    }
  }
  seen.add(key)
  return { result: 'new', reason: null, fix: null, match: null, kind: 'question' }
}

function counts(rows: readonly ImportRowCheck[]): ImportCounts {
  const out = { new: 0, keyword: 0, similar: 0, duplicate: 0, fix: 0, total: rows.length }
  for (const row of rows) out[row.result] += 1
  return out
}

export function createMockAddQuestionsSource(): AddQuestionsSource {
  return {
    'prompts:addTargets': async ({ projectId }) => targets(projectId),
    // The tracked list feeds counts and "From tracked questions"; the drawer works without it.
    'questions:list': async () => {
      throw new Error('The tracked questions list is not in the mock.')
    },
    'import:validate': async ({ targetId, rows }) => {
      const seen = new Set<string>()
      const checked = rows.map((row) => ({ key: row.key, ...check(row.values, targetId, seen) }))
      return { rows: checked, counts: counts(checked) }
    },
    'import:commit': async ({ projectId, targetId, rows }) => {
      const mock = current()
      mock.memory.get(projectId)
      if (targetId === null) throw new Error('Pick a page or topic first.')
      const seen = new Set<string>()
      mock.sequence += 1
      const batchId = `mock-batch-${mock.sequence}`
      const promptIds: string[] = []
      const skipped: { index: number; reason: string }[] = []
      rows.forEach((row, index) => {
        const verdict = check(row.values, targetId, seen)
        if (verdict.result !== 'new') {
          skipped.push({ index, reason: verdict.reason ?? 'Skipped.' })
          return
        }
        const promptId = `mock-prompt-${mock.sequence}-${index}`
        promptIds.push(promptId)
        mock.added.push({ promptId, sourceId: targetId, text: row.values.question ?? '', batchId })
      })
      const added = promptIds.length
      return {
        batchId: added > 0 ? batchId : null,
        added,
        skipped,
        promptIds: added > 0 ? [{ sourceId: targetId, promptIds }] : [],
        message: `Added ${added} ${added === 1 ? 'question' : 'questions'}.`
      }
    },
    'import:undo': async ({ batchId }) => {
      const mock = current()
      const before = mock.added.length
      mock.added = mock.added.filter((item) => item.batchId !== batchId)
      const removed = before - mock.added.length
      return { removed, message: `Removed ${removed} ${removed === 1 ? 'question' : 'questions'}.` }
    },
    'import:template': async () => ({ saved: false, fileName: null }),
    'assist:run': async (request) => runMockAssist(request),
    'checks:start': async (request) => mockStartCheck(request),
    'pages:add': async (request) => current().memory.addPage(request),
    'pages:update': async (request) => current().memory.updatePage(request),
    'import:getDraft': async ({ projectId }) => current().drafts.get(projectId) ?? null,
    'import:saveDraft': async (request) => {
      const { drafts } = current()
      if (request.rows.length === 0) drafts.delete(request.projectId)
      else drafts.set(request.projectId, { ...request, savedAt: new Date().toISOString() })
      return { saved: true }
    },
    'import:clearDraft': async ({ projectId }) => ({ cleared: current().drafts.delete(projectId) }),
    ...mockHelpFillSource()
  }
}
