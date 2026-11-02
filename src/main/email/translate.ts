import type { SmtpProvider } from '@shared/domain'
import { FIX_IN_EMAIL_SETUP } from './errors'
import type { SmtpFailureKind } from './transport'

const GMAIL_HOST = 'smtp.gmail.com'

/**
 * FR-23.4 and NFR-10. The Gmail 535 wording is the SRS example.
 * Other codes keep the numeric code and do not copy the server's free-form
 * text, because that text can echo the password (NFR-5).
 */
export function translateSmtpFailure(input: {
  kind: SmtpFailureKind
  smtpCode: number | null
  provider: SmtpProvider
  host: string
  port: number
}): { message: string; nextStep: string } {
  const nextStep = FIX_IN_EMAIL_SETUP
  if (input.kind === 'auth' && input.smtpCode === 535 && isGmail(input.provider, input.host)) {
    return { message: '535: Gmail needs an App Password', nextStep }
  }
  if (input.kind === 'auth') {
    const message =
      input.smtpCode === null
        ? 'Authentication failed.'
        : `Authentication failed (${input.smtpCode}).`
    return { message, nextStep }
  }
  if (input.kind === 'connection_refused') {
    return {
      message: `Could not connect to ${input.host}:${input.port}: connection refused.`,
      nextStep
    }
  }
  if (input.kind === 'timeout') {
    return { message: `${input.host} timed out.`, nextStep }
  }
  if (input.kind === 'rejected') {
    const message =
      input.smtpCode === null
        ? 'The SMTP server rejected the message.'
        : `The SMTP server rejected the message (${input.smtpCode}).`
    return { message, nextStep }
  }
  if (input.kind === 'insecure') {
    return {
      message: `CiteFox will not send the SMTP password unencrypted to ${input.host}. Choose STARTTLS or SSL/TLS.`,
      nextStep
    }
  }
  if (input.kind === 'unavailable') {
    return { message: 'SMTP transport not available yet', nextStep }
  }
  return { message: 'The SMTP send failed.', nextStep }
}

function isGmail(provider: SmtpProvider, host: string): boolean {
  return provider === 'gmail' || host.trim().toLowerCase() === GMAIL_HOST
}
