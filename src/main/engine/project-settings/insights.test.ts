import { afterEach, describe, expect, test } from 'vitest'
import { cleanupHarness } from '../../handlers/test-harness'
import { recordActivity } from '../../storage/activity-events'
import { addKeyUsage, insertConnectionEvent } from '../../storage/records'
import { closeSeeds, envelope, seed } from '../checks/checks.test-helper'
import { when } from './activity'
import { adminHarness, projectRequest } from './admin.test-helper'
import { notCompetitorReason, rankCompetitors, type CitedReference } from './competitors'

afterEach(() => {
  cleanupHarness()
  closeSeeds()
})

function cited(domain: string, overviewId: string, url?: string): CitedReference {
  return { domain, url: url ?? `https://${domain}/page`, overviewId, sourceType: 'web' }
}

describe('Find competitors from AI Overviews (FR-10.9)', () => {
  test('ranks by overviews, leaves out the own domain, and marks non-competitors', () => {
    const ranked = rankCompetitors({
      ownDomain: 'textbolt.com',
      competitors: ['Twilio', 'clicksend.com'],
      references: [
        cited('simpletexting.com', 'o1'),
        cited('simpletexting.com', 'o2'),
        cited('simpletexting.com', 'o2'),
        cited('www.twilio.com', 'o1'),
        cited('twilio.com', 'o3'),
        cited('textbolt.com', 'o1'),
        cited('help.textbolt.com', 'o2'),
        cited('verizon.com', 'o3'),
        cited('help.pagerduty.com', 'o1'),
        cited('clicksend.com', 'o4'),
        cited('en.wikipedia.org', 'o4')
      ]
    })
    expect(ranked.map((item) => [item.domain, item.overviews, item.citations])).toEqual([
      ['simpletexting.com', 2, 3],
      ['twilio.com', 2, 2],
      ['clicksend.com', 1, 1],
      ['en.wikipedia.org', 1, 1],
      ['help.pagerduty.com', 1, 1],
      ['verizon.com', 1, 1]
    ])
    const by = new Map(ranked.map((item) => [item.domain, item]))
    expect(by.get('simpletexting.com')).toMatchObject({
      likelyCompetitor: true,
      listed: false,
      reason: 'Cited in 2 overviews instead of you'
    })
    expect(by.get('twilio.com')?.listed).toBe(true)
    expect(by.get('clicksend.com')).toMatchObject({
      listed: true,
      reason: 'Cited in 1 overview instead of you'
    })
    expect(by.get('verizon.com')).toMatchObject({
      likelyCompetitor: false,
      reason: 'Carrier help page, probably not a competitor'
    })
    expect(by.get('help.pagerduty.com')?.likelyCompetitor).toBe(false)
    expect(by.get('en.wikipedia.org')?.reason).toBe('Reference site, probably not a competitor')
  })

  test('review, community, public-sector, and help-path pages are not competitors', () => {
    expect(notCompetitorReason('g2.com', [], new Set(['web']))).toContain('Review site')
    expect(notCompetitorReason('reddit.com', [], new Set(['reddit']))).toContain('Community')
    expect(notCompetitorReason('fcc.gov', [], new Set(['web']))).toContain('Public-sector')
    expect(
      notCompetitorReason('acme.example', ['https://acme.example/support/sms'], new Set(['web']))
    ).toBe('Help page, probably not a competitor')
    expect(
      notCompetitorReason('acme.example', ['https://acme.example/pricing'], new Set(['web']))
    ).toBeNull()
  })

  test('reads the stored captures of a real check', async () => {
    const { handlers } = await seed({
      progress: [],
      http: () => envelope('google-ai-overview.json')
    })
    const before = await handlers['projectSettings:findCompetitors']({ projectId: 'proj-1' })
    expect(before.overviewsRead).toBe(0)
    expect(before.nextStep).toContain('Press Check now first')
    const job = await handlers['checks:start']({
      projectId: 'proj-1',
      pageIds: ['page-1'],
      marketIds: null,
      promptIds: null
    })
    expect(job.status).toBe('finished')
    const found = await handlers['projectSettings:findCompetitors']({ projectId: 'proj-1' })
    expect(found.overviewsRead).toBe(1)
    expect(found.latestCheckAt).not.toBeNull()
    expect(found.nextStep).toBeNull()
    expect(found.candidates.map((item) => [item.domain, item.listed])).toEqual([
      ['simpletexting.com', true],
      ['twilio.com', true]
    ])
    // Drill-down (NFR-14): one overview ref per overview counted, each tied to its prompt.
    for (const candidate of found.candidates) {
      expect(candidate.overviewRefs?.length).toBe(candidate.overviews)
      for (const ref of candidate.overviewRefs ?? []) {
        expect(ref.pageId).toBe('page-1')
        expect(ref.promptId.length).toBeGreaterThan(0)
        expect(ref.promptPosition).toBeGreaterThan(0)
        expect(ref.url).toContain(candidate.domain)
      }
      expect((candidate.overviewRefs ?? []).reduce((sum, ref) => sum + ref.citations, 0)).toBe(
        candidate.citations
      )
    }
  })
})

