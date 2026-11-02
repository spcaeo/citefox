import { SMTP_PRESETS } from '@shared/domain'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { DELIVERABILITY_TIPS, FIX_IN_EMAIL_SETUP, smtpPreset } from './index'
import { classifySmtpFailure, SmtpTransportError } from './transport'
import { PASSWORD, accountBody, emailHarness } from './harness'

describe('SMTP transport classification', () => {
  test('maps auth, connection refused, and timeout without a socket', () => {
    expect(classifySmtpFailure({ code: 'EAUTH', responseCode: 535 })).toEqual({
      kind: 'auth',
      smtpCode: 535
    })
    expect(classifySmtpFailure({ responseCode: 535 })).toEqual({ kind: 'auth', smtpCode: 535 })
    expect(classifySmtpFailure({ code: 'ECONNREFUSED' })).toEqual({
      kind: 'connection_refused',
      smtpCode: null
    })
    expect(classifySmtpFailure({ code: 'ETIMEDOUT' })).toEqual({ kind: 'timeout', smtpCode: null })
    expect(classifySmtpFailure({ code: 'ESOCKETTIMEDOUT' })).toEqual({
      kind: 'timeout',
      smtpCode: null
    })
  })

  test('the SMTP client is nodemailer and email sources do not open a raw socket', () => {
    const dir = resolve('src/main/email')
    const rawSockets = ['node:net', 'node:tls', 'node:dns', 'node:dgram']
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.test-helper.ts')) {
        continue
      }
      const source = readFileSync(resolve(dir, file), 'utf8')
      for (const token of rawSockets) {
        expect(source.includes(`'${token}'`) || source.includes(`"${token}"`), file).toBe(false)
      }
      if (file !== 'smtp-client.ts') {
        expect(source.includes("'nodemailer'") || source.includes('"nodemailer"'), file).toBe(false)
      }
    }
    const client = readFileSync(resolve(dir, 'smtp-client.ts'), 'utf8')
    expect(client.includes("from 'nodemailer'")).toBe(true)
    expect(client.includes('rejectUnauthorized: false')).toBe(false)
  })
})

