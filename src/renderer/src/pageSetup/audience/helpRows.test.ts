import { describe, expect, it } from 'vitest'
import type { BuyerProfile } from '@shared/domain'
import type { HelpFillRow } from '@shared/ipc'
import { helpMeta, helpPatch, helpPoints, helpUndo, NO_REASON } from './helpRows'

const PROFILE: BuyerProfile = {
  id: 'icp-1',
  pageId: 'page-1',
  snapshotId: 'snap-1',
  who: 'Office managers',
  environment: '',
  segments: [{ name: 'Field service', reason: 'Crews are away from desks.' }],
  triggers: ['A carrier gateway stopped working'],
  values: ['Setup in 30 minutes'],
  poorFit: [],
  templateId: 'tpl',
  templateName: 'Buyer profile',
  templateHash: 'hash',
  templateUpdatedAt: null,
  createdAt: '2026-10-20T12:00:00.000Z',
  promptsStale: false
}

function row(id: string, values: Record<string, string>): HelpFillRow {
  return { id, section: null, values }
}

describe('helpPoints', () => {
  it('turns each buyer type into a segment, its triggers and its values, skipping saved ones', () => {
    const points = helpPoints(
      [
        row('row-1', {
          who: 'Clinic office managers',
          problem: 'Shift changes get lost in email',
          trigger: 'A nurse missed a shift\na carrier gateway stopped working.',
          need: 'Texts from Outlook'
        }),
        row('row-2', {
          who: 'field service',
          problem: 'x',
          trigger: 'A nurse missed a shift',
          need: ''
        })
      ],
      PROFILE
    )
    expect(points.map((point) => [point.kind, point.text, point.detail])).toEqual([
      ['segment', 'Clinic office managers', 'Shift changes get lost in email'],
      ['trigger', 'A nurse missed a shift', 'For Clinic office managers'],
      ['value', 'Texts from Outlook', 'For Clinic office managers']
    ])
    expect(points.map((point) => point.label)).toEqual([
      'Segment',
      'Trigger event',
      'What they value'
    ])
    expect(helpMeta(points)).toBe('1 segment · 1 trigger event · 1 value')
    expect(helpMeta([])).toBe('Nothing new for this profile')
  })
})

describe('helpPatch and helpUndo', () => {
  it('adds the ticked points to the end of their parts; the undo holds the parts as they were', () => {
    const points = helpPoints(
      [
        row('row-1', {
          who: 'Clinics',
          problem: 'Shifts change daily',
          trigger: 'A shift changed overnight',
          need: 'No app for staff'
        })
      ],
      PROFILE
    )
    const patch = helpPatch(PROFILE, points, ['row-1:segment', 'row-1:trigger:0'])
    expect(patch).toEqual({
      segments: [...PROFILE.segments, { name: 'Clinics', reason: 'Shifts change daily' }],
      triggers: [...PROFILE.triggers, 'A shift changed overnight']
    })
    expect(helpUndo(PROFILE, patch)).toEqual({
      segments: PROFILE.segments,
      triggers: PROFILE.triggers
    })
    expect(helpPatch(PROFILE, points, [])).toEqual({})
  })

  it('gives a segment without a problem a reason, and offers no undo for a part that was empty', () => {
    const empty = { ...PROFILE, values: [] }
    const points = helpPoints([row('row-1', { who: 'Clinics', need: 'No app for staff' })], empty)
    expect(points[0]).toMatchObject({ kind: 'segment', reason: NO_REASON })
    // One buyer type: its points need no "For …" line.
    expect(points[1]).toMatchObject({ kind: 'value', detail: null })
    const patch = helpPatch(empty, points, ['row-1:segment', 'row-1:value:0'])
    expect(patch.values).toEqual(['No app for staff'])
    expect(helpUndo(empty, patch)).toBeNull()
  })
})
