import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_TOKEN } from './endpoint'
import { loadScript } from './apps-script.test-helper'

const TOKEN = DEFAULT_APP_TOKEN

function register(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'register',
    token: TOKEN,
    installId: 'install-aaaa-1111',
    name: 'Ana Ruiz',
    email: 'Ana@Agency.com',
    company: 'Agency Co',
    role: 'agency',
    productUpdates: true,
    news: false,
    version: '0.12.0',
    build: 1424,
    os: 'darwin',
    arch: 'arm64',
    ...over
  }
}

describe('the Apps Script backend (server/apps-script/Code.gs)', () => {
  it('saves a registration once per install and updates it on a second send', () => {
    const world = loadScript()
    world.fn.setup()
    expect(world.post(register())).toEqual({ ok: true })
    expect(world.post(register({ name: 'Ana R', news: true }))).toEqual({ ok: true })
    const users = world.rows('Users')
    expect(users).toHaveLength(1)
    expect(users[0]?.slice(0, 7)).toEqual([
      'install-aaaa-1111',
      'ana@agency.com',
      'Ana R',
      'Agency Co',
      'agency',
      true,
      true
    ])
  })

  it('refuses a wrong token, bad input and unknown kinds', () => {
    const world = loadScript()
    world.fn.setup()
    expect(world.post(register({ token: 'nope' }))).toEqual({ ok: false, error: 'token' })
    expect(world.post(register({ email: 'not-an-email' }))).toEqual({ ok: false, error: 'invalid' })
    expect(world.post(register({ role: 'boss' }))).toEqual({ ok: false, error: 'invalid' })
    expect(world.post(register({ installId: 'x' }))).toEqual({ ok: false, error: 'invalid' })
    expect(world.post({ kind: 'drop', token: TOKEN })).toEqual({ ok: false, error: 'invalid' })
    const raw = world.fn.doPost({ postData: { contents: 'not json' } }) as { text: string }
    expect(JSON.parse(raw.text)).toEqual({ ok: false, error: 'invalid' })
    expect(world.rows('Users')).toHaveLength(0)
  })

  it('keeps formulas out of the sheet', () => {
    const world = loadScript()
    world.fn.setup()
    world.post(register({ name: '=HYPERLINK("x")', company: '+cmd' }))
    const row = world.rows('Users')[0]
    expect(row?.[2]).toBe(`'=HYPERLINK("x")`)
    expect(row?.[3]).toBe(`'+cmd`)
  })

  it('rate-limits one install', () => {
    const world = loadScript()
    world.fn.setup()
    const replies = Array.from({ length: 6 }, () => world.post(register()))
    expect(replies.slice(0, 5).every((r) => r.ok)).toBe(true)
    expect(replies[5]).toEqual({ ok: false, error: 'rate' })
  })

  it('records pings per install and counts active installs over 7 and 30 days', () => {
    const world = loadScript()
    world.fn.setup()
    const ping = {
      kind: 'ping',
      token: TOKEN,
      version: '0.12.0',
      build: 1,
      os: 'linux',
      arch: 'x64'
    }
    expect(world.post({ ...ping, installId: 'install-one-0001' })).toEqual({ ok: true })
    expect(world.post({ ...ping, installId: 'install-two-0002' })).toEqual({ ok: true })
    expect(world.post({ ...ping, installId: 'install-one-0001' })).toEqual({ ok: true })
    const installs = world.rows('Installs')
    expect(installs).toHaveLength(2)
    // Age the second install by 10 days.
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString()
    ;(installs[1] as unknown[])[2] = tenDaysAgo
    expect(world.fn.activeInstalls(new Date())).toEqual({ last7: 1, last30: 2, total: 2 })
  })

  it('emails opted-in people once per campaign, within the daily quota, with an unsubscribe link', () => {
    const world = loadScript()
    world.fn.setup()
    world.post(register())
    world.post(
      register({ installId: 'install-bbbb-2222', email: 'bo@x.com', productUpdates: false })
    )
    world.post(register({ installId: 'install-cccc-3333', email: 'cy@y.com', name: 'Cy' }))
    world.post(register({ installId: 'install-dddd-4444', email: 'ana@agency.com' }))
    world.setQuota(1)
    expect(world.fn.sendEmailToOptedIn()).toEqual({ sent: 1, left: 1 })
    world.setQuota(100)
    expect(world.fn.sendEmailToOptedIn()).toEqual({ sent: 1, left: 0 })
    expect(world.fn.sendEmailToOptedIn()).toEqual({ sent: 0, left: 0 })
    expect(world.mail.map((m) => m.to).sort()).toEqual(['ana@agency.com', 'cy@y.com'])
    const message = world.mail[0]
    expect(message?.body).toContain(
      'Unsubscribe: https://script.google.com/macros/s/ID/exec?a=unsubscribe&e='
    )
    expect(message?.body).toContain('Product updates')
  })

  it('an unsubscribe link turns off both emails for that address; a forged one does nothing', () => {
    const world = loadScript()
    world.fn.setup()
    world.post(register({ news: true }))
    world.fn.sendEmailToOptedIn()
    const link = /Unsubscribe: (\S+)/.exec(world.mail[0]?.body ?? '')?.[1] ?? ''
    const params = Object.fromEntries(new URL(link).searchParams)
    expect(world.get({ ...params, s: 'forged' })).toContain('not valid')
    expect(world.rows('Users')[0]?.[5]).toBe(true)
    expect(world.get(params)).toContain('You are unsubscribed')
    const row = world.rows('Users')[0]
    expect(row?.[5]).toBe(false)
    expect(row?.[6]).toBe(false)
    expect(row?.[11]).not.toBe('')
  })

  it('deletes a person everywhere by email', () => {
    const world = loadScript()
    world.fn.setup()
    world.post(register())
    world.post({
      kind: 'ping',
      token: TOKEN,
      installId: 'install-aaaa-1111',
      version: '1.0.0',
      os: 'darwin'
    })
    world.post(register({ installId: 'install-zzzz-9999', email: 'keep@x.com' }))
    expect(world.fn.deleteUserByEmail('ANA@agency.com')).toBe(1)
    expect(world.rows('Users').map((r) => r[1])).toEqual(['keep@x.com'])
    expect(world.rows('Installs')).toHaveLength(0)
  })
})

