// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { expectEveryDrillMatches } from '../../drill/count.test-helper'
import { resetUndoToastForTests } from '../../ui/undoStore'
import { resetSuggestCache } from './hooks/useSuggestTopics'
import { TopicsScreen } from './TopicsScreen'
import { fakeTopicsSource } from './topics.fixtures.test-helper'

/**
 * Every count in the Topics List opens its list on the URL, and the list is as long as
 * the number clicked (NFR-14). The Tree and Grid counts are links (TopicsDashboard.test).
 */

beforeEach(() => {
  window.history.replaceState(null, '', '#/topics?view=list')
  resetSuggestCache()
})

afterEach(() => {
  cleanup()
  act(() => resetUndoToastForTests())
})

describe('Topics drills', () => {
  it('every count opens a list as long as the number', async () => {
    const view = render(
      <TopicsScreen projectId="proj-1" source={fakeTopicsSource()} viewStore={null} />
    )
    await view.findByRole('grid', { name: 'Topics' })
    const grid = await expectEveryDrillMatches(view.getByRole('grid', { name: 'Topics' }))
    expect(grid.some((item) => item.id.endsWith(':questions'))).toBe(true)
    expect(grid.some((item) => item.id.endsWith(':targets'))).toBe(true)
    // Opaque ids only: a target page's URL never lands in the drill id.
    for (const item of grid) expect(item.id).not.toMatch(/https?:|\//)
  })
})
