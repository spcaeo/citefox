import { describe, expect, test } from 'vitest'
import { changeEventsFromPages } from '../compose'
import { accountBody, emailHarness, facts, notice, reportBody } from '../harness'
import { matchesOnChange } from './changes'

describe('on_change events', () => {
  test('a score drop counts only when it is greater than N', () => {
    const timing = { events: ['score_drop'] as const, scoreDropPoints: 5 }
    expect(matchesOnChange({ kind: 'score_drop', points: 5 }, timing)).toBe(false)
    expect(matchesOnChange({ kind: 'score_drop', points: 6 }, timing)).toBe(true)
    expect(matchesOnChange({ kind: 'score_drop', points: null }, timing)).toBe(false)
  })

  test('a kind the schedule does not watch does not match', () => {
    const timing = { events: ['lost_citation'] as const, scoreDropPoints: 0 }
    expect(matchesOnChange({ kind: 'check_failed', points: null }, timing)).toBe(false)
    expect(matchesOnChange({ kind: 'lost_citation', points: null }, timing)).toBe(true)
    expect(
      matchesOnChange({ kind: 'lost_citation', points: null }, { events: [], scoreDropPoints: 0 })
    ).toBe(false)
  })

  test('the sender lists only the events on the schedule', async () => {
    const { service, ports } = emailHarness()
    service.saveAccount(accountBody())
    const saved = service.saveReport(
      reportBody({
        timing: { kind: 'on_change', events: ['lost_citation'], scoreDropPoints: 1 },
        subject: '{project}'
      })
    )
    const events = changeEventsFromPages(
      [{ failed: true, notice: notice({ pageCitedChange: -1, scoreChange: -6 }) }],
      1
    )
    expect(events.map((event) => event.kind)).toEqual([
      'lost_citation',
      'score_drop',
      'check_failed'
    ])
    const result = await service.sendChangeReport({
      scheduleId: saved.id,
      checkId: 'check-1',
      paused: false,
      events,
      payload: { facts: facts(), attachment: null }
    })
    expect(result.action).toBe('recorded')
    expect(ports.transport.sent).toHaveLength(1)
    expect(ports.transport.sent[0]?.message.text).toBe('Alerts lost a citation')
  })
})
