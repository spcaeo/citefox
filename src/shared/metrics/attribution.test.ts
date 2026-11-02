import { describe, expect, it } from 'vitest'
import { sampleMetrics, samplePages, sampleRows } from '../report/review/sample.test-helper'
import { attributionOf } from './attribution'
import { computeMetrics } from './compute'

describe('attributionOf: did the published pages do it?', () => {
  it('splits questions citing published pages from the rest of the site, at both ends', () => {
    const att = attributionOf(sampleMetrics({ engine: 'google_aio' }))
    // Sep 16: q4 q5 q6 cite /features (published); q3 q12 cite /pricing (the rest).
    expect(att.published.before?.n).toBe(3)
    expect(att.rest.before?.n).toBe(2)
    // Oct 28: q1 q2 cite /email-to-sms-outlook, q11 /features; q3 q9 q12 cite /pricing.
    expect(att.published.after.n).toBe(3)
    expect(att.rest.after.n).toBe(3)
    // Gained: q1 q2 q11 through published pages, q9 through /pricing.
    expect(att.gained.n).toBe(4)
    expect(att.gainedVia.n).toBe(3)
    expect(att.gainedOnly.n).toBe(3)
    for (const count of [att.gained, att.gainedVia, att.gainedOnly, att.published.after]) {
      expect(count.ids.length).toBe(count.n)
    }
  })

  it('a question that also cites another page of yours is not "only because of" a published page', () => {
    const rows = sampleRows().map((row) =>
      row.engine === 'google_aio' && row.checkId === 'c3' && row.questionId === 'topic-1|q1'
        ? { ...row, ownUrls: [row.citedUrl ?? '', 'https://textbolt.com/pricing'] }
        : row
    )
    const metrics = computeMetrics({
      rows,
      pages: samplePages(),
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'google_aio',
      window: { from: '2026-09-16T15:00:00.000Z', to: null }
    })
    const att = attributionOf(metrics)
    expect(att.gainedVia.n).toBe(3)
    expect(att.gainedOnly.n).toBe(2)
    expect(att.rest.after.n).toBe(4)
  })

  it('has no before and no gains with a single check', () => {
    const metrics = computeMetrics({
      rows: sampleRows().filter((row) => row.checkId === 'c3'),
      pages: [],
      ownDomain: 'textbolt.com',
      scope: { kind: 'project' },
      marketId: null,
      engine: 'all',
      window: { from: '2026-10-28T15:00:00.000Z', to: null }
    })
    const att = attributionOf(metrics)
    expect(att.published.before).toBeNull()
    expect(att.published.after.n).toBe(0)
    expect(att.gained.n).toBe(0)
  })
})
