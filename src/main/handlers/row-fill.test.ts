import { afterEach, describe, expect, test } from 'vitest'
import type { RowFillRequest } from '@shared/ipc'
import { insertPage } from '../storage/pages'
import { closeProjectDatabase, openProjectDatabase } from '../storage/project-files'
import { textboltContext } from '../onboarding/sections/test-context.test-helper'
import { cleanupHarness, harness, profile, sectionClaude } from './test-harness'

afterEach(cleanupHarness)

const request = (name: string): RowFillRequest => ({
  list: 'products' as const,
  context: textboltContext(),
  name,
  examples: []
})

describe('IPC handlers: row fill (CiteFox AI writes the second part of a hand-added row)', () => {
  test('onboarding:rowFill sends one small JSON call and returns the line', async () => {
    const claude = sectionClaude(
      () => '{"line":"Sends one text to a whole contact list","page":"/nope/"}'
    )
    const { handlers } = harness({ claude })
    await expect(handlers['onboarding:rowFill'](request('Mass texting'))).resolves.toEqual({
      detail: 'Sends one text to a whole contact list',
      url: null
    })
    expect(claude.requests).toHaveLength(1)
    const call = claude.requests[0]!
    expect(call.prompt.startsWith('Assist: setup.rowFillProducts\n')).toBe(true)
    expect(call.prompt).toContain('"Mass texting"')
    expect(call.schema).toMatchObject({ required: ['line', 'page'] })
    expect(call.trace).toMatchObject({ source: 'assist', assistId: 'setup.rowFillProducts' })
  })

  test('an "unknown" answer is a normal blank result, not an error', async () => {
    const { handlers } = harness({ claude: sectionClaude(() => '{"line":"unknown","page":""}') })
    await expect(handlers['onboarding:rowFill'](request('Zorgle'))).resolves.toEqual({
      detail: '',
      url: null
    })
  })

  test('a failed AI call is an error the screen swallows; nothing about the prompt is logged', async () => {
    const { handlers, logs } = harness({
      claude: sectionClaude(() => {
        throw new Error('boom')
      })
    })
    await expect(handlers['onboarding:rowFill'](request('Mass texting'))).rejects.toThrow()
    const text = logs.join('\n')
    expect(text).toContain('row fill run')
    expect(text).not.toContain('Mass texting')
  })

  test('with no AI connection the call fails and the section estimate says why', async () => {
    const { handlers } = harness()
    await expect(handlers['onboarding:rowFill'](request('Mass texting'))).rejects.toThrow()
    await expect(
      handlers['onboarding:sectionEstimate']({ section: 'products' })
    ).resolves.toMatchObject({ available: false })
  })

  test('bad requests are refused before any call', async () => {
    const claude = sectionClaude(() => '{"line":"x","page":""}')
    const { handlers } = harness({ claude })
    await expect(
      handlers['onboarding:rowFill']({ ...request('A'), list: 'triggers' } as never)
    ).rejects.toThrow()
    await expect(handlers['onboarding:rowFill']({ ...request('A'), name: ' ' })).rejects.toThrow()
    expect(claude.requests).toHaveLength(0)
  })

  test('products:fillRow uses the project: its tracked pages are the only pages it may return', async () => {
    const claude = sectionClaude(
      () => '{"line":"Sends alerts from Outlook as texts","page":"/email-to-sms/outlook/"}'
    )
    const { handlers } = harness({ claude })
    const state = await handlers['onboarding:saveProfile'](profile())
    const projectId = state.profile?.project.id ?? ''
    const result = await handlers['products:fillRow']({ projectId, name: 'Outlook alerts' })
    // No tracked pages in this project: a page is never invented.
    expect(result).toEqual({ job: 'Sends alerts from Outlook as texts', evidencePath: null })
    expect(claude.requests[0]!.prompt).toContain('"Outlook alerts"')
    expect(claude.requests[0]!.trace).toMatchObject({ projectId })
  })

  test('products:fillRow returns a tracked page of the project when the AI picks one', async () => {
    const claude = sectionClaude(
      () => '{"line":"Sends alerts from Outlook as texts","page":"/email-to-sms/outlook/"}'
    )
    const { handlers, storage } = harness({ claude })
    const state = await handlers['onboarding:saveProfile'](profile())
    const projectId = state.profile?.project.id ?? ''
    const db = openProjectDatabase(storage.paths.projectsDirectory, 'textbolt')
    try {
      insertPage(db, {
        id: 'page-1',
        projectId,
        url: 'https://textbolt.com/email-to-sms/outlook/',
        title: 'Outlook to SMS',
        label: null,
        folder: null,
        status: 'not_tracked',
        setupStep: 'read',
        intervalDays: 14,
        samples: 1,
        promptCount: 10,
        defaultMarketId: null,
        pinned: false,
        score: null,
        promptSetVersion: null
      })
    } finally {
      closeProjectDatabase(db)
    }
    await expect(
      handlers['products:fillRow']({ projectId, name: 'Outlook alerts' })
    ).resolves.toEqual({
      job: 'Sends alerts from Outlook as texts',
      evidencePath: '/email-to-sms/outlook/'
    })
    expect(claude.requests[0]!.prompt).toContain('- /email-to-sms/outlook/: Outlook to SMS')
  })

  test('products:fillEstimate reads the connection and never calls the AI', async () => {
    const claude = sectionClaude(() => '{"line":"x","page":""}')
    const ready = harness({ claude })
    const state = await ready.handlers['onboarding:saveProfile'](profile())
    const projectId = state.profile?.project.id ?? ''
    await expect(ready.handlers['products:fillEstimate']({ projectId })).resolves.toMatchObject({
      available: true,
      reason: null
    })
    expect(claude.requests).toHaveLength(0)
    cleanupHarness()
    const none = harness()
    const other = await none.handlers['onboarding:saveProfile'](profile())
    await expect(
      none.handlers['products:fillEstimate']({ projectId: other.profile?.project.id ?? '' })
    ).resolves.toMatchObject({ available: false })
    await expect(none.handlers['products:fillEstimate']({ projectId: 'nope' })).rejects.toThrow()
  })
})
