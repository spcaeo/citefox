// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CitationsScreen } from './CitationsScreen'
import { mockVisibilitySource } from './mocks'

afterEach(() => {
  cleanup()
})

const source = mockVisibilitySource()

describe('CitationsScreen withSharedSections', () => {
  it('shows the leaderboard sections by default', async () => {
    const view = render(
      <CitationsScreen source={source} projectId="textbolt" pageId="alerts" marketId="us" />
    )
    expect(await view.findByRole('heading', { name: 'Citations (links)' })).toBeTruthy()
    expect(view.getByRole('heading', { name: 'Who gets cited' })).toBeTruthy()
    expect(view.getByRole('heading', { name: 'Cited instead of you' })).toBeTruthy()
    expect(view.getByRole('heading', { name: 'Your other pages cited instead' })).toBeTruthy()
  })

  it('hides the sections the Results tab already shows', async () => {
    const view = render(
      <CitationsScreen
        source={source}
        projectId="textbolt"
        pageId="alerts"
        marketId="us"
        withSharedSections={false}
      />
    )
    expect(await view.findByRole('heading', { name: 'Sources Google listed' })).toBeTruthy()
    expect(view.queryByRole('heading', { name: 'Citations (links)' })).toBeNull()
    expect(view.queryByRole('heading', { name: 'Who gets cited' })).toBeNull()
    expect(view.queryByRole('heading', { name: 'Cited instead of you' })).toBeNull()
    expect(view.queryByRole('heading', { name: 'Your other pages cited instead' })).toBeNull()
    expect(view.getByRole('heading', { name: 'Sources Google listed' })).toBeTruthy()
  })
})
