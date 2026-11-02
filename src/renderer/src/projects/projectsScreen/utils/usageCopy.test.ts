import { describe, expect, test } from 'vitest'
import type { ApiKeyMetadata, ProjectUsageReport, ProjectUsageRow } from '@shared/domain'
import {
  capCell,
  glanceUsageLine,
  shareCell,
  sharedKeysSentence,
  sharedTotalCell,
  unassignedHint,
  unassignedSentence
} from './usageCopy'

function row(patch: Partial<ProjectUsageRow>): ProjectUsageRow {
  return {
    projectId: 'p',
    name: 'TextBolt',
    clientName: null,
    status: 'active',
    source: 'shared',
    searches: 0,
    sharedSearches: 0,
    cap: null,
    capRule: 'pause',
    allowance: null,
    dedicatedKeyId: null,
    sharePercent: null,
    claudeCalls: 0,
    claudeLabel: 'CiteFox AI',
    ...patch
  }
}

function report(patch: Partial<ProjectUsageReport>): ProjectUsageReport {
  return {
    month: '2026-10',
    projects: [],
    sharedUsed: 0,
    sharedCapacity: null,
    unassigned: null,
    dedicatedUsed: 0,
    claudeCalls: 0,
    ...patch
  }
}

function key(patch: Partial<ApiKeyMetadata>): ApiKeyMetadata {
  return {
    id: 'k1',
    provider: 'serpapi',
    name: 'My plan',
    keychainRef: 'ref',
    hint: 'ab12',
    rotationOrder: 0,
    cap: 5000,
    on: true,
    projectIds: [],
    state: 'ok',
    lastReason: null,
    serpapiUsage: null,
    usedThisMonth: 1240,
    ...patch
  }
}

describe('usage by project copy (FR-10.6)', () => {
  test('cap cells show the 10% extra and no cap', () => {
    expect(capCell(row({ cap: 500, capRule: 'allow_10', allowance: 550 }))).toBe('500 (+10%: 550)')
    expect(capCell(row({ cap: 3000 }))).toBe('3,000')
    expect(capCell(row({}))).toBe('No cap')
  })

  test('share cells', () => {
    expect(shareCell(row({ source: 'dedicated' }))).toBe('Own key, not shared')
    expect(shareCell(row({ sharePercent: 24 }))).toBe('24%')
    expect(shareCell(row({ sharePercent: 0, sharedSearches: 3 }))).toBe('under 1%')
    expect(shareCell(row({ sharePercent: null, sharedSearches: 3 }))).toBe('No shared limit')
  })

  test('the shared total row and the glance fallback', () => {
    expect(sharedTotalCell(report({ sharedUsed: 1258, sharedCapacity: 5250 }))).toBe(
      '1,258 of 5,250 · 24%'
    )
    expect(sharedTotalCell(report({ sharedUsed: 40 }))).toBe('40 · no shared limit')
    expect(
      glanceUsageLine(report({ sharedUsed: 1258, sharedCapacity: 5250, dedicatedUsed: 312 }))
    ).toBe('1,258 used by CiteFox · caps total 5,250 on shared keys · 312 on own keys')
  })

  test('the line under the table names each shared key and the unassigned capacity', () => {
    const projects = [row({ cap: 3000 }), row({ projectId: 'f', cap: 500 })]
    const keys = [
      key({}),
      key({ id: 'k2', name: 'Backup', rotationOrder: 1, cap: 250, usedThisMonth: 18 }),
      key({ id: 'k3', name: 'Acme', rotationOrder: 2 })
    ]
    const withOwn = [
      ...projects,
      row({ projectId: 'a', source: 'dedicated', dedicatedKeyId: 'k3', cap: null })
    ]
    expect(
      sharedKeysSentence(
        keys,
        report({ projects: withOwn, sharedCapacity: 5250, unassigned: 1750 })
      )
    ).toBe(
      "Shared keys: My plan 1,240 of 5,000 · Backup 18 of 250. Project caps add up to 3,500, so 1,750 shared searches a month aren't promised to any project."
    )
  })

  test('unassigned copy when it cannot be named or is over-promised', () => {
    const projects = [row({ cap: null })]
    expect(unassignedSentence(report({ projects, sharedCapacity: 5000 }))).toBe(
      'Some projects on shared keys have no cap, so every shared search can go to them.'
    )
    expect(unassignedSentence(report({ projects }))).toBe(
      "A shared key has no monthly limit, so CiteFox can't say how much is unassigned."
    )
    expect(
      unassignedSentence(
        report({ projects: [row({ cap: 6000 })], sharedCapacity: 5000, unassigned: -1000 })
      )
    ).toBe('Project caps add up to 6,000, 1,000 more than the shared keys allow.')
    expect(unassignedHint(report({ sharedCapacity: 5250, unassigned: 1750 }))).toContain(
      "1,750 of 5,250 a month aren't assigned to a project yet."
    )
    expect(unassignedHint(null)).toBe(
      'CiteFox uses the shared keys in the order set in Connections.'
    )
  })
})