describe('Usage by project (FR-10.6)', () => {
  test('adds up key_usage, shares of the shared keys, unassigned capacity, and Claude calls', async () => {
    const opened = adminHarness()
    const textbolt = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const acme = await opened.handlers['projects:create'](
      projectRequest('Acme', 'acme.example', { clientName: 'Acme Inc.' })
    )
    const other = await opened.handlers['projects:create'](projectRequest('Other', 'other.example'))
    const add = async (name: string, cap: number): Promise<string> =>
      (
        await opened.handlers['keys:add']({
          provider: 'serpapi',
          name,
          secret: `serp-secret-${name.toLowerCase()}-0000`,
          cap,
          projectIds: []
        })
      ).id
    const planKey = await add('Plan', 1000)
    const backup = await add('Backup', 250)
    const client = await add('Client', 500)
    await opened.handlers['projectSettings:update']({
      projectId: textbolt.id,
      search: { source: 'shared', cap: 600, capRule: 'pause', dedicatedKeyId: null }
    })
    await opened.handlers['projectSettings:update']({
      projectId: acme.id,
      search: { source: 'dedicated', cap: null, capRule: 'pause', dedicatedKeyId: client }
    })
    await opened.handlers['projectSettings:update']({
      projectId: other.id,
      search: { source: 'shared', cap: 400, capRule: 'allow_10', dedicatedKeyId: null }
    })
    const usage = (keyId: string, projectId: string | null, searches: number): void =>
      addKeyUsage(opened.storage.db, {
        id: `u-${keyId}-${projectId ?? 'none'}`,
        keyId,
        projectId,
        month: '2026-10',
        searches,
        calls: searches,
        tokens: 0
      })
    usage(planKey, textbolt.id, 100)
    usage(planKey, other.id, 50)
    usage(backup, textbolt.id, 20)
    usage(client, acme.id, 30)
    usage(planKey, null, 5)
    for (const id of ['c1', 'c2']) {
      recordActivity(opened.storage.db, {
        id,
        at: '2026-10-19T12:00:00.000Z',
        kind: 'claude_call',
        keyId: null,
        projectId: textbolt.id,
        count: 1,
        detail: null
      })
    }
    const report = await opened.handlers['projectSettings:usage']()
    expect(report).toMatchObject({
      month: '2026-10',
      sharedUsed: 175,
      sharedCapacity: 1250,
      dedicatedUsed: 30,
      unassigned: 250,
      claudeCalls: 2
    })
    const row = (id: string): (typeof report.projects)[number] | undefined =>
      report.projects.find((item) => item.projectId === id)
    expect(row(textbolt.id)).toMatchObject({
      searches: 120,
      sharedSearches: 120,
      cap: 600,
      allowance: 600,
      source: 'shared',
      sharePercent: 10,
      claudeCalls: 2
    })
    expect(row(acme.id)).toMatchObject({
      searches: 30,
      sharedSearches: 0,
      source: 'dedicated',
      dedicatedKeyId: client,
      clientName: 'Acme Inc.',
      sharePercent: 0
    })
    expect(row(other.id)).toMatchObject({ allowance: 440, sharePercent: 4 })
    const total = report.projects.reduce((sum, item) => sum + item.searches, 0)
    expect(total + 5).toBe(report.sharedUsed + report.dedicatedUsed)

    await opened.handlers['projectSettings:update']({
      projectId: other.id,
      search: { source: 'shared', cap: null, capRule: 'pause', dedicatedKeyId: null }
    })
    expect((await opened.handlers['projectSettings:usage']()).unassigned).toBeNull()
  })
})