function zipBase64(bytes = 200): string {
  return Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(bytes, 7)]).toString('base64')
}

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'report',
    token: TOKEN,
    reportId: 'CF-ABC234',
    installId: 'install-aaaa-1111',
    version: '0.13.2',
    build: 1500,
    os: 'darwin',
    arch: 'arm64',
    note: 'The report page is blank',
    summary: 'Line one\nLine two',
    zipName: 'CF-ABC234.zip',
    zipBase64: zipBase64(),
    ...over
  }
}

describe('validateReport', () => {
  const check = (over: Record<string, unknown> = {}): unknown =>
    loadScript().fn.validateReport(report(over))

  it('accepts a good report and cleans the text', () => {
    const result = check({
      note: '  hi\tthere\u0000  ',
      summary: 'a\r\nb\u0007c',
      os: 'plan9'
    }) as {
      ok: boolean
      value: Record<string, unknown>
    }
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({
      reportId: 'CF-ABC234',
      installId: 'install-aaaa-1111',
      version: '0.13.2',
      build: 1500,
      os: 'other',
      arch: 'arm64',
      note: 'hi there',
      summary: 'a\nb c',
      zipName: 'CF-ABC234.zip'
    })
  })

  it('keeps the note under 2000 and the summary under 4000 characters', () => {
    const result = check({ note: 'n'.repeat(5000), summary: 's\n'.repeat(5000) }) as {
      value: { note: string; summary: string }
    }
    expect(result.value.note).toHaveLength(2000)
    expect(result.value.summary.length).toBeLessThanOrEqual(4000)
    expect(result.value.summary).toContain('\n')
  })

  it('refuses a bad reference or install id', () => {
    for (const reportId of [
      'CF-ABC23',
      'cf-ABC234',
      'CF-ABCI34',
      'CF-ABC0O1',
      'XX-ABC234',
      7,
      ''
    ]) {
      expect(check({ reportId, zipName: `${String(reportId)}.zip` })).toEqual({
        ok: false,
        error: 'invalid'
      })
    }
    expect(check({ installId: 'x' })).toEqual({ ok: false, error: 'invalid' })
  })

  it('refuses data that is not a zip, is not base64, or has the wrong file name', () => {
    const notZip = Buffer.from('not a zip file at all').toString('base64')
    expect(check({ zipBase64: notZip })).toEqual({ ok: false, error: 'invalid' })
    expect(check({ zipBase64: 'PK!!not base64!!' })).toEqual({ ok: false, error: 'invalid' })
    expect(check({ zipBase64: 'UEsD' + 'A'.repeat(5) })).toEqual({ ok: false, error: 'invalid' })
    expect(check({ zipBase64: '' })).toEqual({ ok: false, error: 'invalid' })
    expect(check({ zipBase64: 42 })).toEqual({ ok: false, error: 'invalid' })
    expect(check({ zipName: 'report.zip' })).toEqual({ ok: false, error: 'invalid' })
    expect(check({ zipName: 'CF-ABC234.zip.exe' })).toEqual({ ok: false, error: 'invalid' })
  })

  it('refuses a file that is too big (text over 3.5M, or more than 2.6 MB of data)', () => {
    expect(check({ zipBase64: zipBase64(2_000_000) })).toMatchObject({ ok: true })
    expect(check({ zipBase64: zipBase64(2_620_000) })).toEqual({ ok: false, error: 'size' })
    expect(check({ zipBase64: 'UEsD'.repeat(900_000) })).toEqual({ ok: false, error: 'size' })
  })
})

