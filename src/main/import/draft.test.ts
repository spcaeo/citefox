import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { QuestionsDraftRow, SaveQuestionsDraftRequest } from '@shared/ipc'
import {
  clearQuestionsDraft,
  parseSaveDraft,
  readQuestionsDraft,
  writeQuestionsDraft
} from './draft'

/** W3I-C4: Add questions' unsaved rows survive a reload, kept in main until added or discarded. */

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'citefox-qdraft-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function row(question: string, patch: Partial<QuestionsDraftRow> = {}): QuestionsDraftRow {
  return {
    question,
    stage: '',
    page: '',
    market: '',
    tags: '',
    topic: '',
    createTopic: false,
    addMarket: false,
    keep: false,
    origin: 'typed',
    ...patch
  }
}

const DRAFT: SaveQuestionsDraftRequest = {
  projectId: 'proj-1',
  targetId: 'topic-1',
  defaultPage: 'https://textbolt.com/pricing/',
  rows: [
    row('how do I text my whole crew at once', { stage: 'options', origin: 'imported' }),
    row('what does email to sms cost', { topic: 'Pricing', createTopic: true, market: 'mkt-uk' })
  ]
}

describe('the Add questions draft', () => {
  test('is saved per project and read back with when it was saved', () => {
    writeQuestionsDraft(root, DRAFT, new Date('2026-10-23T10:00:00.000Z'))
    expect(readQuestionsDraft(root, 'proj-1')).toEqual({
      ...DRAFT,
      savedAt: '2026-10-23T10:00:00.000Z'
    })
    expect(readQuestionsDraft(root, 'proj-2')).toBeNull()
  })

  test('is cleared when discarded or added, and an empty save clears it too', () => {
    writeQuestionsDraft(root, DRAFT, new Date())
    expect(clearQuestionsDraft(root, 'proj-1')).toBe(true)
    expect(readQuestionsDraft(root, 'proj-1')).toBeNull()
    expect(clearQuestionsDraft(root, 'proj-1')).toBe(false)
    writeQuestionsDraft(root, DRAFT, new Date())
    writeQuestionsDraft(root, { ...DRAFT, rows: [] }, new Date())
    expect(existsSync(join(root, 'question-drafts', 'proj-1.json'))).toBe(false)
  })

  test('a broken file reads as no draft', () => {
    mkdirSync(join(root, 'question-drafts'), { recursive: true })
    writeFileSync(join(root, 'question-drafts', 'proj-1.json'), '{ not json')
    expect(readQuestionsDraft(root, 'proj-1')).toBeNull()
  })

  test('requests are checked: unknown keys, a bad stage, a path in the id are refused', () => {
    expect(parseSaveDraft(DRAFT)).toEqual(DRAFT)
    expect(() => parseSaveDraft({ ...DRAFT, extra: 1 })).toThrow('import:saveDraft')
    expect(() => parseSaveDraft({ ...DRAFT, rows: [{ ...row('x'), stage: 'later' }] })).toThrow(
      'import:saveDraft'
    )
    expect(() => parseSaveDraft({ ...DRAFT, projectId: '../proj-1' })).toThrow('import:saveDraft')
    expect(() => parseSaveDraft({ ...DRAFT, projectId: 'a/b' })).toThrow('import:saveDraft')
  })
})
