import { DEFAULT_INTERVAL_DAYS, isIntervalDays } from '@shared/domain'
import { estimateCheckSearches } from '../queue/estimate'
import type { IntervalDays } from '@shared/domain'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  ADD_PAGE_INTERVAL_DAYS,
  FIX_FOLLOW_UP_DAY_OPTIONS,
  IMPORT_PAGE_INTERVAL_DAYS,
  LARGE_IMPORT_RECOMMENDED_INTERVAL_DAYS,
  MS_PER_DAY,
  STAGGER_WINDOW_DAYS,
  isAddPageIntervalDays,
  planSchedule,
  resolveIntervalDays,
  SPREAD_BATCH_GAP_MS,
  SPREAD_BATCH_SIZE,
  staggerFirstChecks,
  spreadSlots
} from './index'
import { checkNowMarketIds } from './due'
import { ScheduleError } from './errors'
import { pausePage, pauseProject, resumePage, resumeProject } from './pause'
import type {
  AppSchedule,
  FixFollowUpInput,
  ProjectSchedule,
  ScheduledPageInput,
  ScheduledProjectInput
} from './index'

const DAY = MS_PER_DAY
const AT = Date.parse('2026-04-06T08:00:00.000Z')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('re-check intervals', () => {
  test('7 is the app default; Add page offers every day, 7, 14 and 30', () => {
    expect(DEFAULT_INTERVAL_DAYS).toBe(7)
    expect(ADD_PAGE_INTERVAL_DAYS).toEqual([1, 7, 14, 30])
    expect(isAddPageIntervalDays(1)).toBe(true)
    expect(isAddPageIntervalDays(7)).toBe(true)
    expect(isAddPageIntervalDays(14)).toBe(true)
    expect(isAddPageIntervalDays(30)).toBe(true)
    expect(isAddPageIntervalDays(60)).toBe(false)
    expect(LARGE_IMPORT_RECOMMENDED_INTERVAL_DAYS).toBe(30)
    expect(IMPORT_PAGE_INTERVAL_DAYS).toEqual([1, 7, 14, 30, 60, 90])
    expect(FIX_FOLLOW_UP_DAY_OPTIONS).toEqual([3, 7])
    expect(STAGGER_WINDOW_DAYS).toBe(7)
    expect(isIntervalDays(60)).toBe(true)
    expect(isIntervalDays(90)).toBe(true)
  })

  test('a page keeps its interval and the project default applies only when it has none', () => {
    expect(resolveIntervalDays(null, 30)).toBe(30)
    expect(resolveIntervalDays(14, 30)).toBe(14)
    expect(resolveIntervalDays(60, 14)).toBe(60)
    expect(resolveIntervalDays(1, 7)).toBe(1)
    expect(() => resolveIntervalDays(21 as IntervalDays, 14)).toThrow(ScheduleError)
  })
})

