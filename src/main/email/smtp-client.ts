import { createTransport, type SendMailOptions } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import type { SmtpSecurity } from '@shared/domain'
import {
  SmtpTransportError,
  toSmtpError,
  type EmailAttachment,
  type OutboundEmail,
  type SmtpAuth,
  type SmtpFailureShape,
  type SmtpSendRequest,
  type SmtpTransport
} from './transport'

/**
 * The SRS does not set these durations. They were chosen by CEO ruling.
 * Shorter than nodemailer's defaults so a dead server cannot hold the queue.
 * DNS lookup stays at nodemailer's default; the SRS does not mention it.
 */
export const SMTP_CONNECTION_TIMEOUT_MS = 10_000
export const SMTP_GREETING_TIMEOUT_MS = 10_000
export const SMTP_SOCKET_TIMEOUT_MS = 20_000

/**
 * Extra trust anchors for this client only.
 * Certificate checks stay on. Omitting `ca` keeps Node's default store.
 * Passing `ca` replaces that store for the send (Node TLS). Production
 * passes none. The shared account has no CA field.
 */
export interface SmtpClientOptions {
  ca?: readonly string[]
  connectionTimeoutMs?: number
  greetingTimeoutMs?: number
  socketTimeoutMs?: number
}

/**
 * FR-23.1 SMTP send. One transporter per send, then closed.
 * The password is used only as nodemailer's auth secret and is not logged.
 */
export function createNodemailerTransport(options?: SmtpClientOptions): SmtpTransport {
  return {
    async send(request: SmtpSendRequest): Promise<void> {
      const secrets = credentialSecrets(request.auth)
      const plaintext = plaintextLoginProblem(request.auth)
      if (plaintext !== null) throw new SmtpTransportError(plaintext, 'insecure', null, secrets)
      const transporter = createTransport(smtpConnectionConfig(request.auth, options))
      try {
        await transporter.sendMail(mailOptions(request.message))
      } catch (error: unknown) {
        throw toSmtpError(forClassifier(error), secrets)
      } finally {
        transporter.close()
      }
    }
  }
}

const LOOPBACK_SMTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/**
 * `none` sends AUTH in cleartext. CiteFox refuses that unless the server is
 * on this computer (a local relay), so the SMTP password never crosses a
 * network unencrypted. Returns the reason, or null when the send may go ahead.
 */
export function plaintextLoginProblem(
  auth: Pick<SmtpAuth, 'host' | 'security' | 'password'>
): string | null {
  if (auth.security !== 'none' || auth.password.length === 0) return null
  if (LOOPBACK_SMTP_HOSTS.has(auth.host.trim().toLowerCase())) return null
  return `CiteFox will not send the SMTP password unencrypted to ${auth.host}. Choose STARTTLS or SSL/TLS in Email setup.`
}

/**
 * FR-23.3. `ssl` is implicit TLS. `starttls` requires the upgrade.
 * `none` stays plaintext (`ignoreTLS`), which is the insecure mode the
 * setup warning is about; with a password it is only used for a local
 * relay (see {@link plaintextLoginProblem}). The SRS does not say whether None may still
 * upgrade when the server offers STARTTLS.
 */
export function smtpConnectionConfig(
  auth: SmtpAuth,
  options?: SmtpClientOptions
): SMTPTransport.Options {
  const security = securityFlags(auth.security)
  const ca = (options?.ca ?? []).filter((pem) => pem.length > 0)
  return {
    host: auth.host,
    port: auth.port,
    secure: security.secure,
    requireTLS: security.requireTLS,
    ignoreTLS: security.ignoreTLS,
    auth: { user: auth.username, pass: auth.password },
    connectionTimeout: options?.connectionTimeoutMs ?? SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: options?.greetingTimeoutMs ?? SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: options?.socketTimeoutMs ?? SMTP_SOCKET_TIMEOUT_MS,
    logger: false,
    debug: false,
    transactionLog: false,
    tls: {
      rejectUnauthorized: true,
      // Plaintext (`none`) has no TLS handshake. STARTTLS and implicit TLS do.
      ...(auth.security === 'starttls' || auth.security === 'ssl'
        ? { minVersion: 'TLSv1.2' as const }
        : {}),
      ...(ca.length > 0 ? { ca: [...ca] } : {})
    }
  }
}

function securityFlags(security: SmtpSecurity): {
  secure: boolean
  requireTLS: boolean
  ignoreTLS: boolean
} {
  switch (security) {
    case 'ssl':
      return { secure: true, requireTLS: false, ignoreTLS: false }
    case 'starttls':
      return { secure: false, requireTLS: true, ignoreTLS: false }
    case 'none':
      return { secure: false, requireTLS: false, ignoreTLS: true }
    default: {
      const unexpected: never = security
      throw new SmtpTransportError(`Unknown SMTP security ${String(unexpected)}`, 'other', null)
    }
  }
}

function mailOptions(message: OutboundEmail): SendMailOptions {
  const mail: SendMailOptions = {
    from: { name: message.fromName, address: message.fromAddress },
    to: [...message.to],
    subject: message.subject,
    text: message.text
  }
  if (message.replyTo !== null) mail.replyTo = message.replyTo
  if (message.attachment !== null) mail.attachments = [attachment(message.attachment)]
  return mail
}

function attachment(file: EmailAttachment): NonNullable<SendMailOptions['attachments']>[number] {
  return {
    filename: file.filename,
    content: Buffer.from(file.bytes),
    contentType: file.contentType
  }
}

/**
 * Nodemailer wraps a refused socket as `ESOCKET` and keeps `ECONNREFUSED`
 * in the message. Greeting and socket timers use `ETIMEDOUT`.
 */
function forClassifier(error: unknown): unknown {
  if (error instanceof SmtpTransportError) return error
  const message = error instanceof Error ? error.message : 'SMTP send failed'
  const shaped = new Error(message)
  const code = normalizedCode(error, message)
  const responseCode = readResponseCode(error)
  if (code !== undefined) Object.assign(shaped, { code })
  if (responseCode !== null) Object.assign(shaped, { responseCode })
  return shaped
}

function normalizedCode(error: unknown, message: string): string | undefined {
  const code = readCode(error)
  if (message.includes('ECONNREFUSED') || readCode(causeOf(error)) === 'ECONNREFUSED') {
    return 'ECONNREFUSED'
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return code
  if (message.includes('Greeting never received') || message.includes('Connection timeout')) {
    return 'ETIMEDOUT'
  }
  return code
}

function causeOf(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return undefined
  return (error as { cause?: unknown }).cause
}

function readCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function readResponseCode(error: unknown): number | null {
  if (!isRecord(error)) return null
  return typeof error.responseCode === 'number' ? error.responseCode : null
}

function isRecord(error: unknown): error is SmtpFailureShape & Record<string, unknown> {
  return typeof error === 'object' && error !== null
}

/** Values that must not survive in a thrown message (NFR-5). */
function credentialSecrets(auth: SmtpAuth): string[] {
  const password = auth.password
  if (password.length === 0) return []
  const secrets = [
    password,
    Buffer.from(password).toString('base64'),
    Buffer.from(`\0${auth.username}\0${password}`).toString('base64'),
    Buffer.from(`${auth.username}\0${auth.username}\0${password}`).toString('base64')
  ]
  if (auth.username.length > 0) secrets.push(`${auth.username}:${password}`)
  return secrets
}
