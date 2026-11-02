import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { AlertRuleInput, SaveAlertRuleRequest } from '@shared/ipc'
import type { AlertDesktopNotice, AlertEmail, AlertSenders, AlertSlack } from '../alerts/deliver'
import { closeSeeds } from '../engine/checks/checks.test-helper'
import { MemoryWebhookTransport, WebhookDeliveryError } from '../email/webhook'
import { openProgressSeed, PROGRESS_SEED, type ProgressSeed } from './progress.test-helper'

const opened: ProgressSeed[] = []
const directories: string[] = []

afterEach(() => {
  for (const seed of opened.splice(0)) seed.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  closeSeeds()
})

const projectId = PROGRESS_SEED.projectId
const [ONE] = PROGRESS_SEED.prompts
const SLACK = 'https://hooks.slack.com/services/T000/B000/abcdefabcdef'

interface Sent {
  desktop: AlertDesktopNotice[]
  email: AlertEmail[]
  slack: AlertSlack[]
}

function open(): { seed: ProgressSeed; sent: Sent; webhooks: MemoryWebhookTransport } {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-alert-rules-'))
  directories.push(dir)
  const sent: Sent = { desktop: [], email: [], slack: [] }
  const senders: AlertSenders = {
    desktop: (notice) => {
      sent.desktop.push(notice)
    },
    email: async (input) => {
      sent.email.push(input)
      return true
    },
    slack: async (input) => {
      sent.slack.push(input)
      return true
    }
  }
  const webhooks = new MemoryWebhookTransport()
  const seed = openProgressSeed(dir, {
    alertSenders: senders,
    emailPorts: { webhooks, sleep: async () => undefined }
  })
  opened.push(seed)
  return { seed, sent, webhooks }
}

function rule(patch: Partial<SaveAlertRuleRequest> = {}): SaveAlertRuleRequest {
  return {
    projectId,
    id: null,
    name: 'Money pages lose a citation',
    when: 'citation_lost',
    scoreDrop: null,
    competitorDomain: null,
    scope: { kind: 'tracked', ids: [] },
    marketIds: [],
    desktop: true,
    emailTo: ['ada@example.com', 'lin@example.com'],
    slack: true,
    delivery: 'instant',
    ...patch
  }
}

/** The editable fields only, as the drawer sends them to the dry run. */
function input(patch: Partial<SaveAlertRuleRequest> = {}): AlertRuleInput {
  const full = rule(patch)
  return {
    name: full.name,
    when: full.when,
    scoreDrop: full.scoreDrop,
    competitorDomain: full.competitorDomain,
    scope: full.scope,
    marketIds: full.marketIds,
    desktop: full.desktop,
    emailTo: full.emailTo,
    slack: full.slack,
    delivery: full.delivery
  }
}

