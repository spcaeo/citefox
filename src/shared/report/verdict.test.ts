import { describe, expect, test } from 'vitest'
import type { ChangeCounts } from './diff'
import {
  buildVerdict,
  clearMove,
  findingText,
  MAX_FINDINGS,
  verdictStatus,
  type VerdictCount,
  type VerdictInput
} from './verdict'

function changes(gained: number, kept: number, lost: number, never: number): ChangeCounts {
  return { gained, kept, lost, never, unmatched: 0 }
}

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    brand: 'TextBolt',
    compareLabel: 'the previous check',
    tracked: 20,
    aio: 18,
    cited: 9,
    named: 4,
    notVisible: 6,
    changes: changes(5, 4, 1, 8),
    namedBefore: 2,
    namedAfter: 4,
    topSite: { name: 'reddit.com', count: 11 },
    ...overrides
  }
}

function counts(verdict: ReturnType<typeof buildVerdict>): VerdictCount[] {
  return verdict.findings.flatMap((finding) =>
    finding.parts.filter((part): part is VerdictCount => typeof part !== 'string')
  )
}

describe('verdictStatus', () => {
  test('too early without an earlier check, or with fewer than 3 questions measured both times', () => {
    expect(verdictStatus(null)).toBe('early')
    expect(verdictStatus(changes(2, 0, 0, 0))).toBe('early')
  })

  test('a clear move is at least 2 questions and 10% of those measured both times', () => {
    expect(clearMove(5)).toBe(2)
    expect(clearMove(40)).toBe(4)
    expect(clearMove(41)).toBe(5)
  })

  test('strong, working, flat, mixed and slipping', () => {
    expect(verdictStatus(changes(4, 2, 0, 14))).toBe('strong')
    expect(verdictStatus(changes(2, 2, 1, 15))).toBe('working')
    expect(verdictStatus(changes(0, 5, 0, 15))).toBe('flat')
    expect(verdictStatus(changes(2, 3, 3, 12))).toBe('mixed')
    expect(verdictStatus(changes(0, 3, 1, 16))).toBe('mixed')
    expect(verdictStatus(changes(0, 1, 4, 15))).toBe('slipping')
  })
})

describe('buildVerdict', () => {
  test('a strong result: badge, movement first, every number names its set', () => {
    const verdict = buildVerdict(input())
    expect(verdict.label).toBe('Working, strong early results')
    expect(verdict.tone).toBe('ok')
    expect(verdict.findings.map((finding) => finding.id)).toEqual([
      'movement',
      'holding',
      'named',
      'opportunity',
      'competition'
    ])
    expect(findingText(verdict.findings[0]!)).toBe(
      'More answers cite you. Questions citing TextBolt went from 5 to 9 since the previous check: 5 gained, 1 lost.'
    )
    expect(findingText(verdict.findings[1]!)).toBe(
      'Most citations are holding. 4 of the 5 questions that cited TextBolt at the previous check still do.'
    )
    expect(findingText(verdict.findings[2]!)).toBe(
      'Named more often. TextBolt is named in the answer text for 4 questions, up from 2.'
    )
    expect(findingText(verdict.findings[4]!)).toBe(
      'reddit.com is cited more. 11 questions cite reddit.com; 9 cite TextBolt.'
    )
    const sets = counts(verdict)
    expect(sets.find((item) => item.set === 'gained')?.label).toBe(
      'Gained since the previous check'
    )
    expect(sets.find((item) => item.set === 'cited_before')?.n).toBe(5)
    expect(sets.find((item) => item.set === 'cited_after')?.n).toBe(9)
  })

  test('the move between the two counts is exactly gained minus lost', () => {
    const verdict = buildVerdict(input({ changes: changes(2, 6, 5, 7) }))
    const sets = counts(verdict)
    const value = (set: string): number => sets.find((item) => item.set === set)?.n ?? -1
    expect(value('cited_after') - value('cited_before')).toBe(value('gained') - value('lost'))
    expect(verdict.findings[0]?.tone).toBe('bad')
    expect(verdict.findings[0]?.lead).toBe('Fewer answers cite you.')
  })

  test('no earlier check: a first-measurement finding and "Too early to tell"', () => {
    const verdict = buildVerdict(
      input({ compareLabel: null, changes: null, namedBefore: null, namedAfter: null })
    )
    expect(verdict.label).toBe('Too early to tell')
    expect(verdict.findings[0]?.id).toBe('first')
    expect(findingText(verdict.findings[0]!)).toBe(
      'First measurement. Google shows an AI Overview for 18 of 20 questions, and 9 cite TextBolt. The next check shows what changes.'
    )
    expect(verdict.findings.map((finding) => finding.id)).toEqual([
      'first',
      'named',
      'opportunity',
      'competition'
    ])
  })

  test('nothing moved: "Not moving yet" and the same count', () => {
    const verdict = buildVerdict(input({ changes: changes(0, 3, 0, 10), namedBefore: 4 }))
    expect(verdict.label).toBe('Not moving yet')
    expect(findingText(verdict.findings[0]!)).toBe(
      'No citation changed. The same 3 questions cite TextBolt as at the previous check.'
    )
    expect(verdict.findings.some((finding) => finding.id === 'holding')).toBe(false)
  })

  test('you lead when no other site is cited more often', () => {
    const verdict = buildVerdict(input({ topSite: { name: 'reddit.com', count: 3 } }))
    const competition = verdict.findings.find((finding) => finding.id === 'competition')
    expect(competition?.tone).toBe('ok')
    expect(findingText(competition!)).toBe(
      'TextBolt is the most cited site. 9 questions cite TextBolt, more than any other site. Next is reddit.com, with 3.'
    )
  })

  test('a tie with the most cited other site is said as a tie, not a lead', () => {
    const verdict = buildVerdict(input({ topSite: { name: 'reddit.com', count: 9 } }))
    const competition = verdict.findings.find((finding) => finding.id === 'competition')
    expect(competition?.tone).toBe('neutral')
    expect(findingText(competition!)).toBe(
      'TextBolt and reddit.com are cited equally. 9 questions cite TextBolt, and 9 cite reddit.com.'
    )
  })

  test('never more than five findings, and empty parts are left out', () => {
    const verdict = buildVerdict(input({ notVisible: 0, named: 0, namedBefore: 0, namedAfter: 0 }))
    expect(verdict.findings.length).toBeLessThanOrEqual(MAX_FINDINGS)
    expect(verdict.findings.some((finding) => finding.id === 'opportunity')).toBe(false)
    expect(verdict.findings.some((finding) => finding.id === 'named')).toBe(false)
  })

  test('the same input always gives the same verdict', () => {
    expect(buildVerdict(input())).toEqual(buildVerdict(input()))
  })
})
