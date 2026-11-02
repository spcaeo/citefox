import { describe, expect, it } from 'vitest'
import { rollupPageFixes } from '@shared/page-fixes'
import { fix as loggedFix } from '../../progress/fixtures'
import { projectSearches, SEARCHES_BUILT_AT } from '../searchFixtures'
import { fixStatusOf, statusFilter } from './status'

const FIXES = rollupPageFixes(projectSearches().searches).fixes
const pricing = FIXES.find((item) => item.page?.pageId === 'page-pricing')

function logged(at: string): {
  fix: ReturnType<typeof loggedFix>
  searchesMin: number
  searchesMax: number
} {
  return {
    fix: loggedFix({ pageId: 'page-pricing', goLiveAt: at, createdAt: at }),
    searchesMin: 1,
    searchesMax: 1
  }
}

describe('What to fix › Status', () => {
  it('is New, then Brief ready once a brief is saved, then Logged once a change is logged', () => {
    if (!pricing) throw new Error('no pricing fix')
    expect(fixStatusOf(pricing, new Set(), [])).toBe('new')
    expect(fixStatusOf(pricing, new Set([pricing.id]), [])).toBe('brief')
    expect(fixStatusOf(pricing, new Set([pricing.id]), [logged('2026-10-29T11:00:00.000Z')])).toBe(
      'logged'
    )
  })

  it('a change logged before the last check no longer counts: the check measured it', () => {
    if (!pricing) throw new Error('no pricing fix')
    expect(SEARCHES_BUILT_AT > '2026-10-20T00:00:00.000Z').toBe(true)
    expect(fixStatusOf(pricing, new Set(), [logged('2026-10-20T00:00:00.000Z')])).toBe('new')
  })

  it('reads the URL filter, and ignores anything else', () => {
    expect(statusFilter('brief')).toBe('brief')
    expect(statusFilter('nope')).toBeNull()
    expect(statusFilter(null)).toBeNull()
  })
})
