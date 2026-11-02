import { afterEach, describe, expect, test } from 'vitest'
import { closeSeeds, seed } from '../engine/checks/checks.test-helper'
import { getProject } from '../storage/records'
import { seedTextboltTopic } from '../topics/fixture-seed'

afterEach(() => {
  closeSeeds()
})

async function seeded(): Promise<Awaited<ReturnType<typeof seed>> & { topicId: string }> {
  const seededProject = await seed({
    progress: [],
    secondPrompt: true,
    http: () => ({ status: 500, body: '{}' })
  })
  const project = getProject(seededProject.storage.db, 'proj-1')
  if (project === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(seededProject.projectDb, project)
  return { ...seededProject, topicId }
}

const LONG = 'How can a small plumbing business text every field crew at once?'

describe('questions:get', () => {
  test('reads one page question with its wordings, rules and facts', async () => {
    const { handlers } = await seeded()
    const detail = await handlers['questions:get']({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: 'prompt-2'
    })
    expect(detail).toMatchObject({
      sourceKind: 'page',
      promptId: 'prompt-2',
      label: 'Night',
      enabled: true,
      topicStage: null,
      topicKind: null,
      draftOpen: false,
      wordings: [
        {
          marketId: 'mkt-us',
          marketLabel: 'US · EN',
          isDefault: true,
          text: 'How do I reach the night shift?'
        }
      ]
    })
    expect(detail.rules.kind).toBe('buyer_prompt')
    expect(detail.rules.brands).toEqual(['TextBolt'])
  })

  test('follows an older id to the question in the active version', async () => {
    const { handlers } = await seeded()
    await handlers['questions:update']({
      projectId: 'proj-1',
      action: 'disable',
      items: [{ sourceId: 'page-1', promptId: 'prompt-1' }]
    })
    const detail = await handlers['questions:get']({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: 'prompt-1'
    })
    expect(detail.promptId).not.toBe('prompt-1')
    expect(detail.currentPromptId).toBe(detail.promptId)
    expect(detail.enabled).toBe(false)
  })
})

describe('questions:edit', () => {
  test('saves wording, name, source and pause as one version; Undo restores it', async () => {
    const { handlers } = await seeded()
    const before = await handlers['prompts:listSets']({ projectId: 'proj-1', pageId: 'page-1' })
    const edited = await handlers['questions:edit']({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: 'prompt-2',
      texts: [{ marketId: 'mkt-us', text: LONG }],
      label: 'Field crews',
      source: 'written_by_user',
      intentStage: 'trigger',
      enabled: false
    })
    expect(edited.changed).toBe(true)
    expect(edited.previousPromptId).toBe('prompt-2')
    expect(edited.restore).toEqual({
      sourceId: 'page-1',
      promptSetId: 'pset-1',
      replacedBy: expect.any(String)
    })
    const after = await handlers['prompts:listSets']({ projectId: 'proj-1', pageId: 'page-1' })
    expect(after.sets).toHaveLength(before.sets.length + 1)
    const detail = await handlers['questions:get']({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: edited.promptId
    })
    expect(detail).toMatchObject({
      label: 'Field crews',
      source: 'written_by_user',
      intentStage: 'trigger',
      enabled: false
    })
    expect(detail.wordings[0]?.text).toBe(LONG)

    if (edited.restore === null) throw new Error('no restore point')
    const undone = await handlers['questions:restore']({
      projectId: 'proj-1',
      points: [edited.restore]
    })
    expect(undone.restored).toBe(1)
    const back = await handlers['questions:get']({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: 'prompt-2'
    })
    expect(back).toMatchObject({ promptId: 'prompt-2', label: 'Night', enabled: true })

    // A second Undo of the same change finds a newer active version and leaves it.
    const again = await handlers['questions:restore']({
      projectId: 'proj-1',
      points: [edited.restore]
    })
    expect(again.restored).toBe(0)
    expect(again.skipped[0]?.reason).toMatch(/changed again/)
  })

  test('refuses wording that breaks the rules, and saves nothing for no change', async () => {
    const { handlers } = await seeded()
    await expect(
      handlers['questions:edit']({
        projectId: 'proj-1',
        sourceId: 'page-1',
        promptId: 'prompt-2',
        texts: [
          { marketId: 'mkt-us', text: 'How does TextBolt text every field crew at once today?' }
        ]
      })
    ).rejects.toThrow(/brand/i)
    const same = await handlers['questions:edit']({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: 'prompt-2',
      texts: [{ marketId: 'mkt-us', text: 'How do I reach the night shift?' }],
      label: 'Night'
    })
    expect(same).toMatchObject({ changed: false, restore: null, promptId: 'prompt-2' })
  })

  test('sets a topic question’s stage and wording; the topic keeps the question', async () => {
    const { handlers, topicId } = await seeded()
    const list = await handlers['questions:list']({ projectId: 'proj-1' })
    const row = list.rows.find(
      (item) => item.sourceId === topicId && item.promptKind === 'question'
    )
    if (row === undefined) throw new Error('no topic question')
    const edited = await handlers['questions:edit']({
      projectId: 'proj-1',
      sourceId: topicId,
      promptId: row.promptId,
      texts: [{ marketId: 'mkt-us', text: 'Which tool texts a whole crew from email?' }],
      topicStage: 'compare'
    })
    expect(edited.changed).toBe(true)
    const after = await handlers['questions:list']({ projectId: 'proj-1' })
    const moved = after.rows.find((item) => item.promptId === edited.promptId)
    expect(moved).toMatchObject({
      sourceId: topicId,
      text: 'Which tool texts a whole crew from email?',
      stage: 'compare'
    })
    expect(after.rows.filter((item) => item.sourceId === topicId)).toHaveLength(
      list.rows.filter((item) => item.sourceId === topicId).length
    )
  })

  test('rejects a malformed request', async () => {
    const { handlers } = await seeded()
    await expect(
      handlers['questions:edit']({
        projectId: 'proj-1',
        sourceId: 'page-1',
        promptId: 'prompt-2',
        topicStage: 'nope'
      } as never)
    ).rejects.toThrow()
    await expect(
      handlers['questions:restore']({ projectId: 'proj-1', points: [] })
    ).rejects.toThrow()
  })
})

describe('questions:update restore points', () => {
  test('Undo of a remove brings the question back', async () => {
    const { handlers } = await seeded()
    const removed = await handlers['questions:update']({
      projectId: 'proj-1',
      action: 'remove',
      items: [{ sourceId: 'page-1', promptId: 'prompt-2' }]
    })
    expect(removed.changed).toBe(1)
    const gone = await handlers['questions:list']({ projectId: 'proj-1' })
    expect(gone.rows.filter((row) => row.sourceId === 'page-1')).toHaveLength(1)
    await handlers['questions:restore']({ projectId: 'proj-1', points: removed.restore })
    const back = await handlers['questions:list']({ projectId: 'proj-1' })
    expect(back.rows.filter((row) => row.sourceId === 'page-1').map((row) => row.promptId)).toEqual(
      ['prompt-1', 'prompt-2']
    )
  })
})
