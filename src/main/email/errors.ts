import { redactString } from '../logging/redact'

/** FR-23.11. Delivery history points a failed send at Email setup. */
export const FIX_IN_EMAIL_SETUP = 'Fix in Email setup'

export type EmailErrorCode = 'invalid' | 'not_found'

/**
 * A rejected email operation. The message is already redacted (NFR-5).
 * SMTP failures are delivery results, not this error (FR-23.4).
 */
export class EmailError extends Error {
  readonly code: EmailErrorCode

  constructor(message: string, code: EmailErrorCode, secrets?: readonly string[]) {
    super(redactString(message, { secrets }))
    this.name = 'EmailError'
    this.code = code
  }
}
