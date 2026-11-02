import { describe, expect, it } from 'vitest'
import type { DeliveryRecord, ReportScheduleListItem } from '@shared/domain'
import { filtersOnLabel, orderRows } from './scheduleGrid'
import {
  EMAIL_SUMMARY_NOTE,
  FORMAT_OPTIONS,
  buildSchedule,
  draftFromSchedule,
  emptyDraft,
  explainReportsError,
  formatInstant,
  formatLabel,
  mailPreview,
  sectionsHint,
  sectionsLabel,
  toScheduleRow,
  localDayKey,
  nextSendLabel,
  scheduleListCount,
  scheduleShowingLine,
  timelineDays,
  toDeliveryRow,
  withoutDeletedSchedule
} from './scheduleModel'

const TORONTO = 'America/Toronto'
const CHICAGO = 'America/Chicago'
const NEW_YORK = 'America/New_York'

describe('scheduled report formats', () => {
  it('says what each stored format sends', () => {
    expect(FORMAT_OPTIONS.map((option) => [option.id, option.label])).toEqual([
      ['pdf', 'PDF report attached'],
      ['excel', 'Excel workbook attached'],
      ['csv', 'CSV tables (.zip) attached'],
      ['html_link', 'Interactive HTML report (.zip) attached'],
      ['summary', 'Email summary only, no attachment']
    ])
    expect(formatLabel('html_link')).toBe('Interactive HTML report (.zip) attached')
    for (const option of FORMAT_OPTIONS) expect(option.label).not.toMatch(/HTML link/i)
    expect(EMAIL_SUMMARY_NOTE).toContain('headline sentence')
    expect(EMAIL_SUMMARY_NOTE).toContain('top 3 actions')
  })

  it('shows stored legacy section ids as v2 report sections', () => {
    expect(sectionsLabel('pdf', ['results', 'progress', 'sentiment'])).toBe(
      'Overview, Reputation, Trends'
    )
    expect(sectionsLabel('excel', ['gaps', 'prompts', 'results', 'unknown'])).toBe(
      'Overview, Content gaps, Questions'
    )
    expect(sectionsLabel('csv', [])).toBe('No sections')
    expect(sectionsLabel('summary', ['results'])).toBe(
      'Headline, score, what changed and top 3 actions'
    )
    expect(sectionsHint('csv', ['prompt_results'])).toBe(
      'Sections: Questions (one file per table, zipped)'
    )
    expect(sectionsHint('summary', [])).toBe('No attachment; the email holds the summary')
    expect(toScheduleRow(schedule({ format: 'html_link' }), [], [], TORONTO).formatLabel).toBe(
      'Interactive HTML report (.zip) attached'
    )
    expect(emptyDraft(TORONTO).sections).toEqual(['overview', 'reputation', 'trends'])
  })

  it('names the attachment in the email preview', () => {
    const draft = { ...emptyDraft(TORONTO), format: 'html_link' as const }
    expect(mailPreview(draft, 'TextBolt', 'US · EN', 'me').attachLabel).toBe(
      'The interactive HTML report (.zip) is attached when CiteFox sends the report.'
    )
    expect(
      mailPreview({ ...draft, format: 'summary' }, 'TextBolt', 'US · EN', 'me').attachLabel
    ).toBe('No attachment.')
  })
})

describe('scheduled report times', () => {
  it('shows nextSendAt in the requested IANA zone', () => {
    const iso = '2026-10-26T13:00:00.000Z'
    expect(formatInstant(iso, CHICAGO)).toBe('Oct 26, 08:00')
    expect(formatInstant(iso, TORONTO)).toBe('Oct 26, 09:00')
    const row = schedule({ nextSendAt: iso })
    expect(nextSendLabel(row, TORONTO)).toBe('Oct 26, 09:00')
    expect(nextSendLabel({ ...row, status: 'paused' }, TORONTO)).toBe('Off')
    expect(
      nextSendLabel(
        {
          ...row,
          nextSendAt: null,
          timing: { kind: 'on_change', events: ['lost_citation'], scoreDropPoints: 10 }
        },
        TORONTO
      )
    ).toBe('On change')
    expect(nextSendLabel({ ...row, nextSendAt: null }, TORONTO)).toBe('Paused with project')
  })

  it('loads a stored on_change schedule back into the form', () => {
    const draft = emptyDraft(TORONTO)
    draft.name = 'Lost citation'
    draft.recipients = ['ada@example.com']
    draft.trigger = 'on_change'
    draft.events = {
      lost_citation: true,
      gained_citation: false,
      score_drop: false,
      check_failed: false
    }
    draft.drop = 10
    const stored = buildSchedule(draft, 'lost', '2026-10-01T00:00:00.000Z')
    const loaded = draftFromSchedule(stored)
    expect(loaded.trigger).toBe('on_change')
    expect(loaded.events).toEqual(draft.events)
    expect(loaded.recipients).toEqual(['ada@example.com'])
    expect(loaded.name).toBe('Lost citation')
    expect(buildSchedule(loaded, 'lost', stored.createdAt).timing).toEqual(stored.timing)
  })

  it('groups a delivery by the local calendar day', () => {
    const at = '2026-10-19T03:30:00.000Z'
    expect(localDayKey(at, NEW_YORK)).toBe('2026-10-18')
    expect(localDayKey(at, 'UTC')).toBe('2026-10-19')
    const row = toDeliveryRow(delivery({ at }), [schedule({})], [], NEW_YORK)
    const days = timelineDays([row], 'desc')
    expect(days).toHaveLength(1)
    expect(days[0]?.key).toBe('2026-10-18')
    expect(days[0]?.count).toBe(1)
    expect(days[0]?.runs).toHaveLength(1)
  })
})

