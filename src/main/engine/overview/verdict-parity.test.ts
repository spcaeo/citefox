import { describe, expect, test } from 'vitest'
import type { AioReference, PromptCheckRow, PromptCheckStatus } from '@shared/domain'
import type { OverviewQuestion, OverviewSource } from '@shared/ipc'
import type { VerdictSet } from '@shared/report/verdict'
import type { CompetitorLists } from '../checks/competitor-match'
import { verdictSets } from './compare'
import { hasAio, isCited, isNamed, questionRows, sitesCitedBy } from './measure'
import type { QuestionOutcome } from './timeline'

/**
 * Summary's verdict numbers come from the shared metrics layer (`verdictSetsOf`). This
 * keeps Summary's rules from before the switch (copied here) and proves both give the
 * same questions for every set, over many seeded mixes of results.
 */

function legacyVerdictSets(input: {
  latest: ReadonlyMap<string, QuestionOutcome>
  baseline: ReadonlyMap<string, QuestionOutcome> | null
  questions: readonly OverviewQuestion[]
  listsFor: (pageId: string) => CompetitorLists
  topSiteKey: string | null
}): Record<VerdictSet, string[]> {
  const sets: Record<VerdictSet, string[]> = {
    tracked: [],
    aio: [],
    cited: [],
    named: [],
    not_visible: [],
    cited_before: [],
    cited_after: [],
    named_before: [],
    named_after: [],
    gained: [],
    kept: [],
    lost: [],
    top_site: []
  }
  for (const question of input.questions) {
    const outcome = input.latest.get(question.key)
    if (outcome === undefined) continue
    const { row } = outcome
    const key = question.key
    sets.tracked.push(key)
    if (hasAio(row)) sets.aio.push(key)
    if (isCited(row)) sets.cited.push(key)
    if (isNamed(row)) sets.named.push(key)
    if (hasAio(row) && !isCited(row) && !isNamed(row)) sets.not_visible.push(key)
    if (
      input.topSiteKey !== null &&
      sitesCitedBy(row, input.listsFor(outcome.pageId)).has(input.topSiteKey)
    ) {
      sets.top_site.push(key)
    }
    const change = question.change
    if (change === null) continue
    if (change === 'gained') sets.gained.push(key)
    if (change === 'kept') sets.kept.push(key)
    if (change === 'lost') sets.lost.push(key)
    if (change === 'kept' || change === 'lost') sets.cited_before.push(key)
    if (change === 'kept' || change === 'gained') sets.cited_after.push(key)
    const earlier = input.baseline?.get(key)
    if (earlier !== undefined && isNamed(earlier.row)) sets.named_before.push(key)
    if (isNamed(row)) sets.named_after.push(key)
  }
  return sets
}

const STATUSES: readonly PromptCheckStatus[] = [
  'page_cited',
  'other_own_page',
  'brand_mentioned',
  'not_cited',
  'no_aio',
  'error'
]
const SITES = ['https://reddit.com/r/x', 'https://g2.com/p', 'https://simpletexting.com/a']
const LISTS: CompetitorLists = { direct: [], partial: [] }
const SOURCE: OverviewSource = { kind: 'page', label: 'Pricing', path: '/pricing' } as never

function reference(position: number, url: string, own: boolean): AioReference {
  return {
    id: `r${position}`,
    position,
    url,
    normalizedUrl: url,
    domain: new URL(url).hostname,
    title: null,
    classification: own ? 'own' : 'competitor',
    untracked: false,
    sourceType: 'web'
  } as AioReference
}

function outcome(key: string, runId: string, next: () => number): QuestionOutcome {
  const status = STATUSES[Math.floor(next() * STATUSES.length)] ?? 'not_cited'
  const answered = status !== 'no_aio' && status !== 'error'
  const references: AioReference[] = []
  if (answered) {
    SITES.forEach((url, index) => {
      if (next() < 0.5) references.push(reference(index + 2, url, false))
    })
    // An own link sometimes even on a "brand mentioned" or "not cited" row.
    if (status === 'page_cited' || status === 'other_own_page' || next() < 0.15) {
      references.push(reference(1, 'https://textbolt.com/pricing', true))
    }
  }
  const row = {
    promptId: key,
    text: key,
    status,
    references,
    named: answered ? next() < 0.4 : null,
    citedUrl: null
  } as unknown as PromptCheckRow
  return {
    key,
    pageId: next() < 0.5 ? 'p1' : 'p2',
    promptId: key,
    runId,
    marketId: 'us',
    checkedAt: runId === 'now' ? '2026-10-15T00:00:00.000Z' : '2026-10-01T00:00:00.000Z',
    text: key,
    row
  }
}

describe('Summary verdict sets: the shared metrics give the same questions', () => {
  test('over 150 seeded mixes, every set matches the old rules exactly', () => {
    let seed = 11
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    let compared = 0
    for (let round = 0; round < 150; round += 1) {
      const latest = new Map<string, QuestionOutcome>()
      const baseline = new Map<string, QuestionOutcome>()
      const size = 1 + Math.floor(next() * 12)
      for (let i = 0; i < size; i += 1) {
        const key = `q${i}`
        latest.set(key, outcome(key, 'now', next))
        if (next() < 0.8) baseline.set(key, outcome(key, 'before', next))
      }
      const hidden = next() < 0.2 ? 'p2' : null
      const questions = questionRows(
        round % 7 === 0 ? null : baseline,
        latest,
        () => SOURCE,
        () => LISTS,
        (pageId) => pageId !== hidden
      )
      const topSiteKey = round % 5 === 0 ? null : 'g2.com'
      const input = {
        latest,
        baseline: round % 7 === 0 ? null : baseline,
        questions,
        listsFor: () => LISTS,
        topSiteKey
      }
      const now = verdictSets(input)
      expect(now).toEqual(legacyVerdictSets(input))
      compared += now.gained.length + now.kept.length + now.lost.length
    }
    expect(compared).toBeGreaterThan(100)
  })
})
