import { describe, expect, test } from 'vitest'
import type { FinishSetupRequest, SetupContext, SetupSectionRunRequest } from '@shared/ipc'
import { createMockTopicResultsSource } from '../topics/results/source/mock'
import { createMockOnboardingClient } from './mockClient'
import { createMockSectionClient, MOCK_NO_SEARCH_KEY_MESSAGE } from './mockSections'

const noWait = (): Promise<void> => Promise.resolve()

const context: SetupContext = {
  domain: 'textbolt.com',
  country: 'US',
  language: 'en',
  summary: '',
  brands: ['TextBolt'],
  products: [],
  buyers: [],
  triggers: [],
  competitors: [],
  switchingFrom: [],
  integrations: [],
  topic: ''
}

function run(overrides: Partial<SetupSectionRunRequest> = {}): SetupSectionRunRequest {
  return {
    section: 'buyers',
    context,
    mode: 'redo',
    instruction: null,
    current: [],
    prompt: null,
    ...overrides
  }
}

const finish: FinishSetupRequest = {
  summary: 'TextBolt sells an email-to-SMS gateway.',
  products: [],
  competitors: [],
  buyers: [],
  triggers: [],
  topic: 'Gateway shutdown',
  questions: [{ name: 'How do we text staff?', detail: '', url: null, tag: 'problem' }],
  runFirstCheck: true
}

describe('mock section client', () => {
  test('estimates on the Claude plan, or the ChatGPT way with no Claude', async () => {
    const on = createMockSectionClient({ wait: noWait, claude: true })
    await expect(on.sectionEstimate({ section: 'competitors' })).resolves.toMatchObject({
      available: true,
      costText: '1 Claude call with web search · on your Claude plan'
    })
    const off = createMockSectionClient({ wait: noWait, claude: false })
    await expect(off.sectionEstimate({ section: 'buyers' })).resolves.toMatchObject({
      available: false,
      reason: 'Claude is not set up. Use your own ChatGPT for this section.'
    })
    await expect(off.sectionRun(run())).rejects.toThrow(/not set up/u)
  })

  test('redo returns a fresh list, Find more only new rows, text sections their text', async () => {
    const client = createMockSectionClient({ wait: noWait, claude: true })
    const redo = await client.sectionRun(run())
    expect(redo.rows.length).toBe(3)
    const more = await client.sectionRun(run({ mode: 'more', current: redo.rows }))
    expect(more.rows.map((row) => row.name)).toEqual([
      'Facility managers at manufacturing plants',
      'School administrators'
    ])
    const again = await client.sectionRun(
      run({ mode: 'more', current: [...redo.rows, ...more.rows] })
    )
    expect(again.rows).toEqual([])
    expect(again.warnings[0]).toMatch(/Nothing new/u)
    const topic = await client.sectionRun(run({ section: 'topic' }))
    expect(topic.text).toBe('Replacing a shut-down email-to-text gateway')
  })

  test('the prompt lists held rows, the user words and the reply header', async () => {
    const client = createMockSectionClient({ wait: noWait, claude: true })
    const prompt = await client.sectionPrompt({
      section: 'competitors',
      context,
      mode: 'more',
      instruction: 'only US competitors',
      current: [{ name: 'Notifyre', detail: '', url: 'notifyre.com', tag: null }]
    })
    expect(prompt.webSearch).toBe(true)
    expect(prompt.prompt).toContain("Already listed, don't repeat: 1.")
    expect(prompt.prompt).toContain('The user asks for this: only US competitors')
    expect(prompt.prompt).toContain(
      'Reply with CSV only, this header:\nname,domain,product,tier,why'
    )
  })

  test('a pasted CSV answer reads into rows without the held ones', async () => {
    const client = createMockSectionClient({ wait: noWait, claude: true })
    const read = await client.sectionRead({
      section: 'questions',
      context,
      current: [{ name: 'How do we text staff?', detail: '', url: null, tag: null }],
      text: 'question,stage,page\nHow do we text staff?,problem,/\nWhich gateway is cheapest?,Decide,/pricing/'
    })
    expect(read.rows).toEqual([
      { name: 'Which gateway is cheapest?', detail: 'question', url: '/pricing/', tag: 'decide' }
    ])
  })

  test('finishSetup finishes the onboarding mock and starts the check only with a search key', async () => {
    const onboarding = createMockOnboardingClient({
      scenario: () => 'success',
      wait: noWait,
      paceMs: 0
    })
    const client = createMockSectionClient({ wait: noWait, onboarding })
    await expect(client.finishSetup(finish)).rejects.toThrow(/Save your site first/u)
    await onboarding.saveProfile({
      userName: '',
      projectName: 'TextBolt',
      domain: 'textbolt.com',
      includeSubdomains: true,
      brandNames: ['TextBolt'],
      competitors: [],
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop'
    })
    const noKey = await client.finishSetup(finish)
    expect(noKey).toMatchObject({
      checkStarted: false,
      message: MOCK_NO_SEARCH_KEY_MESSAGE,
      topicId: 'topic-carrier-gateway'
    })
    expect(noKey.state.finished).toBe(true)
  })

  test('Finish lands on a topic the mock topic page can open', async () => {
    const onboarding = createMockOnboardingClient({
      scenario: () => 'success',
      wait: noWait,
      paceMs: 0
    })
    const client = createMockSectionClient({ wait: noWait, onboarding })
    await onboarding.saveProfile({
      userName: '',
      projectName: 'TextBolt',
      domain: 'textbolt.com',
      includeSubdomains: true,
      brandNames: ['TextBolt'],
      competitors: [],
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop'
    })
    const done = await client.finishSetup(finish)
    expect(done.topicId).not.toBeNull()
    const results = await createMockTopicResultsSource().results({
      projectId: done.projectId,
      topicId: done.topicId ?? '',
      marketId: null,
      runId: null
    })
    expect(results.topic.id).toBe(done.topicId)
  })

  test('a cloro key counts as the search key', async () => {
    const onboarding = createMockOnboardingClient({
      scenario: () => 'success',
      wait: noWait,
      paceMs: 0
    })
    await onboarding.saveProfile({
      userName: 'Ada',
      projectName: 'TextBolt',
      domain: 'textbolt.com',
      includeSubdomains: true,
      brandNames: ['TextBolt'],
      competitors: [],
      country: 'US',
      language: 'en',
      location: null,
      device: 'desktop'
    })
    await onboarding.addKey({
      provider: 'cloro',
      name: 'cloro',
      secret: 'cloro-secret-value-1234',
      cap: null,
      projectIds: []
    })
    const client = createMockSectionClient({ wait: noWait, onboarding })
    const result = await client.finishSetup(finish)
    expect(result).toMatchObject({ checkStarted: true, message: null })
  })
})
