import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { emailServiceSenders, withAlertRules } from '../alerts/runtime'
import { createAlertRulesService } from '../alerts/service'
import { createCheckEngine, createCheckRunner } from '../engine/checks'
import { closeSeeds } from '../engine/checks/checks.test-helper'
import { engineEmailFor, openEngineEmail } from '../email/engine-email'
import { accountBody } from '../email/harness'
import { MemorySmtpTransport } from '../email/transport'
import { MemoryWebhookTransport } from '../email/webhook'
import {
  openProgressSeed,
  PROGRESS_SEED,
  type ProgressSeed
} from '../handlers/progress.test-helper'
import { createLogger } from '../logging/logger'
import { manualClock } from '../scheduler/clock'
import { MemorySecretStore } from '../secrets/secret-store'
import { CHECK_DUE_EXIT_OK } from './check-due'
import { runCheckDueCommand } from './storage-pass'

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

/** A seeded project with an SMTP account, a Slack webhook, an instant rule and one check. */
async function seeded(): Promise<{
  seed: ProgressSeed
  smtp: MemorySmtpTransport
  webhooks: MemoryWebhookTransport
  ruleId: string
}> {
  const dir = mkdtempSync(join(tmpdir(), 'citefox-headless-alerts-'))
  directories.push(dir)
  const smtp = new MemorySmtpTransport()
  const webhooks = new MemoryWebhookTransport()
  const seed = openProgressSeed(dir, {
    secrets: new MemorySecretStore(),
    emailPorts: { transport: smtp, webhooks, sleep: async () => undefined }
  })
  opened.push(seed)
  const h = seed.handlers
  await h['email:saveAccount'](accountBody() as never)
  await h['alerts:update']({ projectId, slackEnabled: true, slackWebhook: SLACK })
  const rule = await h['alerts:saveRule']({
    projectId,
    id: null,
    name: 'Money pages lose a citation',
    when: 'citation_lost',
    scoreDrop: null,
    competitorDomain: null,
    scope: { kind: 'tracked', ids: [] },
    marketIds: [],
    desktop: false,
    emailTo: ['ada@example.com', 'lin@example.com'],
    slack: true,
    delivery: 'instant'
  })
  await seed.check(PROGRESS_SEED.first)
  return { seed, smtp, webhooks, ruleId: rule.id }
}

/** The engine, alert service and runner `citefox --check-due` builds (main/index.ts). */
function headlessParts(
  seed: ProgressSeed,
  at: string
): {
  senders: ReturnType<typeof emailServiceSenders>
  runner: ReturnType<typeof createCheckRunner>
  engine: ReturnType<typeof withAlertRules>
} {
  const logger = createLogger({ write: () => undefined })
  const now = (): Date => new Date(at)
  let sequence = 0
  const createId = (): string => `headless-${(sequence += 1)}`
  const senders = emailServiceSenders(
    seed.storage,
    () => undefined,
    () => openEngineEmail({ storage: seed.storage, secrets: seed.secrets, logger })
  )
  const alerts = createAlertRulesService({ storage: seed.storage, logger, now, createId, senders })
  const deps = {
    storage: seed.storage,
    secrets: seed.secrets,
    logger,
    http: seed.http,
    now,
    createId,
    emitProgress: () => undefined,
    emitFinished: () => undefined,
    knownSecrets: () => [],
    sleep: async () => undefined
  }
  const engine = withAlertRules(createCheckEngine(deps), alerts)
  return { senders, runner: createCheckRunner(deps, engine), engine }
}

describe('alert rules on the headless (scheduled) check path', () => {
  test('a scheduled check with no window open emails every address and posts to Slack', async () => {
    const { seed, smtp, webhooks, ruleId } = await seeded()
    expect(smtp.sent).toHaveLength(0)
    // The window is gone: no email host is open for the alert senders to borrow.
    seed.closeEmailHost()
    expect(engineEmailFor(seed.storage.db)).toBeUndefined()

    seed.bodies.set(`us|${ONE.text}`, 'google-competitor.json')
    const parts = headlessParts(seed, PROGRESS_SEED.second)
    const result = await parts.runner.run({
      id: 'scheduled-1',
      projectId,
      pageId: PROGRESS_SEED.pageId,
      marketIds: [],
      reason: 'scheduled',
      promptIds: null,
      partial: false,
      needsClaude: false,
      maxSearches: 100,
      startedAt: PROGRESS_SEED.second,
      cancelRequested: false
    })
    expect(result.outcome).toBe('ok')
    await parts.engine.reportsIdle()

    expect(smtp.sent).toHaveLength(1)
    expect(smtp.sent[0]?.message.to).toEqual(['ada@example.com', 'lin@example.com'])
    expect(smtp.sent[0]?.message.subject).toBe(
      'CiteFox alert: Money pages lose a citation (1 page)'
    )
    expect(webhooks.posts).toHaveLength(1)
    expect(webhooks.posts[0]?.body).toContain('Money pages lose a citation')
    const log = await seed.handlers['alerts:listLog']({ projectId, ruleId })
    expect(log.entries[0]?.deliveredTo).toEqual(['2 emails', 'Slack'])
    parts.senders.close()
    expect(engineEmailFor(seed.storage.db)).toBeUndefined()
  })

  test('without a host or a way to open one, email and Slack say they were not sent', async () => {
    const { seed, smtp, webhooks } = await seeded()
    seed.closeEmailHost()
    const senders = emailServiceSenders(seed.storage, () => undefined)
    expect(
      await senders.email({ projectId, to: ['ada@example.com'], subject: 's', text: 't' })
    ).toBe(false)
    expect(await senders.slack({ projectId, text: 't', occurrenceKey: 'k' })).toBe(false)
    expect(smtp.sent).toHaveLength(0)
    expect(webhooks.posts).toHaveLength(0)
  })

  test('--check-due sends the daily digests that came due after its page checks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'citefox-headless-digest-'))
    directories.push(dir)
    const order: string[] = []
    const flushDueDigests = vi.fn(async () => {
      order.push('digests')
      return 2
    })
    const code = await runCheckDueCommand({
      clock: manualClock(Date.parse(PROGRESS_SEED.second)),
      timeZone: 'UTC',
      autoExport: {
        note: () => undefined,
        flush: async () => {
          order.push('exports')
        }
      },
      alerts: { flushDueDigests },
      background: async () => {
        order.push('background')
      }
    })
    expect(code).toBe(CHECK_DUE_EXIT_OK)
    expect(flushDueDigests).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['exports', 'digests', 'background'])
  })
})