describe('the POST body cap', () => {
  const world = loadScript()
  const parse = (text: string): unknown => world.fn.parseBody(text)

  it('keeps 10,000 characters for register and ping', () => {
    expect(parse(JSON.stringify({ kind: 'register', pad: 'x'.repeat(9900) }))).not.toBeNull()
    expect(parse(JSON.stringify({ kind: 'register', pad: 'x'.repeat(10_000) }))).toBeNull()
    expect(parse(JSON.stringify({ kind: 'ping', pad: 'x'.repeat(10_000) }))).toBeNull()
    expect(parse(JSON.stringify({ pad: 'x'.repeat(10_000) }))).toBeNull()
    // The word "report" somewhere does not make a big body a report.
    expect(
      parse(JSON.stringify({ kind: 'ping', note: 'report', pad: 'x'.repeat(20_000) }))
    ).toBeNull()
  })

  it('allows up to 3,600,000 characters for a report only', () => {
    expect(parse(JSON.stringify({ kind: 'report', pad: 'x'.repeat(3_000_000) }))).not.toBeNull()
    expect(parse(JSON.stringify({ kind: 'report', pad: 'x'.repeat(3_600_000) }))).toBeNull()
    expect(parse('[1,2,3]')).toBeNull()
    expect(parse('not json')).toBeNull()
  })
})

