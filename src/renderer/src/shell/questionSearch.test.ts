import { describe, expect, it } from 'vitest'
import { QUESTION_SEARCH_LIMIT } from '@shared/ipc'
import { textboltCatalog } from '../mocks/m2/catalog'
import { memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockShellClient } from '../projects/mockClient'
import { createQuestionSearchSource, createShellQuestionSearch } from './questionSearch'

function mockSearch(): ReturnType<typeof createShellQuestionSearch> {
  return createShellQuestionSearch(
    createMockShellClient({
      catalog: textboltCatalog(),
      activeStore: memoryActiveProjectStore('textbolt'),
      initialFinished: true
    })
  )
}

describe('question search sources', () => {
  it('rejects, not throws, without the preload bridge', async () => {
    await expect(
      createQuestionSearchSource()['search:questions']({ projectId: 'textbolt', query: 'sms' })
    ).rejects.toThrow('The preload bridge is missing.')
  })

  it('matches every word of the mock project questions, any case, with their page', async () => {
    const search = mockSearch()
    const found = await search['search:questions']({
      projectId: 'textbolt',
      query: 'developers TWILIO'
    })
    expect(found).toEqual({
      questions: [
        {
          promptId: expect.any(String),
          sourceId: 'alerts',
          sourceKind: 'page',
          sourceName: 'Text alerts for business',
          text: "What's a cheap alternative to Twilio for sending business text alerts if we don't have developers?"
        }
      ],
      more: false
    })
    const blank = await search['search:questions']({ projectId: 'textbolt', query: '  ' })
    expect(blank).toEqual({ questions: [], more: false })
  })

  it('puts the earliest match first and caps the list', async () => {
    const search = mockSearch()
    const alerts = await search['search:questions']({ projectId: 'textbolt', query: 'text alerts' })
    expect(alerts.questions[0]?.text).toMatch(/^How can I send text alerts to my employees/)
    const broad = await search['search:questions']({ projectId: 'textbolt', query: 'a' })
    expect(broad.questions).toHaveLength(QUESTION_SEARCH_LIMIT)
    expect(broad.more).toBe(true)
  })
})
