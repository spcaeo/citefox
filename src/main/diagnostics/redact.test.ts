import { describe, expect, it } from 'vitest'
import { fileNameOnly, redactReport } from './redact'

const HOME = '/Users/jane.doe'

/** Joins pieces at run time, so no key-shaped text sits in this file for a secret scanner to flag. */
const join = (...parts: string[]): string => parts.join('')

function none(text: string, ...secrets: string[]): void {
  const out = redactReport(text, { home: HOME })
  for (const secret of secrets) expect(out).not.toContain(secret)
}

describe('redactReport: keys and tokens', () => {
  it('hides every key shape, even glued to other text', () => {
    const keys = [
      'sk-ant-api03-ABCDEFGHIJKLMNOP1234',
      'sk-proj-abcdefghijklmnop1234567890',
      join('sk_', 'live_', '51HabcdefGHIJKL'),
      join('rk_', 'test_', '51HabcdefGHIJKL'),
      join('AI', 'zaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'),
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz',
      'xoxb-1234567890-abcdefghij',
      'AKIAIOSFODNN7EXAMPLE',
      join(
        'ey',
        'JhbGciOiJIUzI1NiJ9.',
        'ey',
        'JzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
      )
    ]
    for (const key of keys) {
      none(`request failed key=${key}`, key)
      none(`${key}`, key)
      none(`prefix${key}suffix`, key)
      none(`"x":"${key}"`, key)
    }
  })

  it('hides Bearer tokens, api_key parameters and named secrets, keeping the name', () => {
    const out = redactReport(
      [
        'Authorization: Bearer abc.DEF-ghi_123',
        'GET https://x.test/a?api_key=hunter2hunter2&b=1',
        'token=plainvalue99',
        '{"password":"correct horse"}',
        'X-Api-Key: zzzz1234',
        'smtp_password = swordfish'
      ].join('\n'),
      { home: HOME }
    )
    for (const secret of [
      'abc.DEF-ghi_123',
      'hunter2hunter2',
      'plainvalue99',
      'correct horse',
      'zzzz1234',
      'swordfish'
    ]) {
      expect(out).not.toContain(secret)
    }
    expect(out).toContain('token=[REDACTED]')
    expect(out).toContain('b=1')
  })

  it('hides long hex and base64 secrets but not a plain word or a UUID', () => {
    const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4'
    const b64 = 'Zm9vYmFyQkFaMTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3A='
    none(`id ${hex}`, hex)
    none(`blob ${b64}`, b64)
    const calm = 'The quick brown fox, 3f2b8c1e-9d4a-4f6b-8a1c-0e5d7b9c2a41, version 0.13.2'
    expect(redactReport(calm, { home: HOME })).toBe(calm)
  })

  it('removes the exact keys CiteFox holds, even short or odd ones', () => {
    const out = redactReport('using abc123 and Pa$$w0rd! then ABC123', {
      secrets: ['abc123', 'Pa$$w0rd!'],
      home: HOME
    })
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('Pa$$w0rd!')
    expect(out).toContain('ABC123')
  })

  it('hides a private key block', () => {
    const out = redactReport(
      join(
        'a\n-----BEGIN ',
        'PRIVATE KEY-----\nMIIEvQIBADANBgkq\n-----END ',
        'PRIVATE KEY-----\nb'
      ),
      {}
    )
    expect(out).not.toContain('MIIEvQ')
    expect(out).toContain('a\n')
    expect(out).toContain('\nb')
  })
})

describe('redactReport: emails, the home folder and IP addresses', () => {
  it('hides email addresses in any place', () => {
    const out = redactReport(
      'from jane.doe+tag@Example.co.uk, "a_b@sub.domain.io" and mailto:x@y.zz?subject=1',
      {}
    )
    expect(out).not.toMatch(/@[a-z]/i)
    expect(out).toContain('[email]')
  })

  it('turns the home folder into ~ in every spelling, and any other user home too', () => {
    const out = redactReport(
      [
        '/Users/jane.doe/Library/Logs/x.log',
        'file:///Users/jane.doe/a%20b',
        'C:\\Users\\jane.doe\\AppData\\Roaming\\CiteFox',
        '/home/someone-else/.config/citefox',
        '/Users/JANE.DOE/Desktop'
      ].join('\n'),
      { home: '/Users/jane.doe' }
    )
    expect(out).not.toMatch(/jane\.doe/i)
    expect(out).not.toContain('someone-else')
    expect(out).toContain('~/Library/Logs/x.log')
    expect(out).toContain('~\\AppData\\Roaming\\CiteFox')
  })

  it('also hides a Windows home folder given with backslashes', () => {
    const out = redactReport('C:\\Users\\Ann Lee\\Documents and c:/users/ann lee/x', {
      home: 'C:\\Users\\Ann Lee'
    })
    expect(out).not.toMatch(/ann lee/i)
  })

  it('hides IPv4 and IPv6 addresses, not versions, times or app words', () => {
    const out = redactReport(
      [
        'peer 192.168.1.20 and 10.0.0.1:8080, 255.255.255.255',
        'v6 2001:db8::ff00:42:8329 and ::1 and fe80::1ff:fe23:4567:890a',
        'mac aa:bb:cc:dd:ee:ff'
      ].join('\n'),
      {}
    )
    expect(out).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
    expect(out).not.toContain('2001:db8')
    expect(out).not.toContain('fe80')
    expect(out).not.toContain('aa:bb')
    expect(out).toContain('[ip]:8080')
    const calm =
      'Chromium 142.0.7444.175, Electron 39.2.7, 2026-11-03T08:49:12.123Z, 1.2.3.4.5, std::vector'
    expect(redactReport(calm, {})).toBe(calm)
  })
})

describe('redactReport: hostile input', () => {
  it('survives huge and strange text quickly', () => {
    const started = Date.now()
    const nasty = [
      'a'.repeat(200_000),
      '1.'.repeat(50_000),
      ':'.repeat(50_000),
      '@'.repeat(50_000),
      'Aa1'.repeat(50_000),
      '\u0000\u202e\ud800 mixed'
    ].join('\n')
    expect(typeof redactReport(nasty, { home: HOME, secrets: ['x'] })).toBe('string')
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('is stable: redacting twice changes nothing more', () => {
    const text = 'k=sk-ant-api03-ABCDEFGHIJKLMNOP1234 jane@x.io /Users/jane.doe/a 10.1.2.3'
    const once = redactReport(text, { home: HOME })
    expect(redactReport(once, { home: HOME })).toBe(once)
  })

  it('does not let a secret hide behind a home path or a split line', () => {
    const secret = 'sk-live-ABCDEFGHIJKLMNOPQRSTUV'
    const out = redactReport(`${HOME}/${secret}\n${secret}`, { home: HOME, secrets: [secret] })
    expect(out).not.toContain('ABCDEFGHIJKLMNOP')
  })
})

describe('fileNameOnly', () => {
  it('keeps only the file name', () => {
    expect(fileNameOnly('/Users/jane/.local/bin/claude')).toBe('claude')
    expect(fileNameOnly('C:\\Program Files\\Claude\\claude.exe')).toBe('claude.exe')
    expect(fileNameOnly(null)).toBeNull()
    expect(fileNameOnly('')).toBeNull()
  })
})