describe('saving a problem report', () => {
  it('writes the Sheet row, saves a private zip in Drive and emails the owner', () => {
    const world = loadScript()
    world.fn.setup()
    expect(world.post(report())).toEqual({ ok: true, reportId: 'CF-ABC234' })
    const row = world.rows('Reports')[0] as unknown[]
    expect(Object.prototype.toString.call(row[0])).toBe('[object Date]')
    expect(row.slice(1, 9)).toEqual([
      'CF-ABC234',
      'install-aaaa-1111',
      '0.13.2',
      1500,
      'darwin',
      'arm64',
      'The report page is blank',
      'Line one\nLine two'
    ])
    expect(row.slice(9)).toEqual(['https://drive.google.com/file/d/file1/view', 'new', '', ''])
    expect(world.drive.folders).toEqual(['CiteFox reports'])
    expect(world.properties.get('REPORTS_FOLDER_ID')).toBe('folder1')
    const file = world.drive.files[0]
    expect(file).toMatchObject({ name: 'CF-ABC234.zip', type: 'application/zip', trashed: false })
    expect(
      Buffer.from(file?.bytes.map((b) => b & 255) ?? [])
        .subarray(0, 2)
        .toString()
    ).toBe('PK')
    expect(world.mail).toHaveLength(1)
    const mail = world.mail[0]
    expect(mail?.to).toBe('owner@gmail.com')
    expect(mail?.subject).toBe('[CiteFox report] CF-ABC234')
    expect(mail?.htmlBody).toBeUndefined()
    expect(mail?.body).toContain('Reference: CF-ABC234')
    expect(mail?.body).toContain('The report page is blank')
    expect(mail?.body).toContain('https://drive.google.com/file/d/file1/view')
  })

  it('reuses the Drive folder, and a retry of the same reference adds nothing', () => {
    const world = loadScript()
    world.fn.setup()
    world.post(report())
    world.post(report({ reportId: 'CF-ABD234', zipName: 'CF-ABD234.zip' }))
    expect(world.drive.folders).toHaveLength(1)
    expect(world.drive.files).toHaveLength(2)
    expect(world.post(report())).toEqual({ ok: true, reportId: 'CF-ABC234' })
    expect(world.rows('Reports')).toHaveLength(2)
    expect(world.drive.files).toHaveLength(2)
  })

  it('cuts the note at 300 and the summary at 500 characters in the Sheet', () => {
    const world = loadScript()
    world.fn.setup()
    world.post(report({ note: 'n'.repeat(900), summary: 's'.repeat(900) }))
    const row = world.rows('Reports')[0] as string[]
    expect(row[7]).toHaveLength(300)
    expect(row[8]).toHaveLength(500)
    expect(world.mail[0]?.body).toContain('n'.repeat(900))
  })

  it('keeps formulas out of the Sheet (= + - @ in the note and summary)', () => {
    const world = loadScript()
    world.fn.setup()
    const formulas = ['=HYPERLINK("x")', '+cmd', '-1+2', '@SUM(A1)']
    formulas.forEach((text, i) => {
      world.post(
        report({
          installId: `install-formula-${i}`,
          reportId: `CF-AB${i + 2}234`,
          zipName: `CF-AB${i + 2}234.zip`,
          note: text,
          summary: text
        })
      )
    })
    const rows = world.rows('Reports') as string[][]
    expect(rows).toHaveLength(4)
    rows.forEach((row, i) => {
      expect(row[7]).toBe(`'${formulas[i]}`)
      expect(row[8]).toBe(`'${formulas[i]}`)
    })
    expect(world.fn.safeCell('plain')).toBe('plain')
    expect(world.fn.safeCell('=1+1')).toBe("'=1+1")
  })

  it('still records the row, with "not saved", when Drive or mail fails', () => {
    const world = loadScript()
    world.fn.setup()
    world.breakServices({ drive: true, mail: true })
    expect(world.post(report())).toEqual({ ok: true, reportId: 'CF-ABC234' })
    const row = world.rows('Reports')[0] as unknown[]
    expect(row[9]).toBe('not saved')
    expect(world.drive.files).toHaveLength(0)
    expect(world.mail).toHaveLength(0)
  })

  it('refuses a wrong token, bad input and a body that is not a report', () => {
    const world = loadScript()
    world.fn.setup()
    expect(world.post(report({ token: 'nope' }))).toEqual({ ok: false, error: 'token' })
    expect(world.post(report({ zipName: 'x.zip' }))).toEqual({ ok: false, error: 'invalid' })
    expect(world.post(report({ zipBase64: zipBase64(2_620_000) }))).toEqual({
      ok: false,
      error: 'size'
    })
    const big = world.fn.doPost({
      postData: { contents: JSON.stringify(register({ company: 'x'.repeat(20_000) })) }
    }) as { text: string }
    expect(JSON.parse(big.text)).toEqual({ ok: false, error: 'invalid' })
    expect(world.rows('Reports')).toHaveLength(0)
    expect(world.mail).toHaveLength(0)
  })
})

