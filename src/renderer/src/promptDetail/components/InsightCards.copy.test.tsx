// @vitest-environment happy-dom
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { setFetchIconsForTests } from '../../siteIcon/loader'
import type { PromptTimeRow } from '../types'
import { TimelineCard } from './InsightCards'

afterEach(() => {
  cleanup()
  setFetchIconsForTests(null)
})

const ROW: PromptTimeRow = {
  runId: 'run-1',
  finishedAt: '2026-11-01T10:00:00.000Z',
  status: 'page_cited',
  position: 2,
  partial: false,
  first: true,
  contentChanged: false,
  promptId: null,
  earlierWording: null,
  ownPages: [{ url: 'https://example.com/pricing/', position: 2, target: true }]
}

describe('This prompt over time: your pages Google cited', () => {
  it('shows each page as a site path with Copy and Open (owner rule)', () => {
    setFetchIconsForTests(() => Promise.resolve({ icons: [] }))
    const view = render(<TimelineCard pageId="p1" rows={[ROW]} />)
    const cell = view.container.querySelector('.pd2-own-page') as HTMLElement
    expect(cell).not.toBeNull()
    const url = cell.querySelector('[data-url-text]') as HTMLElement
    expect(url).not.toBeNull()
    expect(within(url).getByRole('button', { name: /^Copy \/pricing\// })).toBeTruthy()
    expect(url.querySelector('.ui-url-actions a[target="_blank"]')).not.toBeNull()
  })
})
