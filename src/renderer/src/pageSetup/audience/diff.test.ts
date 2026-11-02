import { describe, expect, it } from 'vitest'
import type { BuyerProfile } from '@shared/domain'
import { applyDiff, changedLines, profileDiff } from './diff'

function profile(patch: Partial<BuyerProfile>): BuyerProfile {
  return {
    id: 'icp-1',
    pageId: 'p1',
    snapshotId: 's1',
    who: 'Ops leads',
    environment: 'Slack\nEmail',
    segments: [{ name: 'IT teams', reason: 'They own alerts' }],
    triggers: ['A missed outage', 'A new on-call rota'],
    values: ['Price'],
    poorFit: [],
    templateId: 'tpl',
    templateName: 'CiteFox default',
    templateHash: 'h',
    templateUpdatedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    promptsStale: false,
    ...patch
  } as BuyerProfile
}

describe('buyer profile regenerate diff', () => {
  it('pairs same wording, then the rest in order, part by part', () => {
    const before = profile({})
    const after = profile({
      triggers: ['A new on-call rota', 'An SLA breach', 'A board review'],
      values: ['price'],
      poorFit: [{ name: 'Solo founders', reason: 'No team to alert' }]
    })
    const diff = profileDiff(before, after)
    const triggers = diff.find((part) => part.part === 'triggers')?.lines ?? []
    expect(triggers.map((line) => [line.kind, line.before?.text, line.after?.text])).toEqual([
      ['changed', 'A missed outage', 'An SLA breach'],
      ['same', 'A new on-call rota', 'A new on-call rota'],
      ['changed', undefined, 'A board review']
    ])
    expect(diff.find((part) => part.part === 'values')?.lines[0]?.kind).toBe('same')
    expect(changedLines(diff).map((line) => line.id)).toEqual([
      'triggers:0',
      'triggers:2',
      'poorFit:0'
    ])
  })

  it('keeps old points unless replaced, and drops a removed or skipped point', () => {
    const before = profile({})
    const after = profile({ triggers: ['A new on-call rota'], segments: [] })
    const diff = profileDiff(before, after)
    expect(applyDiff(diff, {})).toMatchObject({
      triggers: ['A missed outage', 'A new on-call rota'],
      segments: [{ name: 'IT teams', reason: 'They own alerts' }]
    })
    expect(applyDiff(diff, { 'triggers:0': 'replace', 'segments:0': 'replace' })).toMatchObject({
      triggers: ['A new on-call rota'],
      segments: []
    })
  })
})