describe('planSchedule', () => {
  test('does not read Date.now', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now')
    })
    const plan = planSchedule(input(), AT + 14 * DAY, 'UTC')
    expect(plan.due.pages).toHaveLength(1)
  })

  test('a page is due on the local day its next check falls, including later the same day', () => {
    const early = planSchedule(input(), AT + 14 * DAY - DAY, 'UTC')
    expect(early.due.pages).toEqual([])
    expect(early.projects[0]?.nextCheckAt).toBe('2026-04-20T08:00:00.000Z')
    expect(early.projects[0]?.pagesDueToday).toBe(0)

    const laterToday = planSchedule(input(), AT + 14 * DAY - 1, 'UTC')
    expect(laterToday.due.day).toBe('2026-04-20')
    expect(laterToday.due.pages.map((page) => page.pageId)).toEqual(['page-1'])
    expect(laterToday.due.pages[0]).toMatchObject({
      reason: 'scheduled',
      dueAt: '2026-04-20T08:00:00.000Z',
      marketIds: ['us'],
      promptIds: null,
      intervalDays: 14
    })

    const onTime = planSchedule(input(), AT + 14 * DAY, 'UTC')
    expect(onTime.due.pages).toHaveLength(1)
    expect(onTime.projects[0]?.pagesDueToday).toBe(1)
  })

  test('lists the page again on a second pass the same day', () => {
    const first = planSchedule(input(), AT + 14 * DAY, 'UTC')
    const second = planSchedule(input(), AT + 14 * DAY + 60_000, 'UTC')
    expect(second.due.pages.map((page) => page.pageId)).toEqual(
      first.due.pages.map((page) => page.pageId)
    )
  })

  test('each market is due on its own last check', () => {
    const page = tracked({
      markets: [
        { marketId: 'us', lastCheckedAt: iso(AT), firstCheckNotBefore: null },
        { marketId: 'mx', lastCheckedAt: iso(AT + 14 * DAY), firstCheckNotBefore: null }
      ]
    })
    const plan = planSchedule(input([page]), AT + 14 * DAY, 'UTC')
    expect(plan.due.pages[0]?.marketIds).toEqual(['us'])
  })

  test('a 30 day page is not due at 14 days, and an import interval of 60 is accepted', () => {
    const thirty = planSchedule(input([tracked({ intervalDays: 30 })]), AT + 14 * DAY, 'UTC')
    expect(thirty.due.pages).toEqual([])
    const sixty = planSchedule(input([tracked({ intervalDays: 60 })]), AT + 60 * DAY, 'UTC')
    expect(sixty.due.pages).toHaveLength(1)
  })

  test('the returned project schedule matches the contract fields', () => {
    const plan = planSchedule(input(), AT + 14 * DAY, 'UTC')
    expect(Object.keys(plan.projects[0] ?? {}).sort()).toEqual(
      [
        'catchUp',
        'dailyCheckTime',
        'defaultIntervalDays',
        'nextCheckAt',
        'pagesDueToday',
        'paused',
        'projectId',
        'quietFrom',
        'quietUntil',
        'spreadAcrossDay'
      ].sort()
    )
    expect(Object.keys(plan.due.pages[0] ?? {}).sort()).toEqual(
      [
        'dueAt',
        'intervalDays',
        'label',
        'marketIds',
        'pageId',
        'projectId',
        'promptIds',
        'reason',
        'title',
        'url'
      ].sort()
    )
    expect(plan.due.day).toBe('2026-04-20')
  })

  test('pause and resume are per project and per page', () => {
    const paused = planSchedule(input([tracked()], [pauseProject(project())]), AT + 14 * DAY, 'UTC')
    expect(paused.due.pages).toEqual([])
    expect(paused.projects[0]).toMatchObject({
      paused: true,
      pagesDueToday: 0,
      nextCheckAt: '2026-04-20T08:00:00.000Z'
    })

    const resumed = planSchedule(
      input([tracked()], [resumeProject(paused.projects[0] ?? project())]),
      AT + 14 * DAY,
      'UTC'
    )
    expect(resumed.due.pages).toHaveLength(1)
    expect(resumed.projects[0]?.paused).toBe(false)

    const heldPage = planSchedule(input([pausePage(tracked())]), AT + 14 * DAY, 'UTC')
    expect(heldPage.due.pages).toEqual([])
    // A paused topic is held the same way; an empty topic (no question yet) is never due.
    const topic = { url: null, pageId: 'topic-1' }
    expect(
      planSchedule(input([pausePage(tracked(topic))]), AT + 14 * DAY, 'UTC').due.pages
    ).toEqual([])
    expect(
      planSchedule(input([tracked({ ...topic, noQuestions: true })]), AT + 14 * DAY, 'UTC').due
        .pages
    ).toEqual([])
    expect(
      planSchedule(input([tracked({ ...topic, noQuestions: false })]), AT + 14 * DAY, 'UTC').due
        .pages
    ).toHaveLength(1)
    expect(checkNowMarketIds(pausePage(tracked()), project())).toEqual({
      ok: true,
      marketIds: ['us']
    })
    expect(checkNowMarketIds(resumePage(pausePage(tracked())), project()).ok).toBe(true)
    expect(resumePage(tracked({ status: 'removed' })).status).toBe('removed')
    expect(pausePage(tracked({ status: 'setting_up' })).status).toBe('setting_up')
    expect(checkNowMarketIds(tracked(), pauseProject(project()))).toEqual({
      ok: true,
      marketIds: ['us']
    })
    expect(checkNowMarketIds(tracked({ status: 'removed' }), project())).toEqual({
      ok: false,
      reason: 'not_scheduled'
    })
  })

  test('an archived project is never due', () => {
    const archived = planSchedule(
      input([tracked()], [project({ archived: true })]),
      AT + 14 * DAY,
      'UTC'
    )
    expect(archived.due.pages).toEqual([])
    expect(archived.projects[0]).toMatchObject({
      paused: false,
      nextCheckAt: null,
      pagesDueToday: 0
    })
    expect('archived' in (archived.projects[0] ?? {})).toBe(false)
    expect(checkNowMarketIds(tracked(), project({ archived: true }))).toEqual({
      ok: false,
      reason: 'archived'
    })

    const withFollowUp = planSchedule(
      {
        ...input([tracked()], [project({ archived: true })]),
        followUps: [followUp()]
      },
      AT + 3 * DAY,
      'UTC'
    )
    expect(withFollowUp.due.pages).toEqual([])
    expect(withFollowUp.projects[0]?.nextCheckAt).toBeNull()
  })

  test('quiet hours that cross midnight hold the check until they end', () => {
    const night = project({ quietFrom: '22:00', quietUntil: '07:00', dailyCheckTime: '06:00' })
    const page = tracked({
      markets: [
        {
          marketId: 'us',
          lastCheckedAt: iso(Date.parse('2026-04-05T23:00:00.000Z') - 14 * DAY),
          firstCheckNotBefore: null
        }
      ]
    })
    const during = planSchedule(
      input([page], [night]),
      Date.parse('2026-04-05T23:30:00.000Z'),
      'UTC'
    )
    expect(during.due.pages).toEqual([])
    expect(during.projects[0]?.nextCheckAt).toBe('2026-04-06T07:00:00.000Z')

    const after = planSchedule(
      input([page], [night]),
      Date.parse('2026-04-06T07:00:00.000Z'),
      'UTC'
    )
    expect(after.due.pages[0]?.dueAt).toBe('2026-04-06T07:00:00.000Z')
  })

  test('a missed check catches up on wake only when the app and the project both allow it', () => {
    const missedAt = AT - DAY
    const page = tracked({
      markets: [
        { marketId: 'us', lastCheckedAt: iso(missedAt - 14 * DAY), firstCheckNotBefore: null }
      ]
    })
    const now = Date.parse('2026-04-06T07:30:00.000Z')
    const caught = planSchedule(input([page], [project({ dailyCheckTime: '08:00' })]), now, 'UTC')
    expect(caught.due.pages[0]).toMatchObject({ reason: 'catch_up', dueAt: iso(missedAt) })
    expect(caught.due.pages[0]?.fixId).toBeUndefined()

    const waiting = planSchedule(
      input([page], [project({ dailyCheckTime: '08:00', catchUp: false })]),
      now,
      'UTC'
    )
    expect(waiting.due.pages[0]).toMatchObject({
      reason: 'scheduled',
      dueAt: '2026-04-06T08:00:00.000Z'
    })

    const appOff = planSchedule(
      input([page], [project({ dailyCheckTime: '08:00', catchUp: true })], {
        catchUpAfterSleep: false
      }),
      now,
      'UTC'
    )
    expect(appOff.due.pages[0]?.reason).toBe('scheduled')
    expect(appOff.due.pages[0]?.dueAt).toBe('2026-04-06T08:00:00.000Z')
  })

  test('follow-ups run on day 3 or 7, or on the next scheduled check, and only the targeted prompts', () => {
    const page = tracked()
    const three = followUp({ rule: 'after_3_days', promptIds: ['p1', 'p2'], marketIds: ['us'] })
    const early = planSchedule({ ...input([page]), followUps: [three] }, AT, 'UTC')
    expect(early.due.pages).toEqual([])
    expect(early.projects[0]?.nextCheckAt).toBe(iso(AT + 3 * DAY))

    const due = planSchedule({ ...input([page]), followUps: [three] }, AT + 3 * DAY, 'UTC')
    expect(due.due.pages).toEqual([
      expect.objectContaining({
        reason: 'follow_up',
        promptIds: ['p1', 'p2'],
        marketIds: ['us'],
        dueAt: iso(AT + 3 * DAY),
        fixId: three.id
      })
    ])
    expect(
      due.due.pages.every((item) => item.reason === 'follow_up' || item.fixId === undefined)
    ).toBe(true)

    const seven = planSchedule(
      { ...input([page]), followUps: [followUp({ rule: 'after_7_days' })] },
      AT + 3 * DAY,
      'UTC'
    )
    expect(seven.due.pages).toEqual([])

    const next = planSchedule(
      { ...input([page]), followUps: [followUp({ rule: 'next_scheduled' })] },
      AT + 14 * DAY,
      'UTC'
    )
    const reasons = next.due.pages.map((item) => item.reason)
    expect(reasons).toContain('scheduled')
    expect(reasons).toContain('follow_up')
    expect(next.due.pages.find((item) => item.reason === 'scheduled')?.fixId).toBeUndefined()
    expect(next.due.pages.find((item) => item.reason === 'follow_up')?.fixId).toBe('fix-1')
    expect(
      next.due.pages
        .filter((item) => item.reason !== 'follow_up')
        .every((item) => item.fixId === undefined)
    ).toBe(true)
  })

  test('spreads due pages in batches of 5 every 15 minutes, skipping quiet hours', () => {
    expect(SPREAD_BATCH_SIZE).toBe(5)
    expect(SPREAD_BATCH_GAP_MS).toBe(15 * 60 * 1000)
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const pages = ids.map((pageId) => tracked({ pageId }))
    const now = AT + 14 * DAY
    const open = planSchedule(input(pages, [project({ spreadAcrossDay: true })]), now, 'UTC')
    expect(open.due.pages.map((page) => [page.pageId, page.dueAt])).toEqual([
      ['a', '2026-04-20T08:00:00.000Z'],
      ['b', '2026-04-20T08:00:00.000Z'],
      ['c', '2026-04-20T08:00:00.000Z'],
      ['d', '2026-04-20T08:00:00.000Z'],
      ['e', '2026-04-20T08:00:00.000Z'],
      ['f', '2026-04-20T08:15:00.000Z']
    ])

    const quiet = planSchedule(
      input(pages, [project({ spreadAcrossDay: true, quietFrom: '08:10', quietUntil: '09:00' })]),
      now,
      'UTC'
    )
    expect(quiet.due.pages.map((page) => [page.pageId, page.dueAt])).toEqual([
      ['a', '2026-04-20T08:00:00.000Z'],
      ['b', '2026-04-20T08:00:00.000Z'],
      ['c', '2026-04-20T08:00:00.000Z'],
      ['d', '2026-04-20T08:00:00.000Z'],
      ['e', '2026-04-20T08:00:00.000Z'],
      ['f', '2026-04-20T09:00:00.000Z']
    ])

    const off = project({ spreadAcrossDay: true, quietFrom: '08:00', quietUntil: '08:00' })
    const noQuiet = planSchedule(input(pages, [off]), now, 'UTC')
    expect(noQuiet.due.pages.map((page) => page.dueAt)).toEqual(
      open.due.pages.map((page) => page.dueAt)
    )

    const late = Date.parse('2026-04-20T23:50:00.000Z')
    const overnight = project({ spreadAcrossDay: true, dailyCheckTime: '23:50' })
    const carried = planSchedule(input(pages, [overnight]), late, 'UTC')
    expect(carried.due.day).toBe('2026-04-20')
    expect(carried.due.pages.map((page) => page.pageId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(carried.due.pages.every((page) => page.dueAt === '2026-04-20T23:50:00.000Z')).toBe(true)
    expect(carried.projects[0]?.pagesDueToday).toBe(5)
    expect(spreadSlots(overnight, 6, late, 'UTC').map((at) => iso(at))).toEqual([
      '2026-04-20T23:50:00.000Z',
      '2026-04-20T23:50:00.000Z',
      '2026-04-20T23:50:00.000Z',
      '2026-04-20T23:50:00.000Z',
      '2026-04-20T23:50:00.000Z',
      '2026-04-21T23:50:00.000Z'
    ])
  })

  test('a page still setting up is due today once it has a prompt set', () => {
    const fresh = tracked({
      status: 'setting_up',
      promptSetVersion: 1,
      markets: [{ marketId: 'us', lastCheckedAt: null, firstCheckNotBefore: null }]
    })
    const plan = planSchedule(input([fresh]), AT + 14 * DAY, 'UTC')
    expect(plan.due.pages.map((page) => page.pageId)).toEqual(['page-1'])
    expect(plan.projects[0]?.pagesDueToday).toBe(1)
    expect(plannedMaxSearches(plan, 10)).toBe(20)

    const held = tracked({
      status: 'setting_up',
      promptSetVersion: 1,
      markets: [
        {
          marketId: 'us',
          lastCheckedAt: null,
          firstCheckNotBefore: iso(AT + 14 * DAY + DAY)
        }
      ]
    })
    const waiting = planSchedule(
      input([held], [project({ dailyCheckTime: '00:00' })]),
      AT + 14 * DAY,
      'UTC'
    )
    expect(waiting.due.pages).toEqual([])
    expect(waiting.projects[0]?.pagesDueToday).toBe(0)
    expect(plannedMaxSearches(waiting, 10)).toBe(0)
  })

  test('a first check that waits for the user is never due; checked markets keep their schedule', () => {
    const waiting = tracked({
      promptSetVersion: 1,
      firstCheckWaits: true,
      markets: [{ marketId: 'us', lastCheckedAt: null, firstCheckNotBefore: null }]
    })
    const plan = planSchedule(input([waiting]), AT + 14 * DAY, 'UTC')
    expect(plan.due.pages).toEqual([])
    expect(plan.projects[0]?.pagesDueToday).toBe(0)
    expect(plan.projects[0]?.nextCheckAt).toBeNull()
    expect(plannedMaxSearches(plan, 10)).toBe(0)

    const checkedOnce = tracked({
      promptSetVersion: 1,
      firstCheckWaits: true,
      markets: [
        { marketId: 'us', lastCheckedAt: iso(AT), firstCheckNotBefore: null },
        { marketId: 'uk', lastCheckedAt: null, firstCheckNotBefore: null }
      ]
    })
    const later = planSchedule(input([checkedOnce]), AT + 14 * DAY, 'UTC')
    expect(later.due.pages.map((page) => page.marketIds)).toEqual([['us']])
  })

  test('a page still setting up with no prompts is not due and burns no searches', () => {
    const fresh = tracked({
      status: 'setting_up',
      promptSetVersion: null,
      markets: [{ marketId: 'us', lastCheckedAt: null, firstCheckNotBefore: null }]
    })
    const plan = planSchedule(input([fresh]), AT + 14 * DAY, 'UTC')
    expect(plan.due.pages).toEqual([])
    expect(plan.projects[0]?.pagesDueToday).toBe(0)
    expect(plannedMaxSearches(plan, 10)).toBe(0)
  })

  test('a page that has been read but has no buyer profile and no prompts is not due', () => {
    // A finished read with no profile and no prompt set leaves promptSetVersion null.
    const read = tracked({
      status: 'setting_up',
      promptSetVersion: null,
      title: 'How to Set Up Text Alerts for Business',
      markets: [{ marketId: 'us', lastCheckedAt: null, firstCheckNotBefore: null }]
    })
    const plan = planSchedule(input([read]), AT + 14 * DAY, 'UTC')
    expect(plan.due.pages).toEqual([])
    expect(plan.projects[0]?.pagesDueToday).toBe(0)
    expect(plannedMaxSearches(plan, 10)).toBe(0)
  })

  test('staggers first checks across 7 local days', () => {
    const slots = staggerFirstChecks(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], {
      startAt: '2026-04-01T00:00:00.000Z',
      timeZone: 'UTC'
    })
    expect(slots.map((slot) => slot.dayOffset)).toEqual([0, 0, 1, 2, 3, 4, 5, 6])
    expect(slots[2]?.firstCheckNotBefore).toBe('2026-04-02T00:00:00.000Z')

    const held = tracked({
      markets: [
        {
          marketId: 'us',
          lastCheckedAt: null,
          firstCheckNotBefore: slots[6]?.firstCheckNotBefore ?? ''
        }
      ]
    })
    const plan = planSchedule(
      input([held], [project({ dailyCheckTime: '00:00' })]),
      Date.parse('2026-04-01T00:00:00.000Z'),
      'UTC'
    )
    expect(plan.due.pages).toEqual([])
    expect(plan.projects[0]?.nextCheckAt).toBe(slots[6]?.firstCheckNotBefore)
  })

  test('keeps the local clock across the US spring-forward', () => {
    const slots = staggerFirstChecks(['a', 'b'], {
      startAt: '2026-03-07T12:00:00.000Z',
      timeZone: 'America/New_York',
      days: 2
    })
    expect(slots[1]?.firstCheckNotBefore).toBe('2026-03-08T11:00:00.000Z')
  })

  test('rejects a half-specified quiet window', () => {
    expect(() =>
      planSchedule(
        input([tracked()], [project({ quietFrom: '22:00', quietUntil: null })]),
        AT,
        'UTC'
      )
    ).toThrow(ScheduleError)
  })
})

