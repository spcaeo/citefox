import { describe, expect, it } from 'vitest'
import type { AssistantContextInput } from '@shared/ipc'
import { routeIntent } from './intent'

function context(screen: string): AssistantContextInput {
  return {
    screen,
    screenLabel: screen,
    crumbs: [],
    pageId: null,
    topicId: null,
    promptId: null,
    marketId: null,
    runId: null,
    about: null,
    entities: [],
    selection: [],
    filters: {},
    numbers: [],
    facts: [],
    capabilities: []
  }
}

describe('routeIntent', () => {
  it.each([
    ['Draft an answer for this question', 'draft'],
    ['Rewrite it the way buyers ask', 'questions'],
    ['Suggest 5 similar questions', 'questions'],
    ['Summarise this project for my client in 5 lines', 'summary'],
    ['Which questions are not cited in any market?', 'list'],
    ["Why isn't my page cited for this?", 'why_not_cited'],
    ['Who is cited instead of me most often?', 'why_not_cited'],
    ['What changed since the last check?', 'changes'],
    ['What should I fix first this week?', 'next_steps'],
    ['How do I reach the 50–70% band?', 'next_steps'],
    ['Explain this number', 'explain']
  ])('“%s” goes to %s', (question, intent) => {
    expect(routeIntent(question, context('overview'))).toBe(intent)
  })

  it('answers app questions on settings screens with the help prompt', () => {
    expect(routeIntent('What does this setting do?', context('settings'))).toBe('help')
    expect(routeIntent('Is my Claude connection working?', context('connections'))).toBe('help')
    expect(routeIntent('Tell me something', context('overview'))).toBe('explain')
  })
})