describe('SMTP accounts', () => {
  test('starts in smtp mode and stores the password only in the keychain', () => {
    const { service, secrets } = emailHarness()
    expect(service.getSettings().mode).toBe('smtp')
    const saved = service.saveAccount(accountBody({ isDefault: false, security: 'none' }))
    expect(saved.isDefault).toBe(true)
    expect(saved.security).toBe('none')
    expect(saved.keychainRef.startsWith('citefox.smtp.')).toBe(true)
    expect(secrets.get(saved.keychainRef)).toBe(PASSWORD)
    expect(JSON.stringify(service.getSettings())).not.toContain(PASSWORD)
    expect(Object.hasOwn(saved, 'password')).toBe(false)
    expect(saved.lastTestAt).toBeNull()
  })

  test('keeps one default and promotes the earliest account when the default is removed', () => {
    const { service, secrets } = emailHarness()
    const first = service.saveAccount(accountBody({ fromAddress: 'a@example.com', username: 'a' }))
    const second = service.saveAccount(
      accountBody({
        fromAddress: 'b@example.com',
        username: 'b',
        isDefault: false,
        password: 'second-secret'
      })
    )
    const third = service.saveAccount(
      accountBody({
        fromAddress: 'c@example.com',
        username: 'c',
        isDefault: true,
        password: 'third-secret'
      })
    )
    expect(service.getSettings().accounts.map((account) => account.isDefault)).toEqual([
      false,
      false,
      true
    ])
    service.removeAccount({ id: third.id })
    expect(secrets.get(third.keychainRef)).toBeNull()
    const remaining = service.getSettings().accounts
    expect(remaining.map((account) => account.id)).toEqual([first.id, second.id])
    expect(remaining.map((account) => account.isDefault)).toEqual([true, false])
  })

  test('an update with a null password keeps the stored secret', () => {
    const { service, secrets } = emailHarness()
    const saved = service.saveAccount(accountBody())
    const updated = service.saveAccount({
      ...accountBody({ id: saved.id, password: null }),
      id: saved.id
    })
    expect(secrets.get(updated.keychainRef)).toBe(PASSWORD)
    expect(updated.keychainRef).toBe(saved.keychainRef)
    service.saveAccount({
      ...accountBody({ id: saved.id, host: 'smtp.other.example' }),
      id: saved.id,
      password: 'replaced-secret'
    })
    expect(secrets.get(saved.keychainRef)).toBe('replaced-secret')
  })

  test('rejects a create without a password, a bad mode, and header breaks', () => {
    const { service } = emailHarness()
    expect(() => service.saveAccount(accountBody({ password: null }))).toThrow('Invalid request')
    expect(service.getSettings().accounts).toHaveLength(0)
    expect(() => service.setMode({ mode: 'pop3' })).toThrow('Invalid request')
    expect(service.getSettings().mode).toBe('smtp')
    expect(() => service.saveAccount(accountBody({ fromName: 'Bad\nName' }))).toThrow(
      'Invalid request'
    )
    service.setMode({ mode: 'mail_app' })
    expect(service.getSettings().mode).toBe('mail_app')
  })

  test('FR-23.2 presets fill host, port, and security', () => {
    expect(SMTP_PRESETS.map((preset) => smtpPreset(preset.provider))).toEqual([...SMTP_PRESETS])
    expect(smtpPreset('gmail')).toMatchObject({
      host: 'smtp.gmail.com',
      port: 587,
      security: 'starttls'
    })
    expect(DELIVERABILITY_TIPS).toEqual([
      'Send from the own domain.',
      'SPF, DKIM, DMARC.',
      'Attach the HTML report (.zip) instead of a PDF over 10 MB.'
    ])
  })

  test('a successful test reports the server and time and does not open a draft', async () => {
    const { service, ports } = emailHarness()
    const saved = service.saveAccount(accountBody())
    service.setMode({ mode: 'mail_app' })
    const result = await service.testAccount({ id: saved.id })
    expect(result).toEqual({
      ok: true,
      host: 'smtp.example.com',
      testedAt: '2026-02-04T12:00:00.000Z',
      message: 'Test sent through smtp.example.com at 2026-02-04T12:00:00.000Z.',
      nextStep: null
    })
    expect(ports.transport.attempts).toBe(1)
    expect(ports.transport.sent[0]?.auth.password).toBe(PASSWORD)
    expect(ports.transport.sent[0]?.message.to).toEqual(['reports@example.com'])
    expect(ports.drafts.drafts).toHaveLength(0)
    const stored = service.getSettings().accounts[0]
    expect(stored?.lastTestOk).toBe(true)
    expect(stored?.lastTestMessage).toBeNull()
    expect(stored?.lastTestAt).toBe(result.testedAt)
  })

  test('email:test sends to `to` when it is one address, and keeps the from address otherwise', async () => {
    const { service, ports } = emailHarness()
    const saved = service.saveAccount(accountBody())
    const directed = await service.testAccount({ id: saved.id, to: 'ada@example.com' })
    expect(directed.ok).toBe(true)
    expect(ports.transport.sent[0]?.message.to).toEqual(['ada@example.com'])

    const omitted = await service.testAccount({ id: saved.id })
    expect(omitted.ok).toBe(true)
    expect(ports.transport.sent[1]?.message.to).toEqual(['reports@example.com'])
    expect(ports.transport.attempts).toBe(2)

    await expect(service.testAccount({ id: saved.id, to: 'not-an-email' })).rejects.toThrow(
      'Invalid request'
    )
    await expect(
      service.testAccount({ id: saved.id, to: 'ada@example.com,bea@example.com' })
    ).rejects.toThrow('Invalid request')
    expect(ports.transport.attempts).toBe(2)
    expect(ports.transport.sent).toHaveLength(2)
  })

  test('FR-23.4 translates Gmail 535 and does not retry auth', async () => {
    const { service, ports, waits } = emailHarness()
    const saved = service.saveAccount(
      accountBody({ provider: 'gmail', host: 'smtp.gmail.com', username: 'ada@gmail.com' })
    )
    ports.transport.failure = new SmtpTransportError(
      `535 5.7.8 Username and Password not accepted ${PASSWORD}`,
      'auth',
      535
    )
    const result = await service.testAccount({ id: saved.id })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('535: Gmail needs an App Password')
    expect(result.nextStep).toBe(FIX_IN_EMAIL_SETUP)
    expect(result.message).not.toContain(PASSWORD)
    expect(ports.transport.attempts).toBe(1)
    expect(waits).toEqual([])
    expect(service.getSettings().accounts[0]?.lastTestOk).toBe(false)
    expect(service.getSettings().accounts[0]?.lastTestMessage).toBe(result.message)
  })

  test('connection refused retries three times', async () => {
    const { service, ports, waits } = emailHarness()
    const saved = service.saveAccount(accountBody())
    ports.transport.failure = new SmtpTransportError(
      'connect ECONNREFUSED',
      'connection_refused',
      null
    )
    const result = await service.testAccount({ id: saved.id })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('Could not connect to smtp.example.com:587: connection refused.')
    expect(result.nextStep).toBe(FIX_IN_EMAIL_SETUP)
    expect(ports.transport.attempts).toBe(3)
    expect(waits).toEqual([200, 400])
    expect(ports.transport.sent).toHaveLength(0)
  })

  test('timeout retries three times and a later attempt can succeed', async () => {
    const { service, ports, waits } = emailHarness()
    const saved = service.saveAccount(accountBody())
    ports.transport.failure = new SmtpTransportError('socket timed out', 'timeout', null)
    const failed = await service.testAccount({ id: saved.id })
    expect(failed.message).toBe('smtp.example.com timed out.')
    expect(ports.transport.attempts).toBe(3)
    expect(waits).toEqual([200, 400])

    ports.transport.attempts = 0
    ports.transport.failNext = 2
    waits.length = 0
    const ok = await service.testAccount({ id: saved.id })
    expect(ok.ok).toBe(true)
    expect(ports.transport.attempts).toBe(3)
    expect(ports.transport.sent).toHaveLength(1)
    expect(waits).toEqual([200, 400])
  })

  test('a missing keychain password does not call SMTP', async () => {
    const { service, ports, secrets } = emailHarness()
    const saved = service.saveAccount(accountBody())
    secrets.delete(saved.keychainRef)
    const result = await service.testAccount({ id: saved.id })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('The SMTP password is missing from the keychain.')
    expect(result.nextStep).toBe(FIX_IN_EMAIL_SETUP)
    expect(ports.transport.attempts).toBe(0)
  })
})
