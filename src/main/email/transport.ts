import type { SmtpSecurity } from '@shared/domain'
import { redactString } from '../logging/redact'
import { RETRY_ATTEMPTS, runAttempts } from '../providers/retry'

/**
 * SMTP failure kinds the sender translates (FR-23.4, NFR-10).
 * `auth`, `connection_refused`, and `timeout` are the required failure paths.
 */
export type SmtpFailureKind =
  'auth' | 'connection_refused' | 'timeout' | 'rejected' | 'unavailable' | 'insecure' | 'other'

/**
 * A transport failure. `message` must already be safe to log.
 * The password is never a field here.
 */
export class SmtpTransportError extends Error {
  readonly kind: SmtpFailureKind
  readonly smtpCode: number | null

  constructor(
    message: string,
    kind: SmtpFailureKind,
    smtpCode: number | null,
    secrets?: readonly string[]
  ) {
    super(redactString(message, { secrets }))
    this.name = 'SmtpTransportError'
    this.kind = kind
    this.smtpCode = smtpCode
  }
}

export interface SmtpAuth {
  host: string
  port: number
  security: SmtpSecurity
  username: string
  password: string
}

export interface EmailAttachment {
  filename: string
  contentType: string
  bytes: Uint8Array
}

/** One message. The transport is the only place the password is used. */
export interface OutboundEmail {
  fromName: string
  fromAddress: string
  replyTo: string | null
  to: readonly string[]
  subject: string
  text: string
  attachment: EmailAttachment | null
}

export interface SmtpSendRequest {
  auth: SmtpAuth
  message: OutboundEmail
}

/**
 * FR-23.1 SMTP send. Implementations perform the socket work.
 * Tests use {@link MemorySmtpTransport}. This module does not open a socket.
 */
export interface SmtpTransport {
  send(request: SmtpSendRequest): Promise<void>
}

/**
 * Fail-closed stand-in. Production uses createNodemailerTransport.
 * A test that wants a refusal without a socket can still pass this.
 */
export function unconfiguredSmtpTransport(): SmtpTransport {
  return {
    async send(): Promise<void> {
      throw new SmtpTransportError('SMTP transport not available yet', 'unavailable', null)
    }
  }
}

/**
 * Node and SMTP shapes a real client would see.
 * 535 is the auth code in the FR-23.4 example. EAUTH is Node's auth failure.
 * ECONNREFUSED and ETIMEDOUT / ESOCKETTIMEDOUT are the other required paths.
 */
export interface SmtpFailureShape {
  code?: string
  responseCode?: number
  message?: string
}

export function classifySmtpFailure(failure: SmtpFailureShape): {
  kind: SmtpFailureKind
  smtpCode: number | null
} {
  const code = failure.code ?? ''
  const smtpCode = typeof failure.responseCode === 'number' ? failure.responseCode : null
  if (code === 'EAUTH' || code === 'EAUTHENTICATION' || smtpCode === 535) {
    return { kind: 'auth', smtpCode }
  }
  if (code === 'ECONNREFUSED') return { kind: 'connection_refused', smtpCode }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return { kind: 'timeout', smtpCode }
  if (smtpCode !== null && smtpCode >= 400) return { kind: 'rejected', smtpCode }
  return { kind: 'other', smtpCode }
}

export function toSmtpError(error: unknown, secrets: readonly string[]): SmtpTransportError {
  if (error instanceof SmtpTransportError) {
    return new SmtpTransportError(error.message, error.kind, error.smtpCode, secrets)
  }
  const message = error instanceof Error ? error.message : 'SMTP send failed'
  const shape = smtpShape(error)
  const classified = classifySmtpFailure({ ...shape, message })
  return new SmtpTransportError(message, classified.kind, classified.smtpCode, secrets)
}

/**
 * NFR-2. Connection refused and timeout retry with exponential backoff, 3 attempts.
 * Auth and other definitive SMTP answers do not retry: repeating a rejected
 * password is not a transient failure. That reading is an open question.
 */
export async function sendWithRetry(
  transport: SmtpTransport,
  request: SmtpSendRequest,
  options: { sleep?: (ms: number) => Promise<void>; secrets: readonly string[] }
): Promise<void> {
  await runAttempts(
    async (attempt) => {
      try {
        await transport.send(request)
        return { done: true, value: undefined }
      } catch (error: unknown) {
        const smtp = toSmtpError(error, options.secrets)
        const transient = smtp.kind === 'connection_refused' || smtp.kind === 'timeout'
        if (!transient || attempt === RETRY_ATTEMPTS) throw smtp
        return { done: false, value: undefined }
      }
    },
    { sleep: options.sleep }
  )
}

/**
 * In-memory SMTP double. `failure` is thrown while `failNext` is null or above 0.
 * Set `failNext` to fail that many attempts and then succeed.
 * The recorded request includes the password so a test can see it was passed
 * only to the transport. Nothing here writes a log.
 */
export class MemorySmtpTransport implements SmtpTransport {
  readonly sent: SmtpSendRequest[] = []
  attempts = 0
  failure: SmtpTransportError | null = null
  failNext: number | null = null

  async send(request: SmtpSendRequest): Promise<void> {
    this.attempts += 1
    if (this.failure !== null && (this.failNext === null || this.failNext > 0)) {
      if (this.failNext !== null) this.failNext -= 1
      throw this.failure
    }
    this.sent.push(copyRequest(request))
  }
}

function copyRequest(request: SmtpSendRequest): SmtpSendRequest {
  return {
    auth: { ...request.auth },
    message: {
      ...request.message,
      to: [...request.message.to],
      attachment: request.message.attachment
    }
  }
}

function smtpShape(error: unknown): SmtpFailureShape {
  if (typeof error !== 'object' || error === null) return {}
  const record = error as { code?: unknown; responseCode?: unknown }
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    responseCode: typeof record.responseCode === 'number' ? record.responseCode : undefined
  }
}