describe('schedule draft', () => {
  it('starts a new schedule active and uses the default sender when the account is null', () => {
    const draft = emptyDraft(TORONTO)
    draft.name = 'Monday report'
    draft.recipients = ['ada@example.com']
    draft.accountId = null
    const saved = buildSchedule(draft, 'sched-1', '2026-10-20T12:00:00.000Z')
    expect(saved.status).toBe('active')
    expect(saved.accountId).toBeNull()
    expect(saved.timeZone).toBe(TORONTO)
    expect(saved.timing).toEqual({ kind: 'weekly', day: 1, time: '08:00' })
  })
})

describe('reports errors', () => {
  it('strips the Electron invoke wrapper and keeps the engine sentence', () => {
    const explained = explainReportsError(
      new Error("Error invoking remote method 'reports:list': Error: The reports file is busy.")
    )
    expect(explained).toEqual({ reason: 'The reports file is busy.', nextStep: null })
    expect(JSON.stringify(explained)).not.toContain('Error invoking remote method')
    expect(explainReportsError(new Error('Add at least one recipient.')).reason).toBe(
      'Add at least one recipient.'
    )
  })

  it('strips a typed IPC error and its channel, and says how to add a sending account', () => {
    const explained = explainReportsError(
      new Error(
        "Error invoking remote method 'reports:sendTest': IpcRequestError: reports:sendTest: No sending account."
      )
    )
    expect(explained.reason).toBe('No sending account.')
    expect(explained.nextStep).toBe(
      'Add a sending account in Email setup, then send the test again.'
    )
  })

  it('shows the ReportContractError not_found sentence', () => {
    expect(
      explainReportsError({
        channel: 'reports:delete',
        code: 'not_found',
        message: 'That schedule does not exist or is already deleted.'
      })
    ).toEqual({
      reason: 'That schedule does not exist or is already deleted.',
      nextStep: null
    })
  })
})

describe('deleting a schedule', () => {
  it('drops the schedule from the list and pluralizes the new count', () => {
    const schedules = [schedule({ id: 'weekly' }), schedule({ id: 'lost' })]
    const deliveries = [delivery({ scheduleId: 'weekly' })]
    const next = withoutDeletedSchedule(schedules, 'weekly')
    expect(next.map((item) => item.id)).toEqual(['lost'])
    expect(deliveries).toHaveLength(1)
    expect(scheduleListCount(next.length)).toBe('1 schedule')
    expect(scheduleShowingLine(next.length, next.length, false)).toBe('Showing 1 of 1 schedule')
    expect(scheduleListCount(0)).toBe('0 schedules')
    expect(scheduleShowingLine(2, 4, true)).toBe('Showing 2 of 4 schedules · filtered')
    expect(scheduleListCount(2014)).toBe('2,014 schedules')
  })
})

describe('filter count', () => {
  it('pluralizes filters on', () => {
    expect(filtersOnLabel(0)).toBe('0 filters on')
    expect(filtersOnLabel(1)).toBe('1 filter on')
    expect(filtersOnLabel(2)).toBe('2 filters on')
    expect(filtersOnLabel(2014)).toBe('2,014 filters on')
  })
})

describe('delivery order', () => {
  it('puts failed rows first while a filter is on, unless the result column is sorted', () => {
    const rows = [
      { id: 'ok', result: 'Sent' },
      { id: 'bad', result: 'Failed' },
      { id: 'draft', result: 'Draft' }
    ]
    const failedFirst = orderRows(rows, [], (row) => row.id, {
      filtering: true,
      failedFirst: (row) => row.result === 'Failed',
      resultKey: 'result'
    })
    expect(failedFirst.map((row) => row.id)).toEqual(['bad', 'ok', 'draft'])
    const sorted = orderRows(rows, [{ key: 'result', dir: 'asc' }], (row) => row.result, {
      filtering: true,
      failedFirst: (row) => row.result === 'Failed',
      resultKey: 'result'
    })
    expect(sorted.map((row) => row.id)).toEqual(['draft', 'bad', 'ok'])
  })
})

function schedule(overrides: Partial<ReportScheduleListItem>): ReportScheduleListItem {
  return {
    id: 'sched-1',
    name: 'Monday report',
    projectId: null,
    timing: { kind: 'weekly', day: 1, time: '08:00' },
    format: 'pdf',
    sections: ['results'],
    marketIds: [],
    recipients: ['ada@example.com'],
    accountId: null,
    timeZone: TORONTO,
    subject: '{project}',
    summaryStyle: null,
    status: 'active',
    createdAt: '2026-10-01T00:00:00.000Z',
    nextSendAt: '2026-10-26T13:00:00.000Z',
    ...overrides
  }
}

function delivery(overrides: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    id: 'del-1',
    scheduleId: 'sched-1',
    at: '2026-10-19T03:30:00.000Z',
    trigger: 'weekly',
    projectId: null,
    recipients: ['ada@example.com'],
    outcome: 'sent',
    ok: true,
    reason: null,
    nextStep: null,
    occurrenceKey: 'del-1',
    ...overrides
  }
}
