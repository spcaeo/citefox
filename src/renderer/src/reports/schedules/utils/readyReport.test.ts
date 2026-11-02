import { describe, expect, it } from 'vitest'
import { buildSchedule, draftFromSchedule, draftIssues, emptyDraft } from '../../scheduleModel'
import { scheduledReportLabel } from './readyReport'
import { readScheduleDrawer, readyReportScheduleParams } from './scheduleUrl'

describe('a schedule of one ready report', () => {
  it('a card opens a new schedule with its report, name, subject and PDF picked', () => {
    const params = readyReportScheduleParams('impact', null, 'proj-1')
    expect(params).toEqual({
      'schedule.id': 'new',
      'schedule.report': 'impact',
      'schedule.project': 'proj-1'
    })
    expect(readScheduleDrawer(params).seed).toMatchObject({
      report: 'impact',
      rival: null,
      name: 'Impact review',
      subject: '{project}: Impact review for {date_range}',
      format: 'pdf',
      projectId: 'proj-1'
    })
  })

  it('Head-to-head keeps its rival; another report drops it; a bad one is ignored', () => {
    const rival = readScheduleDrawer(readyReportScheduleParams('rival', 'twilio.com', null)).seed
    expect(rival).toMatchObject({
      report: 'rival',
      rival: 'twilio.com',
      name: 'Head-to-head vs twilio.com'
    })
    expect(readyReportScheduleParams('pitch', 'twilio.com', null)['schedule.rival']).toBeUndefined()
    expect(
      readScheduleDrawer({ 'schedule.report': 'rival', 'schedule.rival': 'not a host' }).seed.rival
    ).toBeNull()
    expect(readScheduleDrawer({ 'schedule.report': 'nope' }).seed.report).toBeUndefined()
  })

  it('needs no sections, saves the report, and reads back the same', () => {
    const draft = {
      ...emptyDraft('America/Toronto'),
      name: 'Head-to-head',
      recipients: ['client@example.com'],
      sections: [],
      report: 'rival' as const,
      rival: 'twilio.com'
    }
    expect(draftIssues(draft)).toBeNull()
    expect(draftIssues({ ...draft, report: null })).toBe(
      'Pick at least one section, or send the email summary only.'
    )
    const saved = buildSchedule(draft, 'sch-1', '2026-11-02T00:00:00.000Z')
    expect(saved.report).toEqual({ kind: 'rival', rival: 'twilio.com' })
    expect(buildSchedule({ ...draft, report: 'impact' }, 'sch-1', saved.createdAt).report).toEqual({
      kind: 'impact',
      rival: null
    })
    expect(buildSchedule({ ...draft, report: null }, 'sch-1', saved.createdAt).report).toBeNull()
    expect(draftFromSchedule(saved)).toMatchObject({ report: 'rival', rival: 'twilio.com' })
    expect(scheduledReportLabel(saved.report)).toBe('Head-to-head vs twilio.com')
    expect(scheduledReportLabel(null)).toBeNull()
  })
})
