import type { CheckFinishedNotice } from '@shared/ipc'
import type { Logger } from '../logging/logger'
import { MemorySecretStore, type SecretStore } from '../secrets/secret-store'
import {
  createEmailService,
  createMemoryEmailPorts,
  type EmailService,
  type MemoryEmailPorts
} from './service'
import type { ReportFacts, SummaryWriter } from './types'

export const PASSWORD = 'quilt-maple-7f3a'

export interface EmailHarness {
  service: EmailService
  ports: MemoryEmailPorts
  secrets: SecretStore
  lines: string[]
  waits: number[]
  setNow(iso: string): void
}

export function emailHarness(options?: {
  now?: string
  secrets?: SecretStore
  knownSecrets?: () => readonly string[]
  summaryWriter?: SummaryWriter
}): EmailHarness {
  const ports = createMemoryEmailPorts()
  const secrets = options?.secrets ?? new MemorySecretStore()
  const lines: string[] = []
  const waits: number[] = []
  let current = new Date(options?.now ?? '2026-02-04T12:00:00.000Z')
  const logger: Logger = {
    debug(message, extra) {
      lines.push(JSON.stringify({ message, extra }))
    },
    info(message, extra) {
      lines.push(JSON.stringify({ message, extra }))
    },
    warn(message, extra) {
      lines.push(JSON.stringify({ message, extra }))
    },
    error(message, extra) {
      lines.push(JSON.stringify({ message, extra }))
    }
  }
  const service = createEmailService({
    secrets,
    logger,
    clock: { now: () => current, timeZone: 'UTC' },
    sleep: async (ms) => {
      waits.push(ms)
    },
    createId: sequentialIds(),
    knownSecrets: options?.knownSecrets,
    summaryWriter: options?.summaryWriter,
    ...ports
  })
  return {
    service,
    ports,
    secrets,
    lines,
    waits,
    setNow(iso: string) {
      current = new Date(iso)
    }
  }
}

export function accountBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: null,
    provider: 'other',
    fromName: 'CiteFox',
    fromAddress: 'reports@example.com',
    replyTo: null,
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    username: 'mailer',
    password: PASSWORD,
    isDefault: true,
    ...overrides
  }
}

export function notice(overrides: Partial<CheckFinishedNotice> = {}): CheckFinishedNotice {
  return {
    jobId: 'job-1',
    projectId: 'proj-1',
    pageId: 'page-1',
    pageLabel: 'Alerts',
    marketId: 'us',
    pageCited: 2,
    aiosShown: 5,
    pageCitedChange: -1,
    score: 40,
    scoreChange: -6,
    contentChanged: true,
    ...overrides
  }
}

export function reportBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: null,
    name: 'Monday report',
    projectId: 'proj-1',
    timing: { kind: 'after_check' },
    format: 'summary',
    sections: [],
    marketIds: ['us'],
    recipients: ['client@example.com'],
    accountId: null,
    timeZone: 'UTC',
    subject: '{project} {score}',
    summaryStyle: null,
    ...overrides
  }
}

export function facts(): ReportFacts {
  return {
    project: 'TextBolt',
    dateRange: '1 Feb 2026 – 4 Feb 2026',
    market: 'US',
    score: '40',
    lines: ['Score 40']
  }
}

function sequentialIds(): () => string {
  let n = 0
  return () => {
    n += 1
    return `id-${n}`
  }
}
