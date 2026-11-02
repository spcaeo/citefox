import { describe, expect, it } from 'vitest'
import { computeMetrics } from './compute'
import { C1, C2, row } from './fixtures.test-helper'
import { mergeEngines } from './merge'
import type { MetricRow } from './types'

/**
 * Each cited site's average source position (Docs/METRICS.md "Sites"): read from the
 * answers citing it, now and at both ends of a comparison; All engines keeps each
 * site's best position across the engines.
 */

function rows(): MetricRow[] {
  return [
    row('q1', C1, 'not_cited', { domains: ['reddit.com'], sitePositions: { 'reddit.com': 1 } }),
    row('q2', C1, 'not_cited', { domains: ['reddit.com'], sitePositions: { 'reddit.com': 3 } }),
    row('q1', C2, 'target', {
      domains: ['reddit.com'],
      sitePositions: { 'reddit.com': 2 },
      position: 1
    }),
    row('q2', C2, 'not_cited', {
      domains: ['reddit.com', 'g2.com'],
      sitePositions: { 'reddit.com': 4 }
    })
  ]
}

describe('average source position per site', () => {
  it('averages the known positions at each end, one decimal', () => {
    const result = computeMetrics({
      rows: rows(),
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'google_aio',
      window: { from: C1, to: null }
    })
    const reddit = result.domains.find((site) => site.domain === 'reddit.com')
    expect(reddit?.position).toEqual({ now: 3, before: 2, after: 3 })
    // g2.com has no known position.
    expect(result.domains.find((site) => site.domain === 'g2.com')?.position.now).toBeNull()
    const own = result.domains.find((site) => site.own)
    expect(own?.position).toEqual({ now: 1, before: null, after: 1 })
  })

  it('All engines keeps each site’s best position across engines', () => {
    const merged = mergeEngines([
      row('q1', C1, 'not_cited', { domains: ['g2.com'], sitePositions: { 'g2.com': 4 } }),
      row('q1', C1, 'not_cited', {
        engine: 'chatgpt',
        domains: ['g2.com'],
        sitePositions: { 'g2.com': 2 }
      })
    ])
    expect(merged[0]?.sitePositions).toEqual({ 'g2.com': 2 })
  })
})
