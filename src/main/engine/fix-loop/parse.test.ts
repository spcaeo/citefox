import { describe, expect, test } from 'vitest'
import {
  FIX_LOOP_MAX_PAGES,
  parseCheckIndex,
  parseIndexPreview,
  parseLedgerRequest,
  parseLostGround,
  parseSaveRecoveryPlan,
  parseSetKind,
  parseSetOwner,
  parseSuggestAnchors
} from './parse'

describe('fix-loop request parsing', () => {
  test('exact keys only, refused with the channel name', () => {
    expect(parseLedgerRequest({ projectId: 'proj-1' })).toEqual({ projectId: 'proj-1' })
    expect(() => parseLedgerRequest({ projectId: 'proj-1', extra: 1 })).toThrow('fixes:ledger')
    expect(() => parseLedgerRequest(null)).toThrow('fixes:ledger')
    expect(() => parseLedgerRequest({ projectId: '../x' })).toThrow('fixes:ledger')
  })

  test('owners: a known step, a trimmed label up to 40 characters, empty resets', () => {
    expect(parseSetOwner({ projectId: 'p', step: 'index', label: '  Sam ' })).toEqual({
      projectId: 'p',
      step: 'index',
      label: 'Sam'
    })
    expect(parseSetOwner({ projectId: 'p', step: 'index', label: '' }).label).toBe('')
    expect(() => parseSetOwner({ projectId: 'p', step: 'ship', label: 'Sam' })).toThrow(
      'fixes:setOwner'
    )
    expect(() => parseSetOwner({ projectId: 'p', step: 'index', label: 'x'.repeat(41) })).toThrow(
      'Keep the owner to 40 characters or fewer'
    )
  })

  test('kinds', () => {
    expect(parseSetKind({ projectId: 'p', fixId: 'f', kind: 'new_page' }).kind).toBe('new_page')
    expect(() => parseSetKind({ projectId: 'p', fixId: 'f', kind: 'page' })).toThrow(
      'fixes:setKind'
    )
  })

  test('page lists: unique ids, at most 500', () => {
    expect(parseIndexPreview({ projectId: 'p', pageIds: ['a', 'b'] }).pageIds).toEqual(['a', 'b'])
    expect(() => parseIndexPreview({ projectId: 'p', pageIds: ['a', 'a'] })).toThrow(
      'fixes:indexPreview'
    )
    const many = Array.from({ length: FIX_LOOP_MAX_PAGES + 1 }, (_, index) => `page-${index}`)
    expect(() => parseIndexPreview({ projectId: 'p', pageIds: many })).toThrow('fixes:indexPreview')
    expect(parseSuggestAnchors({ projectId: 'p', pageIds: ['a'], refresh: true }).refresh).toBe(
      true
    )
    expect(() => parseSuggestAnchors({ projectId: 'p', pageIds: ['a'], refresh: 'yes' })).toThrow(
      'fixes:suggestAnchors'
    )
  })

  test('the confirmed searches are a whole number', () => {
    expect(
      parseCheckIndex({ projectId: 'p', pageIds: ['a'], confirmedSearches: 2 }).confirmedSearches
    ).toBe(2)
    for (const confirmedSearches of [-1, 1.5, '2', 5000]) {
      expect(() => parseCheckIndex({ projectId: 'p', pageIds: ['a'], confirmedSearches })).toThrow(
        'fixes:checkIndex'
      )
    }
  })

  test('lost ground and its plan', () => {
    expect(parseLostGround({ projectId: 'p', pageId: 'a', vsRunId: null }).vsRunId).toBeNull()
    expect(parseLostGround({ projectId: 'p', pageId: 'a', vsRunId: 'run-1' }).vsRunId).toBe('run-1')
    const plan = { projectId: 'p', pageId: 'a', inputKey: 'run-1|run-2', text: ' 1. Do it. ' }
    expect(parseSaveRecoveryPlan(plan).text).toBe('1. Do it.')
    expect(() => parseSaveRecoveryPlan({ ...plan, inputKey: 'run-1' })).toThrow(
      'fixes:saveRecoveryPlan'
    )
    expect(() => parseSaveRecoveryPlan({ ...plan, inputKey: 'a|b|c' })).toThrow(
      'fixes:saveRecoveryPlan'
    )
    expect(() => parseSaveRecoveryPlan({ ...plan, text: '  ' })).toThrow('Write the plan first')
    expect(() => parseSaveRecoveryPlan({ ...plan, text: 'x'.repeat(8001) })).toThrow(
      'Keep the plan to 8000 characters or fewer'
    )
  })
})