describe('alert rules over real IPC', () => {
  test('create, edit, pause, resume and delete, one or many at a time', async () => {
    const { seed } = open()
    const h = seed.handlers
    expect(await h['alerts:listRules']({ projectId })).toEqual({
      projectId,
      rules: [],
      slackReady: false
    })
    const first = await h['alerts:saveRule'](rule())
    expect(first).toMatchObject({
      projectId,
      status: 'active',
      emailTo: ['ada@example.com', 'lin@example.com'],
      firedCount: 0,
      lastFiredAt: null
    })
    const second = await h['alerts:saveRule'](
      rule({ name: 'Score drops', when: 'score_drop', scoreDrop: 12, delivery: 'digest' })
    )
    const edited = await h['alerts:saveRule'](
      rule({ id: first.id, name: 'Renamed', scope: { kind: 'pages', ids: [PROGRESS_SEED.pageId] } })
    )
    expect(edited).toMatchObject({ id: first.id, name: 'Renamed', createdAt: first.createdAt })
    expect(edited.scope).toEqual({ kind: 'pages', ids: [PROGRESS_SEED.pageId] })

    expect(
      await h['alerts:setRuleStatus']({ projectId, ids: [first.id, second.id], status: 'paused' })
    ).toEqual({ ids: [first.id, second.id] })
    let listed = await h['alerts:listRules']({ projectId })
    expect(listed.rules.map((item) => item.status)).toEqual(['paused', 'paused'])
    await h['alerts:setRuleStatus']({ projectId, ids: [second.id], status: 'active' })
    listed = await h['alerts:listRules']({ projectId })
    expect(listed.rules.map((item) => [item.name, item.status])).toEqual([
      ['Renamed', 'paused'],
      ['Score drops', 'active']
    ])
    // Saving a paused rule keeps it paused.
    expect((await h['alerts:saveRule'](rule({ id: first.id }))).status).toBe('paused')

    expect(await h['alerts:deleteRule']({ projectId, ids: [first.id, second.id] })).toEqual({
      ids: [first.id, second.id]
    })
    expect((await h['alerts:listRules']({ projectId })).rules).toEqual([])
  })

  test('refuses a rule with nowhere to go, a bad email, an empty scope or an unknown key', async () => {
    const { seed } = open()
    const save = seed.handlers['alerts:saveRule']
    await expect(save(rule({ desktop: false, slack: false, emailTo: [] }))).rejects.toThrow(
      /Choose where the alert goes/
    )
    await expect(save(rule({ emailTo: ['ada@example.com', 'not an email'] }))).rejects.toThrow(
      /is not an email address/
    )
    await expect(save(rule({ scope: { kind: 'group', ids: [] } }))).rejects.toThrow(
      /Pick at least one/
    )
    await expect(save({ ...rule(), extra: 1 } as SaveAlertRuleRequest)).rejects.toThrow(/Invalid/)
    await expect(save(rule({ id: 'missing-rule' }))).rejects.toThrow(/not found/)
    await expect(
      save(rule({ when: 'competitor_cited', competitorDomain: 'not a domain' }))
    ).rejects.toThrow(/Type the competitor as a domain/)
    const ok = await save(
      rule({ when: 'competitor_cited', competitorDomain: 'https://www.Twilio.com/pricing' })
    )
    expect(ok.competitorDomain).toBe('twilio.com')
  })

  test('a check that loses a citation fires the rule once, to every address, and logs it', async () => {
    const { seed, sent } = open()
    const h = seed.handlers
    const saved = await h['alerts:saveRule'](rule())
    // A group with no pages watches nothing.
    await h['alerts:saveRule'](
      rule({ name: 'Unused', scope: { kind: 'group', ids: ['no-such-group'] } })
    )
    await seed.check(PROGRESS_SEED.first)
    expect(sent.desktop).toHaveLength(0)

    seed.bodies.set(`us|${ONE.text}`, 'google-competitor.json')
    await seed.check(PROGRESS_SEED.second)
    expect(sent.desktop).toHaveLength(1)
    expect(sent.desktop[0]).toMatchObject({
      projectId,
      title: 'Money pages lose a citation',
      body: 'Alerts: Target page no longer cited on 1 question',
      hash: `#/p/${projectId}/alerts/log`
    })
    expect(sent.email).toHaveLength(1)
    expect(sent.email[0]?.to).toEqual(['ada@example.com', 'lin@example.com'])
    expect(sent.email[0]?.subject).toBe('CiteFox alert: Money pages lose a citation (1 page)')
    expect(sent.email[0]?.text).toContain(ONE.text)
    expect(sent.slack).toHaveLength(1)

    const log = await h['alerts:listLog']({ projectId })
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]).toMatchObject({
      ruleId: saved.id,
      ruleName: 'Money pages lose a citation',
      when: 'citation_lost',
      pageId: PROGRESS_SEED.pageId,
      pageLabel: 'Alerts',
      marketId: PROGRESS_SEED.us,
      summary: 'Target page no longer cited on 1 question',
      details: [ONE.text],
      deliveredTo: ['Desktop', '2 emails', 'Slack']
    })
    const listed = await h['alerts:listRules']({ projectId })
    expect(listed.rules[0]).toMatchObject({ firedCount: 1 })
    expect(listed.rules[1]).toMatchObject({ firedCount: 0 })

    // The dry run over stored checks agrees with what fired live.
    const dry = await h['alerts:dryRun']({ projectId, rule: input() })
    expect(dry).toMatchObject({ days: 30, fired: 1 })
    expect(dry.checksRead).toBe(4)
    expect(dry.events[0]).toMatchObject({
      pageLabel: 'Alerts',
      marketId: PROGRESS_SEED.us,
      summary: 'Target page no longer cited on 1 question'
    })
    const ukOnly = await h['alerts:dryRun']({
      projectId,
      rule: input({ marketIds: [PROGRESS_SEED.uk] })
    })
    expect(ukOnly.fired).toBe(0)
    const gained = await h['alerts:dryRun']({ projectId, rule: input({ when: 'citation_gained' }) })
    expect(gained.fired).toBe(0)
  })

  test('a paused rule does not fire; a digest rule waits a day, then sends one message', async () => {
    const { seed, sent } = open()
    const h = seed.handlers
    const paused = await h['alerts:saveRule'](rule({ name: 'Paused one' }))
    await h['alerts:setRuleStatus']({ projectId, ids: [paused.id], status: 'paused' })
    const digest = await h['alerts:saveRule'](
      rule({ name: 'Daily losses', delivery: 'digest', slack: false, emailTo: ['ada@example.com'] })
    )
    await seed.check(PROGRESS_SEED.first)
    seed.bodies.set(`us|${ONE.text}`, 'google-competitor.json')
    await seed.check(PROGRESS_SEED.second)
    expect(sent.desktop).toHaveLength(0)
    expect(sent.email).toHaveLength(0)
    let log = await h['alerts:listLog']({ projectId })
    expect(log.entries.map((entry) => [entry.ruleId, entry.deliveredTo])).toEqual([
      [digest.id, ['Waiting for the daily digest']]
    ])

    // The next check a day later sends the waiting digest.
    await seed.check('2026-10-21T12:00:00.000Z')
    expect(sent.email).toHaveLength(1)
    expect(sent.email[0]?.subject).toBe('CiteFox daily digest: Daily losses (1 page)')
    log = await h['alerts:listLog']({ projectId, ruleId: digest.id })
    expect(log.entries[0]?.deliveredTo).toEqual(['Daily digest: Desktop', 'Daily digest: 1 email'])
  })

  test('Send a test message posts once to the typed or saved webhook and says what Slack said', async () => {
    const { seed, webhooks } = open()
    const h = seed.handlers
    const none = await h['alerts:testSlack']({ projectId })
    expect(none).toMatchObject({ ok: false, message: 'Save a Slack webhook URL first.' })
    const typed = await h['alerts:testSlack']({ projectId, webhook: SLACK })
    expect(typed).toMatchObject({ ok: true })
    expect(webhooks.posts).toHaveLength(1)
    expect(webhooks.posts[0]?.body).toContain('CiteFox test message')
    // A typed URL is not saved.
    expect((await h['alerts:get']({ projectId })).slackWebhookStored).toBe(false)

    await h['alerts:update']({ projectId, slackEnabled: true, slackWebhook: SLACK })
    expect((await h['alerts:listRules']({ projectId })).slackReady).toBe(true)
    webhooks.failure = new WebhookDeliveryError('The Slack webhook answered 404.', false)
    const failed = await h['alerts:testSlack']({ projectId })
    expect(failed).toEqual({
      ok: false,
      testedAt: expect.any(String),
      message: 'The Slack webhook answered 404.'
    })
    expect(JSON.stringify(failed)).not.toContain('hooks.slack.com')
    await expect(
      h['alerts:testSlack']({ projectId, webhook: 'https://example.com/hook' })
    ).rejects.toThrow(/hooks.slack.com/)
  })
})
