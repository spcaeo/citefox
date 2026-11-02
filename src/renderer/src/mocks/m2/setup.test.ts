import { describe, expect, test } from 'vitest'
import { SHIPPED_TEMPLATE_NAME } from '@shared/domain'
import { textboltCatalog } from './catalog'
import { createProjectMemory, resetM2Memory } from './memory'
import { createSetupStore, type SetupStore } from './setup'
import { createTemplate, templateUsage } from './templates'
import { ALERTS_CONTENT_HASH, ALERTS_SNAPSHOT_ID } from './textboltPage'

const PROJECT = 'textbolt'
const ALERTS = { projectId: PROJECT, pageId: 'alerts' }
const BULK = { projectId: PROJECT, pageId: 'bulk' }

function store(): SetupStore {
  return createSetupStore(createProjectMemory(textboltCatalog()))
}

describe('page setup store', () => {
  test('a failed read resolves with a next step and does not clear a missing snapshot', () => {
    const setup = store()
    const failed = setup.getRead(BULK)
    expect(failed?.nextStep).toBeTruthy()
    expect(failed?.snapshotReused).toBe(false)
    expect(failed?.id).toBeNull()
    expect(failed?.contentHash).toBeNull()
    expect(failed?.message.length).toBeGreaterThan(0)
    const page = createProjectMemory(textboltCatalog()).getPage(PROJECT, 'bulk')
    expect(page.snapshotId).toBeNull()
  })

  test('alerts read succeeds, and reading again reuses the snapshot', () => {
    const setup = store()
    const first = setup.getRead(ALERTS)
    expect(first?.nextStep).toBeNull()
    expect(first?.contentHash).toBe(ALERTS_CONTENT_HASH)
    expect(first?.id).toBe(ALERTS_SNAPSHOT_ID)
    expect(first?.snapshotReused).toBe(false)
    expect(first?.faqs.length).toBe(9)
    expect(first?.outline.length).toBeGreaterThan(0)
    const events: string[] = []
    const again = setup.readStart({ ...ALERTS, reader: 'auto', suppliedText: null }, (payload) => {
      events.push(`${payload.phase}:${payload.state}`)
    })
    expect(again.nextStep).toBeNull()
    expect(again.id).toBe(ALERTS_SNAPSHOT_ID)
    expect(again.contentHash).toBe(first?.contentHash)
    expect(again.snapshotReused).toBe(true)
    expect(again.message).toContain('Same snapshot')
    expect(events).toEqual([
      'fetch:running',
      'fetch:ok',
      'extract:running',
      'extract:ok',
      'summary:running',
      'summary:ok'
    ])
    expect(JSON.stringify(again)).not.toContain('suppliedText')
  })

  test('an empty file rejects, and a supplied file resolves without echoing the text', () => {
    const setup = store()
    expect(() =>
      setup.readStart({ ...BULK, reader: 'file', suppliedText: '   ' }, () => undefined)
    ).toThrow(/Choose a file/)
    const read = setup.readStart(
      {
        ...BULK,
        reader: 'file',
        suppliedText: 'Bulk SMS pricing\n\nPlans start at a flat monthly fee.'
      },
      () => undefined
    )
    expect(read.nextStep).toBeNull()
    expect(read.method).toBe('file')
    expect(read.snapshotReused).toBe(false)
    expect(JSON.stringify(read)).not.toContain('flat monthly fee')
  })

  test('buyer profile keeps template provenance', () => {
    const setup = store()
    const profile = setup.getProfile(ALERTS)
    expect(profile?.templateId).toBe('buyer-profile')
    expect(profile?.templateName).toBe(SHIPPED_TEMPLATE_NAME)
    expect(profile?.templateHash).toHaveLength(64)
    expect(profile?.templateUpdatedAt).toBeNull()
  })

  test('saving a dirty prompt set switches to the next version', () => {
    const setup = store()
    const prompt = setup.listPrompts(ALERTS).prompts[0]
    expect(prompt).toBeTruthy()
    if (!prompt) return
    const edited = setup.editPrompt({
      ...ALERTS,
      promptId: prompt.id,
      variant: { marketId: 'us', text: 'How do I text my crew without a new app?' }
    })
    expect(edited.dirty).toBe(true)
    expect(edited.version).toBe(2)
    expect(edited.nextVersion).toBe(3)
    expect(JSON.stringify(edited).toLowerCase()).not.toMatch(/\block\b/)
    const saved = setup.savePrompts(ALERTS)
    expect(saved.dirty).toBe(false)
    expect(saved.version).toBe(3)
  })

  test('prompt count above 1,000 is rejected', () => {
    const memory = createProjectMemory(textboltCatalog())
    expect(() => memory.updatePage({ ...ALERTS, promptCount: 1001 })).toThrow(
      'The maximum prompt count is 1000.'
    )
    expect(memory.updatePage({ ...ALERTS, promptCount: 1000 }).promptCount).toBe(1000)
  })

  test('coverage rows, done toggles, and reuse stay consistent', async () => {
    const setup = store()
    const matrix = setup.getGaps(ALERTS)
    expect(matrix).toBeTruthy()
    if (!matrix) return
    expect(matrix.rows.every((row) => row.actions.length >= 1)).toBe(true)
    expect(matrix.templateId).toBe('coverage')
    expect(matrix.templateUpdatedAt).toBeTruthy()
    const promptId = matrix.rows[0]?.promptId
    expect(promptId).toBeTruthy()
    if (!promptId) return
    expect(
      setup
        .setGapDone({ ...ALERTS, promptId, done: true })
        .rows.find((row) => row.promptId === promptId)?.done
    ).toBe(true)
    const again = await setup.generateGaps(ALERTS)
    expect(again.reused).toBe(true)
    expect(again.rows).toHaveLength(matrix.rows.length)
    const dumped = JSON.stringify({
      read: setup.getRead(ALERTS),
      profile: setup.getProfile(ALERTS),
      prompts: setup.listPrompts(ALERTS),
      gaps: again
    })
    expect(dumped).not.toMatch(/sk-|api key|secret|password|token|resolvedModel/i)
  })

  test('generate uses the app default unless a template id is picked', async () => {
    resetM2Memory()
    const setup = store()
    const profile = await setup.generateProfile(ALERTS)
    expect(profile.templateId).toBe('buyer-profile')
    expect(profile.templateName).toBe(SHIPPED_TEMPLATE_NAME)
    const copy = await createTemplate({
      kind: 'buyer_profile',
      name: 'Field buyer',
      fromId: 'buyer-profile'
    })
    const picked = await setup.generateProfile({ ...ALERTS, templateId: copy.id })
    expect(picked.templateName).toBe('Field buyer')
    expect((await templateUsage({ id: 'buyer-profile' })).buyerProfiles).toBe(1)
    expect((await templateUsage({ id: copy.id })).buyerProfiles).toBe(1)
    const prompts = await setup.generatePrompts(ALERTS)
    expect(prompts.templateName).toBe(SHIPPED_TEMPLATE_NAME)
    const gaps = await setup.generateGaps({ ...ALERTS, templateId: 'coverage' })
    expect(gaps.templateName).toBe(SHIPPED_TEMPLATE_NAME)
    expect(gaps.reused).toBe(false)
  })
})
