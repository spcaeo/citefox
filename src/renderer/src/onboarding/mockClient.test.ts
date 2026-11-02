import { describe, expect, test, vi } from 'vitest'
import type { ClaudeCheckupProgress, SaveProfileRequest } from '@shared/ipc'
import { API_KEY_LOGIN_LABEL, loginStatusLabel } from './claudeLogin'
import { isOutOfSearches } from '../keys/usage'
import {
  createMockOnboardingClient,
  maskedHint,
  type MockOnboardingClient,
  type MockScenario
} from './mockClient'
import { emptyProfileDraft, validateProfile } from './validate'

const SECRET = 'serpapi-live-key-0001'
const SHORT_SECRET = '12345678'

function profileRequest(country = 'US', language = 'en'): SaveProfileRequest {
  const result = validateProfile({
    ...emptyProfileDraft(),
    userName: 'Rakesh',
    projectName: 'TextBolt',
    domain: 'textbolt.com',
    brands: ['TextBolt'],
    competitors: ['simpletexting.com'],
    country,
    language,
    location: 'Austin, Texas'
  })
  if (!result.ok) throw new Error('fixture profile should validate')
  return result.request
}

function clientFor(scenario: MockScenario = 'success'): MockOnboardingClient {
  return createMockOnboardingClient({
    scenario: () => scenario,
    paceMs: 0,
    wait: () => Promise.resolve()
  })
}

describe('maskedHint', () => {
  test('omits a hint for a secret of 8 characters or fewer', () => {
    expect(maskedHint('12345678')).toBe('')
    expect(maskedHint('1234567')).toBe('')
    expect(maskedHint('123456789')).toBe('6789')
    expect(maskedHint(SECRET).length).toBe(4)
  })
})

