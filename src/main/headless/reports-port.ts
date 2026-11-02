import { createNodemailerTransport } from '../email/smtp-client'
import type { Logger } from '../logging/logger'
import type { SecretStore } from '../secrets/secret-store'
import type { SummaryWriter } from '../email/types'
import type { DueReportDelivery } from './due-reports'

/**
 * SCH-1 and FR-23.12. The reports port `src/main/index.ts` passes into
 * `runCheckDueCommand` for `citefox --check-due`.
 * `secrets` is the process keychain store. `redacted` is copied and removed
 * from the report file and the send log (NFR-5). The SMTP client is the
 * production sender.
 */
export function createHeadlessReportsPort(input: {
  secrets: SecretStore
  logger: Logger
  redacted?: readonly string[]
  summaryWriter?: SummaryWriter
}): DueReportDelivery {
  return {
    secrets: input.secrets,
    transport: createNodemailerTransport(),
    logger: input.logger,
    ...(input.summaryWriter === undefined ? {} : { summaryWriter: input.summaryWriter }),
    ...(input.redacted === undefined ? {} : { redacted: [...input.redacted] })
  }
}
