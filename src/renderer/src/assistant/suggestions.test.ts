import { describe, expect, it } from 'vitest'
import type { AiContext } from './context/types'
import { suggestionsFor } from './suggestions'

function context(screen: string, patch: Partial<AiContext> = {}): AiContext {
  return {
    screen,
    screenLabel: screen,
    route: '#/',
    crumbs: [],
    projectId: 'proj-1',
    projectName: 'TextBolt',
    pageId: null,
    topicId: null,
    promptId: null,
    marketId: null,
    runId: null,
    entities: [],
    selection: [],
    filters: {},
    numbers: [],
    facts: [],
    capabilities: [],
    ...patch
  }
}

const SCREENS = [
  'overview',
  'questions',
  'topics',
  'topic.todo',
  'topic.progress',
  'page.results',
  'page.sentiment',
  'page.communities',
  'page.history',
  'prompt',
  'competitors',
  'history',
  'youtube',
  'communities',
  'check',
  'alerts',
  'export',
  'project-settings',
  'connections',
  'permissions',
  'playground',
  'projects',
  'templates',
  'drawer.add-questions',
  'drawer.drill',
  'some-new-screen'
]

describe('suggestionsFor', () => {
  it.each(SCREENS)('%s gets 3 to 5 suggestions', (screen) => {
    const out = suggestionsFor(context(screen))
    expect(out.length).toBeGreaterThanOrEqual(3)
    expect(out.length).toBeLessThanOrEqual(5)
    expect(new Set(out).size).toBe(out.length)
  })

  it('differs from screen to screen', () => {
    const seen = new Set(SCREENS.map((screen) => suggestionsFor(context(screen)).join('|')))
    expect(seen.size).toBeGreaterThan(SCREENS.length - 4)
  })

  it('names what the screen shows: a rival, a topic, a picked row', () => {
    expect(
      suggestionsFor(
        context('overview', { entities: [{ kind: 'domain', label: 'simpletexting.com' }] })
      )
    ).toContain('Why is simpletexting.com ahead of me?')
    expect(
      suggestionsFor(
        context('topic.todo', { entities: [{ kind: 'topic', id: 't', label: 'Gateways' }] })
      ).join(' ')
    ).toContain('“Gateways”')
    const picked = suggestionsFor(
      context('questions', {
        selection: [
          { kind: 'question', id: 'q1', label: 'One' },
          { kind: 'question', id: 'q2', label: 'Two' }
        ]
      })
    )
    expect(picked[0]).toBe('Group these 2 questions into topics')
    expect(
      suggestionsFor(
        context('page.results', { selection: [{ kind: 'question', id: 'q1', label: 'How?' }] })
      )[0]
    ).toBe("Why isn't my page cited for “How?”?")
  })
})

describe('suggestions with no project open', () => {
  it('are about CiteFox itself and setting up', () => {
    const lines = suggestionsFor(context('overview', { projectId: null, projectName: null }))
    expect(lines[0]).toBe('How do I start tracking my site?')
    expect(lines).toContain('How many searches do I have left?')
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(lines.length).toBeLessThanOrEqual(5)
    // Nothing that needs a project's checks.
    expect(lines.join(' ')).not.toMatch(/fix first|cited|client/i)
  })

  it("keep an app screen's own help questions first", () => {
    const lines = suggestionsFor(context('connections', { projectId: null, projectName: null }))
    expect(lines[0]).toBe('Is my AI connection working?')
    expect(lines).toContain('How do I start tracking my site?')
  })
})