describe('report rate limits', () => {
  it('allows 3 an hour per install, then answers "rate"; other installs are not affected', () => {
    const world = loadScript()
    world.fn.setup()
    const send = (i: number, installId = 'install-aaaa-1111'): { ok: boolean; error?: string } =>
      world.post(report({ installId, reportId: `CF-AB${i}234`, zipName: `CF-AB${i}234.zip` }))
    expect(send(2).ok && send(3).ok && send(4).ok).toBe(true)
    expect(send(5)).toEqual({ ok: false, error: 'rate' })
    expect(send(6, 'install-bbbb-2222').ok).toBe(true)
    expect(world.rows('Reports')).toHaveLength(4)
  })

  it('counts the hourly limit with a cache entry of at most 6 hours', () => {
    const world = loadScript()
    world.fn.allow('report', 'install-aaaa-1111')
    expect(world.cache.get('rl:report:install-aaaa-1111')).toBe('1')
  })

  it('counts 10 a day per install and 200 a day for everyone, from the Reports rows', () => {
    const world = loadScript()
    const now = new Date('2026-11-03T12:00:00Z')
    const row = (install: string, hoursAgo: number): unknown[] => [
      new Date(now.getTime() - hoursAgo * 3_600_000),
      'CF-X',
      install
    ]
    const mine = Array.from({ length: 9 }, () => row('install-aaaa-1111', 5))
    expect(world.fn.reportsOverDailyLimit(mine, 'install-aaaa-1111', now)).toBe(false)
    expect(
      world.fn.reportsOverDailyLimit(
        [...mine, row('install-aaaa-1111', 23)],
        'install-aaaa-1111',
        now
      )
    ).toBe(true)
    // Older than 24 hours does not count.
    expect(
      world.fn.reportsOverDailyLimit(
        [...mine, row('install-aaaa-1111', 25)],
        'install-aaaa-1111',
        now
      )
    ).toBe(false)
    expect(world.fn.reportsOverDailyLimit(mine, 'install-bbbb-2222', now)).toBe(false)
    const everyone = Array.from({ length: 200 }, (_v, i) => row(`install-${i}-00000`, 1))
    expect(world.fn.reportsOverDailyLimit(everyone, 'install-new-00000', now)).toBe(true)
    expect(world.fn.reportsOverDailyLimit(everyone.slice(1), 'install-new-00000', now)).toBe(false)
  })

  it('answers "rate" over the daily limit even when the hourly limit has room', () => {
    const world = loadScript()
    world.fn.setup()
    const tab = world.sheets.get('Reports')
    for (let i = 0; i < 10; i++) {
      tab?.appendRow([new Date(), `CF-OLD${i}`, 'install-aaaa-1111'])
    }
    expect(world.post(report())).toEqual({ ok: false, error: 'rate' })
    expect(world.drive.files).toHaveLength(0)
  })
})

describe('report admin', () => {
  it('setup makes the Reports tab with its 13 columns', () => {
    const world = loadScript()
    world.fn.setup()
    expect(world.sheets.get('Reports')?.rows[0]).toEqual([
      'Received',
      'Reference',
      'Install',
      'Version',
      'Build',
      'OS',
      'Arch',
      'Note',
      'Summary',
      'File',
      'Status',
      'Handled by',
      'Notes'
    ])
  })

  it('counts reports', () => {
    const world = loadScript()
    world.fn.setup()
    world.post(report())
    world.post(report({ reportId: 'CF-ABD234', zipName: 'CF-ABD234.zip' }))
    ;(world.sheets.get('Reports')?.rows[2] as unknown[])[10] = 'done'
    expect(world.fn.reportCounts()).toEqual({ total: 2, last7: 2, unhandled: 1 })
  })

  it('deletes a report by reference: the row goes and the Drive file is trashed', () => {
    const world = loadScript()
    world.fn.setup()
    world.post(report())
    world.post(report({ reportId: 'CF-ABD234', zipName: 'CF-ABD234.zip' }))
    expect(world.fn.deleteReportByReference(' cf-abc234 ')).toBe(1)
    expect(world.rows('Reports').map((r) => r[1])).toEqual(['CF-ABD234'])
    expect(world.drive.files.map((f) => f.trashed)).toEqual([true, false])
    expect(world.fn.deleteReportByReference('CF-ZZZ999')).toBe(0)
    expect(() => world.fn.deleteReportByReference('hello')).toThrow()
  })

  it('leaves the people logic untouched (recipients still come from the newest row)', () => {
    const world = loadScript()
    const rows = [
      ['i1', 'a@x.com', 'A', '', 'solo', true, false, '', '2026-01-01', '', '', ''],
      ['i2', 'a@x.com', 'A', '', 'solo', false, false, '', '2026-02-01', '', '', '']
    ]
    expect(world.fn.pickRecipients(rows, 'updates', {})).toEqual([])
  })
})