describe('Connections: last 24 hours and the latest failover (FR-11.10)', () => {
  test('counts the window and tells the latest event in plain words', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const key = await opened.handlers['keys:add']({
      provider: 'serpapi',
      name: 'My plan',
      secret: 'serp-secret-myplan-0000',
      cap: null,
      projectIds: []
    })
    const empty = await opened.handlers['connections:activity']()
    expect(empty).toMatchObject({ searches: 0, claudeCalls: 0, jinaReads: 0, latestEvent: null })
    const activity = (
      id: string,
      at: string,
      kind: 'search' | 'claude_call' | 'jina_read',
      count = 1
    ): void =>
      recordActivity(opened.storage.db, {
        id,
        at,
        kind,
        keyId: null,
        projectId: project.id,
        count,
        detail: null
      })
    activity('a1', '2026-10-19T11:00:00.000Z', 'search', 18)
    activity('a2', '2026-10-17T11:00:00.000Z', 'search', 99)
    activity('a3', '2026-10-19T11:05:00.000Z', 'claude_call')
    activity('a4', '2026-10-19T11:06:00.000Z', 'jina_read')
    insertConnectionEvent(opened.storage.db, {
      id: 'ev-limit',
      keyId: key.id,
      at: '2026-10-19T11:30:00.000Z',
      kind: 'rate_limited',
      detail: 'SerpApi is limiting this key.'
    })
    for (const index of [1, 2, 3]) {
      insertConnectionEvent(opened.storage.db, {
        id: `ev-fo-${index}`,
        keyId: key.id,
        at: `2026-10-19T11:2${index}:00.000Z`,
        kind: 'failover',
        detail: 'CiteFox moved this search to the next SerpApi key.'
      })
    }
    const read = await opened.handlers['connections:activity']()
    expect(read).toMatchObject({ searches: 18, claudeCalls: 1, jinaReads: 1 })
    expect(read.latestEvent?.provider).toBe('serpapi')
    expect(read.latestEvent?.sentence).toMatch(
      /^(At|On Oct \d+ at) \d{2}:\d{2}, SerpApi rate-limited "My plan"\. 3 searches moved to the next key\.$/
    )
    // A failover recorded after the limit is still told by its cause.
    insertConnectionEvent(opened.storage.db, {
      id: 'ev-fo-late',
      keyId: key.id,
      at: '2026-10-19T11:31:00.000Z',
      kind: 'failover',
      detail: 'CiteFox moved this search to the next SerpApi key.'
    })
    const later = await opened.handlers['connections:activity']()
    expect(later.latestEvent?.sentence).toMatch(
      /SerpApi rate-limited "My plan"\. 4 searches moved to the next key\.$/
    )

    recordActivity(opened.storage.db, {
      id: 'notice',
      at: '2026-10-19T11:45:00.000Z',
      kind: 'claude_limit',
      keyId: null,
      projectId: project.id,
      count: 1,
      detail:
        'Claude Code hit its limit for TextBolt. CiteFox will try again in 15 minutes; searches already made are kept.'
    })
    const newer = await opened.handlers['connections:activity']()
    expect(newer.latestEvent?.provider).toBe('claude')
    expect(newer.latestEvent?.sentence).toMatch(
      /^(At|On Oct \d+ at) \d{2}:\d{2}, Claude Code hit its limit/
    )
  })

  test('activityLog lists the rows behind each count, the told events, and month use per key', async () => {
    const opened = adminHarness()
    const project = await opened.handlers['projects:create'](
      projectRequest('TextBolt', 'textbolt.com')
    )
    const key = await opened.handlers['keys:add']({
      provider: 'serpapi',
      name: 'My plan',
      secret: 'serp-secret-myplan-0000',
      cap: null,
      projectIds: []
    })
    const empty = await opened.handlers['connections:activityLog']()
    expect(empty).toMatchObject({
      searches: 0,
      entries: [],
      latestEvents: [],
      keyMonth: [],
      keyEvents: []
    })
    const add = (
      id: string,
      at: string,
      kind: 'search' | 'claude_call' | 'jina_read',
      count = 1
    ): void =>
      recordActivity(opened.storage.db, {
        id,
        at,
        kind,
        keyId: kind === 'search' ? key.id : null,
        projectId: project.id,
        count,
        detail: null
      })
    add('s1', '2026-10-19T11:00:00.000Z', 'search', 2)
    add('s2', '2026-10-19T11:10:00.000Z', 'search', 1)
    add('old', '2026-10-17T11:00:00.000Z', 'search', 99)
    add('c1', '2026-10-19T11:05:00.000Z', 'claude_call')
    add('j1', '2026-10-19T11:06:00.000Z', 'jina_read')
    insertConnectionEvent(opened.storage.db, {
      id: 'ev-limit',
      keyId: key.id,
      at: '2026-10-19T11:30:00.000Z',
      kind: 'rate_limited',
      detail: 'SerpApi is limiting this key.'
    })
    insertConnectionEvent(opened.storage.db, {
      id: 'ev-fo',
      keyId: key.id,
      at: '2026-10-19T11:29:00.000Z',
      kind: 'failover',
      detail: 'CiteFox moved this search to the next SerpApi key.'
    })
    insertConnectionEvent(opened.storage.db, {
      id: 'ev-far',
      keyId: key.id,
      at: '2026-10-19T08:00:00.000Z',
      kind: 'failover',
      detail: 'An earlier burst.'
    })
    addKeyUsage(opened.storage.db, {
      id: 'ku1',
      keyId: key.id,
      projectId: project.id,
      month: '2026-10',
      searches: 40,
      calls: 0,
      tokens: 0
    })
    const log = await opened.handlers['connections:activityLog']()
    const plain = await opened.handlers['connections:activity']()
    expect(log).toMatchObject({ searches: 3, claudeCalls: 1, jinaReads: 1 })
    expect(plain).toMatchObject({ searches: 3, claudeCalls: 1, jinaReads: 1 })
    expect(log.entries.map((entry) => entry.id)).toEqual(['s2', 'j1', 'c1', 's1'])
    expect(log.entries[0]).toMatchObject({ keyName: 'My plan', projectName: 'TextBolt' })
    const searches = log.entries.filter((entry) => entry.kind === 'search')
    expect(searches.reduce((sum, entry) => sum + entry.count, 0)).toBe(log.searches)
    expect(log.latestEvent?.sentence).toBe(plain.latestEvent?.sentence)
    expect(log.latestEvents.map((event) => event.id)).toEqual(['ev-limit', 'ev-fo'])
    expect(log.latestEvents[0]).toMatchObject({ keyId: key.id, keyName: 'My plan' })
    expect(log.keyMonth).toEqual([
      { keyId: key.id, projectId: project.id, projectName: 'TextBolt', searches: 40 }
    ])
    expect(log.keyEvents.map((event) => event.id)).toEqual(['ev-limit', 'ev-fo', 'ev-far'])
    expect(log.month).toMatch(/^\d{4}-\d{2}$/)
    expect(JSON.stringify(log)).not.toContain('serp-secret-myplan-0000')
  })

  test('times read "At" today and "On <date> at" before that', () => {
    const now = new Date('2026-10-19T15:00:00.000Z')
    expect(when('2026-10-19T14:02:00.000Z', now, 'UTC')).toBe('At 14:02')
    expect(when('2026-10-18T09:05:00.000Z', now, 'UTC')).toBe('On Oct 18 at 09:05')
  })
})
