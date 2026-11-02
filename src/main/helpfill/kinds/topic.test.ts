import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { SEED, seedAssistProject, type AssistSeed } from '../../assist/assist.test-helper'
import { cleanTopicRow } from './topic'

/**
 * New topic → Use your own ChatGPT (`kind: 'topic'`) through the real handlers on
 * the seeded TextBolt project: the prompt is project-wide (the topic does not exist
 * yet) and lists every tracked question; a pasted answer comes back as questions
 * with their stage, page and topic name, near-copies merged and brand rows set aside.
 */

const SCOPE = { pageId: null }

let seed: AssistSeed

beforeEach(async () => {
  seed = await seedAssistProject()
})

afterEach(() => {
  seed.close()
})

describe('helpfill topic kind', () => {
  test('the prompt: one topic, its questions with stage and page, nothing tracked repeated', async () => {
    const result = await seed.handlers['helpfill:prompt']({
      kind: 'topic',
      projectId: SEED.projectId,
      scope: SCOPE,
      count: null
    })
    expect(result.columns).toEqual(['question', 'stage', 'page', 'topic'])
    expect(result.tracked).toBe(3)
    const prompt = result.prompt
    expect(prompt.split('\n')[0]).toContain('You help a company plan one topic')
    expect(prompt).toContain('Business: textbolt.com.')
    expect(prompt).not.toMatch(/^(Page|Topic): /mu)
    expect(prompt).toContain('give the topic a short name, 2 to 6 words')
    expect(prompt).toContain('Write 12 questions a buyer with that problem would really type')
    expect(prompt).toContain('Never name TextBolt.')
    expect(prompt).toContain('stage = Problem | Options | Doubts | Fit | Compare | Decide')
    expect(prompt).toContain('topic = the topic name, the same on every row')
    expect(prompt).toContain('Reply with CSV only, this header:\nquestion,stage,page,topic')
    expect(prompt).toContain(`- ${SEED.ukPrompt}`)
    expect(prompt).not.toContain('- Crew alerts')
    expect(prompt).not.toMatch(/sk-|@textbolt\.com|\/Users\//u)
  })

  test('reads a pasted answer into questions with stage, page and topic', async () => {
    const text = `Here is your topic:

| question | stage | page | topic |
| --- | --- | --- | --- |
| Our carrier stopped email to text, how do alerts reach the night shift? | Problem | /email-to-sms/ | Carrier gateway shutdown |
| What replaces a carrier email-to-text gateway for a small office? | Options | /email-to-sms/ | Carrier gateway shutdown |
| What replaces a carrier email to text gateway for a small office | Options | /email-to-sms/ | Carrier gateway shutdown |
| Is TextBolt cheaper than a carrier gateway? | Compare | /pricing/ | Carrier gateway shutdown |
| ${SEED.prompts[1]} | Problem | / | Carrier gateway shutdown |

Let me know if you want more.`
    const result = await seed.handlers['helpfill:read']({
      kind: 'topic',
      projectId: SEED.projectId,
      scope: SCOPE,
      text
    })
    expect(result.counts).toEqual({ read: 5, tracked: 1, repeats: 1, setAside: 1, ready: 2 })
    expect(result.noun).toEqual(['question', 'questions'])
    expect(result.rows.map((row) => row.values)).toEqual([
      {
        question: 'Our carrier stopped email to text, how do alerts reach the night shift?',
        stage: 'problem',
        page: '/email-to-sms/',
        topic: 'Carrier gateway shutdown'
      },
      {
        question: 'What replaces a carrier email-to-text gateway for a small office?',
        stage: 'options',
        page: '/email-to-sms/',
        topic: 'Carrier gateway shutdown'
      }
    ])
    expect(result.setAside[0]?.values.question).toBe('Is TextBolt cheaper than a carrier gateway?')
  })

  test('a plain list still reads, with no topic name', async () => {
    const result = await seed.handlers['helpfill:read']({
      kind: 'topic',
      projectId: SEED.projectId,
      scope: SCOPE,
      text: '1. Problem: How do I text staff when the freezer alarm goes off?\n2. How much does an SMS gateway cost? (Compare)'
    })
    expect(result.rows.map((row) => [row.values.question, row.values.stage])).toEqual([
      ['How do I text staff when the freezer alarm goes off?', 'problem'],
      ['How much does an SMS gateway cost?', 'compare']
    ])
    expect(result.rows[0]?.values.topic).toBe('')
  })

  test('describe is not offered: the dialog writes with its own buyer-problem box', async () => {
    const estimate = await seed.handlers['helpfill:estimate']({
      kind: 'topic',
      projectId: SEED.projectId
    })
    expect(estimate.available).toBe(false)
  })

  test('cleanTopicRow keeps a short topic name and drops a row with no question', () => {
    expect(cleanTopicRow({ question: 'ok', topic: 'x' })).toBeNull()
    expect(
      cleanTopicRow({ question: 'Which gateway?', topic: ` ${'a'.repeat(200)} ` })?.topic
    ).toBe('a'.repeat(120))
  })
})
