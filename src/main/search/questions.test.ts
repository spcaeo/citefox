import { afterEach, describe, expect, test } from 'vitest'
import { TEXTBOLT_TOPIC_NAME } from '@shared/fixtures/textbolt-topic'
import { QUESTION_SEARCH_LIMIT } from '@shared/ipc'
import { closeSeeds, seed } from '../engine/checks/checks.test-helper'
import { getProject } from '../storage/records'
import { seedTextboltTopic } from '../topics/fixture-seed'
import { parseSearchQuestions } from './questions'

afterEach(() => {
  closeSeeds()
})

/** page-1 ("Alerts") and page-2 ("Second"), each with questions, plus the TextBolt topic when asked. */
async function seeded(
  withTopic = false
): Promise<Awaited<ReturnType<typeof seed>> & { topicId: string | null }> {
  const seededProject = await seed({
    progress: [],
    secondPage: true,
    secondPrompt: true,
    http: () => ({ status: 500, body: '{}' })
  })
  if (!withTopic) return { ...seededProject, topicId: null }
  const project = getProject(seededProject.storage.db, 'proj-1')
  if (project === null) throw new Error('no project')
  const { topicId } = seedTextboltTopic(seededProject.projectDb, project)
  return { ...seededProject, topicId }
}

describe('search:questions', () => {
  test('matches every word in any case, best match first, with the page it belongs to', async () => {
    const { handlers } = await seeded()
    const found = await handlers['search:questions']({ projectId: 'proj-1', query: 'ALERT  the' })
    expect(found.more).toBe(false)
    expect(found.questions).toEqual([
      {
        promptId: 'prompt-1',
        sourceId: 'page-1',
        sourceKind: 'page',
        sourceName: 'Alerts',
        text: 'How do I alert the crew?'
      },
      {
        promptId: 'prompt-2b',
        sourceId: 'page-2',
        sourceKind: 'page',
        sourceName: 'Second',
        text: 'How do I alert the second site?'
      }
    ])
    const anyOrder = await handlers['search:questions']({
      projectId: 'proj-1',
      query: 'crew alert'
    })
    expect(anyOrder.questions.map((hit) => hit.promptId)).toEqual(['prompt-1'])
  })

  test('finds topic questions under the topic name', async () => {
    const { handlers, projectDb, topicId } = await seeded(true)
    const text = projectDb
      .prepare<unknown[], { text: string }>(
        `SELECT v.text FROM prompt_variants v
         JOIN prompts p ON p.id = v.prompt_id
         JOIN prompt_sets s ON s.id = p.prompt_set_id AND s.is_active = 1
         WHERE s.page_id = ? ORDER BY p.position LIMIT 1`
      )
      .get(topicId)?.text
    if (!text) throw new Error('no topic question')
    const found = await handlers['search:questions']({ projectId: 'proj-1', query: text })
    expect(found.questions[0]).toMatchObject({
      sourceId: topicId,
      sourceKind: 'topic',
      sourceName: TEXTBOLT_TOPIC_NAME,
      text
    })
  })

  test('returns at most the limit and says when more match', async () => {
    const { handlers } = await seeded(true)
    const found = await handlers['search:questions']({ projectId: 'proj-1', query: 'e' })
    expect(found.questions).toHaveLength(QUESTION_SEARCH_LIMIT)
    expect(found.more).toBe(true)
  })

  test('ignores ** emphasis, keeps % and _ literal, and returns nothing for a blank query', async () => {
    const { handlers, projectDb } = await seeded()
    projectDb
      .prepare(`UPDATE prompt_variants SET text = ? WHERE prompt_id = 'prompt-1'`)
      .run('How do I **alert the crew**?')
    const bold = await handlers['search:questions']({
      projectId: 'proj-1',
      query: 'alert the crew'
    })
    expect(bold.questions.map((hit) => [hit.promptId, hit.text])).toEqual([
      ['prompt-1', 'How do I **alert the crew**?']
    ])
    for (const query of ['%', '_', '   ']) {
      const none = await handlers['search:questions']({ projectId: 'proj-1', query })
      expect(none).toEqual({ questions: [], more: false })
    }
  })

  test('leaves out removed pages and inactive prompt sets', async () => {
    const { handlers, projectDb } = await seeded()
    projectDb.prepare(`UPDATE pages SET status = 'removed' WHERE id = 'page-2'`).run()
    projectDb.prepare(`UPDATE prompt_sets SET is_active = 0 WHERE id = 'pset-1'`).run()
    const found = await handlers['search:questions']({ projectId: 'proj-1', query: 'alert the' })
    expect(found.questions).toEqual([])
  })

  test('rejects malformed requests and unknown projects', async () => {
    const { handlers } = await seeded()
    expect(() => parseSearchQuestions({ projectId: 'proj-1' })).toThrow()
    expect(() => parseSearchQuestions({ projectId: 'proj-1', query: 3 })).toThrow()
    expect(() => parseSearchQuestions({ projectId: 'proj-1', query: 'x'.repeat(201) })).toThrow()
    expect(() => parseSearchQuestions({ projectId: 'proj-1', query: 'a', extra: 1 })).toThrow()
    await expect(
      handlers['search:questions']({ projectId: 'missing', query: 'alert' })
    ).rejects.toThrow(/not found/)
  })
})