describe('mock onboarding client', () => {
  test('stores UK and GB as given and writes the person name to settings', async () => {
    const client = clientFor()
    const uk = await client.saveProfile(profileRequest('UK'))
    expect(uk.profile?.defaultMarket.country).toBe('UK')
    expect(uk.profile?.defaultMarket.serpapiLocation).toBe('Austin,Texas,United States')
    expect(uk.profile?.includeSubdomains).toBe(true)
    expect(uk.profile?.defaultMarket.device).toBe('desktop')
    expect(uk.currentStep).toBe('serpapi')
    const settings = await client.getSettings()
    expect(settings.settings.userName).toBe('Rakesh')
    expect(settings.settings.defaultCountry).toBe('UK')

    await client.updateSettings({ defaultCountry: 'FR' })
    const gb = await client.saveProfile(profileRequest('GB'))
    expect(gb.profile?.defaultMarket.country).toBe('GB')
    const after = await client.getSettings()
    expect(after.settings.defaultCountry).toBe('FR')
    expect(after.settings.userName).toBe('Rakesh')
  })

  test('never returns a secret, and a short secret has no hint', async () => {
    const client = clientFor()
    const added = await client.addKey({
      provider: 'serpapi',
      name: 'SerpApi',
      secret: SHORT_SECRET,
      cap: null,
      projectIds: []
    })
    expect(added.hint).toBe('')
    expect(added.keychainRef.length).toBeGreaterThan(0)
    expect(added.state).toBe('unchecked')
    expect(JSON.stringify(added)).not.toContain(SHORT_SECRET)

    const tested = await client.testKey({ id: added.id })
    expect(tested.key.hint).toBe('')
    expect(tested.key.state).toBe('ok')
    expect(tested.message).not.toContain(SHORT_SECRET)
    expect(JSON.stringify(tested)).not.toContain(SHORT_SECRET)

    const replaced = await client.replaceKey({ id: added.id, secret: SECRET })
    expect(replaced.hint).toBe(SECRET.slice(-4))
    expect(JSON.stringify(replaced)).not.toContain(SECRET)
  })

  test('keeps several keys for one provider in rotation order (FR-11.1, FR-11.5)', async () => {
    const client = clientFor()
    const first = await client.addKey({
      provider: 'jina',
      name: 'Jina',
      secret: SECRET,
      cap: null,
      projectIds: []
    })
    const second = await client.addKey({
      provider: 'jina',
      name: 'Jina again',
      secret: `${SECRET}-2`,
      cap: null,
      projectIds: []
    })
    expect([first.rotationOrder, second.rotationOrder]).toEqual([0, 1])
    const overview = await client.getOverview()
    expect(overview.keys.filter((key) => key.provider === 'jina')).toHaveLength(2)
    expect(JSON.stringify(overview)).not.toContain(SECRET)
  })

  test('a failed test names the next step and does not include the secret', async () => {
    const client = clientFor('serpapi-fail')
    const added = await client.addKey({
      provider: 'serpapi',
      name: 'SerpApi',
      secret: SECRET,
      cap: 250,
      projectIds: []
    })
    expect(added.state).toBe('unchecked')
    expect((await client.getOverview()).serpapi).toBe('unchecked')
    const tested = await client.testKey({ id: added.id })
    expect(tested.key.state).toBe('warning')
    expect(tested.message).toMatch(/SerpApi rejected this key/)
    expect(tested.message).toMatch(/paste it again/)
    expect(tested.message).not.toContain(SECRET)
    expect(tested.key.serpapiUsage).toBeNull()
    expect(tested.reason).toBe('rejected')
    expect(isOutOfSearches(tested)).toBe(false)
    const overview = await client.getOverview()
    expect(overview.serpapi).toBe('warning')
    expect(overview.issueCount).toBe(1)
    await client.setKeyOn({ id: added.id, on: false })
    const turnedOff = await client.getOverview()
    expect(turnedOff.serpapi).toBe('off')
    expect(turnedOff.issueCount).toBe(0)
  })

  test('a missing key is off, and other test failures stay warning', async () => {
    const fresh = clientFor()
    const empty = await fresh.getOverview()
    expect(empty.serpapi).toBe('off')
    expect(empty.jina).toBe('off')
    expect(empty.youtube).toBe('off')
    expect(empty.claudeCode).toBe('unchecked')

    const quota = clientFor('serpapi-quota')
    const quotaKey = await quota.addKey({
      provider: 'serpapi',
      name: 'SerpApi',
      secret: SECRET,
      cap: null,
      projectIds: []
    })
    const quotaTest = await quota.testKey({ id: quotaKey.id })
    expect(quotaTest.key.state).toBe('warning')
    expect(quotaTest.message).toMatch(/out of searches/)
    expect(quotaTest.key.serpapiUsage).toEqual({ used: 250, planLimit: 250, plan: 'Developer' })
    expect(quotaTest.reason).toBe('out_of_searches')
    expect(isOutOfSearches(quotaTest)).toBe(true)

    const cases = [
      ['serpapi-rate', /429/],
      ['serpapi-timeout', /timed out/],
      ['serpapi-bad', /could not read/]
    ] as const
    for (const [scenario, message] of cases) {
      const client = clientFor(scenario)
      const added = await client.addKey({
        provider: 'serpapi',
        name: 'SerpApi',
        secret: SECRET,
        cap: null,
        projectIds: []
      })
      const tested = await client.testKey({ id: added.id })
      expect(tested.key.state).toBe('warning')
      expect(tested.message).toMatch(message)
      expect(tested.message).not.toContain(SECRET)
      expect(tested.key.serpapiUsage).toBeNull()
      expect(tested.reason).not.toBe('out_of_searches')
      expect(isOutOfSearches(tested)).toBe(false)
      expect((await client.getOverview()).serpapi).toBe('warning')
    }
  })

  test('tests an Anthropic key inside add', async () => {
    const client = clientFor()
    const added = await client.addKey({
      provider: 'anthropic',
      name: 'Anthropic',
      secret: SECRET,
      cap: null,
      projectIds: []
    })
    expect(added.state).toBe('ok')
    const settings = await client.getSettings()
    expect(settings.settings.claudeProvider).toBe('anthropic-api')
  })

  test('finish requires a profile and a SerpApi key, and skips Jina', async () => {
    const client = clientFor()
    await expect(client.finish()).rejects.toThrow(/onboarding:finish/)
    await client.saveProfile(profileRequest())
    await expect(client.finish()).rejects.toThrow(/onboarding:finish/)
    await client.addKey({
      provider: 'serpapi',
      name: 'SerpApi',
      secret: SECRET,
      cap: 250,
      projectIds: []
    })
    const done = await client.finish()
    expect(done.finished).toBe(true)
    expect(done.currentStep).toBeNull()
    expect(done.steps.find((step) => step.id === 'jina')?.status).toBe('skipped')
  })

  test('reset keeps the keys, goes back to the first run and restarts', async () => {
    const restart = vi.fn()
    const client = createMockOnboardingClient({
      scenario: () => 'success',
      paceMs: 0,
      wait: () => Promise.resolve(),
      restart
    })
    await client.saveProfile(profileRequest())
    await client.addKey({
      provider: 'serpapi',
      name: 'SerpApi',
      secret: SECRET,
      cap: 250,
      projectIds: []
    })
    await client.finish()
    expect(await client.resetKeepKeys()).toEqual({ ok: true })
    expect(restart).toHaveBeenCalledTimes(1)
    const state = await client.getState()
    expect(state.finished).toBe(false)
    expect(state.profile).toBeNull()
    expect((await client.getOverview()).keys.map((key) => key.provider)).toEqual(['serpapi'])
    expect((await client.getSettings()).settings.userName).toBeNull()
  })

  test('the sample test window opens once, then is already open; fresh needs it closed', async () => {
    const client = clientFor()
    expect(await client.openTestProfile({ fresh: true })).toEqual({ ok: true, alreadyOpen: false })
    expect(await client.openTestProfile({ fresh: false })).toEqual({ ok: true, alreadyOpen: true })
    expect(await client.openTestProfile({ fresh: true })).toEqual({
      ok: false,
      message: 'Close the test window first, then start fresh.'
    })
  })

  test('a stored Jina key is done rather than skipped', async () => {
    const client = clientFor()
    await client.saveProfile(profileRequest())
    await client.addKey({
      provider: 'serpapi',
      name: 'SerpApi',
      secret: SECRET,
      cap: null,
      projectIds: []
    })
    await client.addKey({
      provider: 'jina',
      name: 'Jina',
      secret: SECRET,
      cap: null,
      projectIds: []
    })
    const done = await client.finish()
    expect(done.steps.find((step) => step.id === 'jina')?.status).toBe('done')
  })

  test('emits checkup progress then a ready result', async () => {
    const client = clientFor('success')
    const seen: ClaudeCheckupProgress[] = []
    const unsubscribe = client.onCheckupProgress((event) => {
      seen.push(event)
    })
    const result = await client.runCheckup({ binaryPath: null })
    unsubscribe()
    expect(seen.map((event) => `${event.phase}:${event.state}`)).toEqual([
      'binary:running',
      'binary:ok',
      'login:running',
      'login:ok',
      'roundTrip:running',
      'roundTrip:ok'
    ])
    expect(result.ready).toBe(true)
    expect(result.login).toBe('logged_in')
    expect(result.plan).toBe('Claude Max')
    expect(result.message).toBe('Claude Code is ready.')
    expect((await client.getSettings()).settings.claudeModel).toBeNull()
    expect(result.resolvedModel).toBe('claude-sonnet-5-5')
    expect(JSON.stringify({ ...result, resolvedModel: null })).not.toMatch(
      /sonnet|opus|haiku|claude-3/i
    )
    expect(result.rows.binary.detail).toBe('/usr/local/bin/claude · version 2.4.1')
    expect(JSON.stringify({ seen, result })).not.toContain(SECRET)
    const stored = await client.getCheckup()
    expect(stored?.ready).toBe(true)
    const state = await client.getState()
    expect(state.steps.find((step) => step.id === 'claude')?.status).toBe('done')
  })

  test('a logged-out checkup warns and skips the round trip', async () => {
    const client = clientFor('checkup-logged-out')
    const seen: ClaudeCheckupProgress[] = []
    client.onCheckupProgress((event) => {
      seen.push(event)
    })
    const result = await client.runCheckup({ binaryPath: null })
    expect(seen.some((event) => event.state === 'running')).toBe(true)
    expect(seen.some((event) => event.phase === 'login' && event.state === 'warning')).toBe(true)
    expect(result.ready).toBe(false)
    expect(result.login).toBe('logged_out')
    expect(result.rows.login.statusLabel).toBe('Not logged in')
    expect(result.nextStep).toMatch(/run claude/)
    expect(result.rows.roundTrip.state).toBe('skipped')
  })

  test('a failed round trip keeps the next step on the result', async () => {
    const client = clientFor('checkup-fail')
    const seen: ClaudeCheckupProgress[] = []
    client.onCheckupProgress((event) => {
      seen.push(event)
    })
    const result = await client.runCheckup({ binaryPath: null })
    expect(seen.map((event) => event.phase)).toEqual([
      'binary',
      'binary',
      'login',
      'login',
      'roundTrip',
      'roundTrip'
    ])
    expect(result.roundTrip).toBe('failed')
    expect(result.rows.roundTrip.statusLabel).toBe('No reply')
    expect(result.nextStep).toBeTruthy()
    expect(result.message).toBe('The test call did not get a reply.')
  })

  test('an API-key Claude login is labelled and names no model', async () => {
    const client = clientFor('checkup-api-key')
    const result = await client.runCheckup({ binaryPath: null })
    expect(result.login).toBe('api_key')
    expect(result.ready).toBe(false)
    expect(result.plan).toBeNull()
    expect(result.roundTrip).toBe('skipped')
    expect(loginStatusLabel(result)).toBe(API_KEY_LOGIN_LABEL)
    expect(result.rows.login.statusLabel).toBe('API key only')
    expect(result.rows.login.state).toBe('warning')
    expect((await client.getSettings()).settings.claudeModel).toBeNull()
    expect(JSON.stringify(result)).not.toMatch(/sonnet|opus|haiku|claude-3|Claude Max/i)
    const overview = await client.getOverview()
    expect(overview.claudeCode).toBe('warning')
    expect(overview.claudeCheckup?.login).toBe('api_key')
  })

  test('a missing keychain item is warning, not off', async () => {
    const client = clientFor()
    const added = await client.addKey({
      provider: 'serpapi',
      name: 'SerpApi',
      secret: SECRET,
      cap: null,
      projectIds: []
    })
    expect((await client.getOverview()).serpapi).toBe('unchecked')
    client.forgetKeychain(added.id)
    expect((await client.getOverview()).serpapi).toBe('warning')
    const tested = await client.testKey({ id: added.id })
    expect(tested.key.state).toBe('warning')
    expect(tested.message).toBe('The SerpApi key is missing from the keychain.')
    expect(tested.message).not.toContain(SECRET)
    expect(JSON.stringify(tested)).not.toContain(SECRET)
    const overview = await client.getOverview()
    expect(overview.serpapi).toBe('warning')
    expect(overview.issueCount).toBe(1)
  })
})