function input(
  pages: readonly ScheduledPageInput[] = [tracked()],
  projects: readonly (ProjectSchedule & { archived?: boolean })[] = [project()],
  appPatch: Partial<AppSchedule> = {}
): {
  app: AppSchedule
  projects: readonly ScheduledProjectInput[]
  pages: readonly ScheduledPageInput[]
} {
  return {
    app: {
      startAtLogin: false,
      catchUpAfterSleep: true,
      checkWhenClosed: false,
      dailyCheckTime: '08:00',
      ...appPatch
    },
    projects: projects.map((item) => ({ ...item, archived: item.archived ?? false })),
    pages
  }
}

function project(patch: Partial<ScheduledProjectInput> = {}): ScheduledProjectInput {
  return {
    projectId: 'proj-1',
    defaultIntervalDays: 14,
    dailyCheckTime: '08:00',
    quietFrom: null,
    quietUntil: null,
    spreadAcrossDay: false,
    catchUp: true,
    paused: false,
    archived: false,
    nextCheckAt: null,
    pagesDueToday: 0,
    ...patch
  }
}

function tracked(patch: Partial<ScheduledPageInput> = {}): ScheduledPageInput {
  return {
    projectId: 'proj-1',
    pageId: 'page-1',
    label: 'Alerts',
    title: 'Text alerts',
    url: 'https://textbolt.com/text-alerts',
    status: 'tracked',
    intervalDays: 14,
    promptSetVersion: null,
    markets: [{ marketId: 'us', lastCheckedAt: iso(AT), firstCheckNotBefore: null }],
    ...patch
  }
}

function plannedMaxSearches(
  plan: { due: { pages: readonly { marketIds: readonly string[] }[] } },
  prompts: number
): number {
  return plan.due.pages.reduce(
    (sum, page) =>
      sum +
      estimateCheckSearches({
        prompts,
        markets: page.marketIds.length,
        samples: 1
      }).maxSearches,
    0
  )
}

function followUp(patch: Partial<FixFollowUpInput> = {}): FixFollowUpInput {
  return {
    id: 'fix-1',
    projectId: 'proj-1',
    pageId: 'page-1',
    description: 'Added a Saturday crew FAQ.',
    goLiveAt: iso(AT),
    rule: 'after_3_days',
    promptIds: ['p1'],
    marketIds: ['us'],
    ...patch
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}
