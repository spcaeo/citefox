import { describe, expect, test } from 'vitest'
import { accountBody, emailHarness } from './harness'
import { maskEmailAddresses } from './service/support'
import { SmtpTransportError } from './transport'

describe('a failed email send leaves one log line with a short reason', () => {
  test('the line has the kind and the code, and the server answer holds no address', async () => {
    const { service, ports, lines } = emailHarness()
    const saved = service.saveAccount(accountBody())
    ports.transport.failure = new SmtpTransportError(
      '550 5.1.1 <jane.doe@customer-example.com> Recipient address rejected',
      'rejected',
      550
    )
    await service.testAccount({ id: saved.id })
    const line = lines.find((entry) => entry.includes('SMTP send failed'))
    expect(line).toContain('"smtpCode":550')
    expect(line).toContain('"kind"')
    expect(lines.join('\n')).not.toContain('jane.doe@customer-example.com')
    expect(line).toContain('[email]')
  })
})

describe('maskEmailAddresses', () => {
  test('replaces addresses in nested values and leaves other text alone', () => {
    expect(
      maskEmailAddresses({ detail: 'refused <a.b+c@mail.example.org>', list: ['x@y.io', 'plain'] })
    ).toEqual({ detail: 'refused <[email]>', list: ['[email]', 'plain'] })
  })

  test('returns values without an @ unchanged', () => {
    const value = { count: 2 }
    expect(maskEmailAddresses(value)).toBe(value)
    expect(maskEmailAddresses(undefined)).toBeUndefined()
  })
})
