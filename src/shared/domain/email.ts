/** Email sending accounts, SMTP presets, and alert settings. */

import { isOneOf } from './one-of'

/** FR-23.1. */
const EMAIL_MODES = ['smtp', 'mail_app'] as const

export type EmailMode = (typeof EMAIL_MODES)[number]

/** FR-23.2. `microsoft365` is the Outlook / Microsoft 365 preset. */
const SMTP_PROVIDERS = [
  'gmail',
  'microsoft365',
  'ses',
  'sendgrid',
  'mailgun',
  'resend',
  'postmark',
  'other'
] as const

export type SmtpProvider = (typeof SMTP_PROVIDERS)[number]

/** FR-23.3. `none` is allowed and the screen warns that the password is unencrypted. */
const SMTP_SECURITIES = ['starttls', 'ssl', 'none'] as const

export type SmtpSecurity = (typeof SMTP_SECURITIES)[number]

/**
 * FR-23.2. Host, port, and security the Email screen fills in for a provider.
 * `other` has an empty host. Amazon SES uses the us-east-1 host the mock-up fills;
 * the user can change the region in the host field.
 */
export interface SmtpPreset {
  provider: SmtpProvider
  host: string
  port: number
  security: SmtpSecurity
}

export const SMTP_PRESETS: readonly SmtpPreset[] = [
  { provider: 'gmail', host: 'smtp.gmail.com', port: 587, security: 'starttls' },
  { provider: 'microsoft365', host: 'smtp.office365.com', port: 587, security: 'starttls' },
  {
    provider: 'ses',
    host: 'email-smtp.us-east-1.amazonaws.com',
    port: 587,
    security: 'starttls'
  },
  { provider: 'sendgrid', host: 'smtp.sendgrid.net', port: 587, security: 'starttls' },
  { provider: 'mailgun', host: 'smtp.mailgun.org', port: 587, security: 'starttls' },
  { provider: 'resend', host: 'smtp.resend.com', port: 587, security: 'starttls' },
  { provider: 'postmark', host: 'smtp.postmarkapp.com', port: 587, security: 'starttls' },
  { provider: 'other', host: '', port: 587, security: 'starttls' }
]

/**
 * Section 10 `email_accounts` without the password (FR-23.3, FR-11.11).
 * `keychainRef` identifies the keychain item. The password is never a field here.
 */
export interface EmailAccount {
  id: string
  provider: SmtpProvider
  fromName: string
  fromAddress: string
  replyTo: string | null
  host: string
  port: number
  security: SmtpSecurity
  username: string
  keychainRef: string
  isDefault: boolean
  /** ISO-8601 UTC. Null until the first test. */
  lastTestAt: string | null
  lastTestOk: boolean | null
  /** NFR-10. Null when the last test succeeded or none has run. */
  lastTestMessage: string | null
  lastTestNextStep: string | null
  /**
   * Where this account is used, filled in when the account is read (FR-23.5).
   * A project entry is `projectId` and the project name.
   * A live schedule entry adds `scheduleId` and uses the schedule name.
   * `projectId` is null for an all-projects schedule. Empty when nothing uses the account.
   */
  usedFor: readonly EmailAccountUse[]
}

/** One project or live report schedule that sends through an {@link EmailAccount}. */
export interface EmailAccountUse {
  projectId: string | null
  /** Set for a report schedule. Absent for a project alert. */
  scheduleId?: string
  label: string
}

/** FR-23.1 and FR-23.5. */
export interface EmailSettings {
  mode: EmailMode
  accounts: readonly EmailAccount[]
}

/** FR-23.4. No password. */
export interface EmailTestResult {
  ok: boolean
  host: string
  /** ISO-8601 UTC. */
  testedAt: string
  message: string
  nextStep: string | null
}

/**
 * FR-23.13 and FR-24.7, for one project.
 * The Slack URL is not here. `slackWebhookStored` says whether one is in the keychain (NFR-5).
 */
export interface AlertSettings {
  projectId: string
  desktop: boolean
  emailAfterCheck: boolean
  /** Null uses the default sending account. */
  emailAccountId: string | null
  emailTo: readonly string[]
  slackEnabled: boolean
  slackWebhookStored: boolean
  /** Monthly client PDF on the 1st (FR-23.13). */
  monthlyClientPdf: boolean
  /**
   * Recipient for that monthly PDF (FR-23.13).
   * Null, or one address. Not a comma-separated list.
   */
  monthlyPdfTo: string | null
}

export function isEmailMode(value: string): value is EmailMode {
  return isOneOf(EMAIL_MODES, value)
}

export function isSmtpProvider(value: string): value is SmtpProvider {
  return isOneOf(SMTP_PROVIDERS, value)
}

export function isSmtpSecurity(value: string): value is SmtpSecurity {
  return isOneOf(SMTP_SECURITIES, value)
}
