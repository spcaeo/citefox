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
