import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SMTPServer, type SMTPServerDataStream, type SMTPServerSession } from 'smtp-server'

/**
 * Test-only SMTP peer and the self-signed certificate it presents.
 * The key is generated at runtime and is not a product secret.
 * Production email code does not import this module.
 */

export interface CapturedMail {
  secure: boolean
  raw: string
}

export interface SmtpTestServer {
  port: number
  mails: CapturedMail[]
  authAttempts: number
  accepted: number
  close(): Promise<void>
}

export type SmtpTestMode = 'starttls' | 'ssl' | 'none' | 'starttls-offered'

export interface SmtpTestServerOptions {
  mode: SmtpTestMode
  certPem?: string
  keyPem?: string
  username: string
  password: string
  /** Put the rejected password in the 535 text so a test can prove redaction. */
  echoPasswordOnReject?: boolean
}

export interface SelfSignedFixture {
  certPem: string
  keyPem: string
}

let cachedFixture: SelfSignedFixture | undefined

/** Clearly named test fixture. Generated locally; nothing is committed. */
export function citefoxSmtpTestSelfSigned(): SelfSignedFixture {
  if (cachedFixture !== undefined) return cachedFixture
  const dir = mkdtempSync(join(tmpdir(), 'citefox-smtp-test-self-signed-'))
  const keyPath = join(dir, 'citefox-smtp-test-self-signed.key')
  const certPath = join(dir, 'citefox-smtp-test-self-signed.crt')
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-days',
        '2',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-addext',
        'basicConstraints=critical,CA:TRUE',
        '-addext',
        'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
        '-addext',
        'extendedKeyUsage=serverAuth'
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    cachedFixture = {
      certPem: readFileSync(certPath, 'utf8'),
      keyPem: readFileSync(keyPath, 'utf8')
    }
    return cachedFixture
  } catch (error: unknown) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr)
        : ''
    throw new Error(`could not generate the SMTP test certificate: ${stderr}`, { cause: error })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function startSmtpTestServer(options: SmtpTestServerOptions): Promise<SmtpTestServer> {
  const mails: CapturedMail[] = []
  const counts = { authAttempts: 0, accepted: 0 }
  const tls =
    options.mode === 'none'
      ? {}
      : {
          key: options.keyPem,
          cert: options.certPem
        }
  const server = new SMTPServer({
    ...tls,
    logger: false,
    secure: options.mode === 'ssl',
    hideSTARTTLS: options.mode === 'none',
    disabledCommands: options.mode === 'none' ? ['STARTTLS'] : [],
    allowInsecureAuth: options.mode === 'none' || options.mode === 'starttls-offered',
    disableReverseLookup: true,
    authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, _session, callback) {
      counts.authAttempts += 1
      const password = typeof auth.password === 'string' ? auth.password : ''
      if (auth.username === options.username && password === options.password) {
        counts.accepted += 1
        callback(null, { user: auth.username })
        return
      }
      const rejected = new Error(
        options.echoPasswordOnReject === true ? `rejected ${password}` : 'rejected'
      )
      Object.assign(rejected, { responseCode: 535 })
      callback(rejected)
    },
    onData(stream, session, callback) {
      capture(stream, session, mails, callback)
    }
  })
  await listen(server)
  return {
    port: boundPort(server),
    mails,
    get authAttempts() {
      return counts.authAttempts
    },
    get accepted() {
      return counts.accepted
    },
    close: () => closeServer(server)
  }
}

/** Accepts the TCP connection and never sends an SMTP greeting. */
export async function startSilentLocalServer(): Promise<{
  port: number
  close(): Promise<void>
}> {
  const sockets = new Set<Socket>()
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.on('error', () => undefined)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('silent SMTP peer did not bind a TCP port')
  }
  return {
    port: address.port,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  }
}

export async function closedLocalPort(): Promise<number> {
  const silent = await startSilentLocalServer()
  const port = silent.port
  await silent.close()
  return port
}

function capture(
  stream: SMTPServerDataStream,
  session: SMTPServerSession,
  mails: CapturedMail[],
  callback: (err: Error | null | undefined) => void
): void {
  const chunks: Buffer[] = []
  let settled = false
  const finish = (error?: Error): void => {
    if (settled) return
    settled = true
    if (error !== undefined) {
      callback(error)
      return
    }
    mails.push({ secure: session.secure, raw: Buffer.concat(chunks).toString('utf8') })
    callback(null)
  }
  stream.on('data', (chunk: Buffer | string) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  })
  stream.on('error', () => {
    finish(new Error('message stream failed'))
  })
  stream.on('end', () => {
    finish()
  })
}

function listen(server: SMTPServer): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const onListenError = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    server.on('error', onListenError)
    server.listen(0, '127.0.0.1', () => {
      settled = true
      server.off('error', onListenError)
      // A client that rejects the certificate closes during the handshake.
      // smtp-server emits that as an 'error'. Without a listener Node throws it.
      server.on('error', () => undefined)
      resolve()
    })
  })
}

function boundPort(server: SMTPServer): number {
  const address = server.server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('SMTP test server did not bind a TCP port')
  }
  return address.port
}

function closeServer(server: SMTPServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}
