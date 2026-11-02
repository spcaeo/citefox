// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StructureInsight } from '@shared/domain'
import { DrillHost } from '../../drill'
import type { StructureDrills } from '../hooks/useStructureDrills'
import { Insights } from './Insights'

afterEach(() => {
  cleanup()
})

function flag(pageIds: readonly string[], pageCount: number): StructureInsight {
  return {
    id: 'template_pages:abc',
    kind: 'template_pages',
    title: `${pageCount} template pages differ only by one word`,
    body: 'Pages like these follow one pattern.',
    pageIds,
    pageCount,
    pages: pageIds.slice(0, 2).map((id) => ({ id, label: id })),
    clusterId: null
  }
}

function show(insight: StructureInsight): void {
  const drills = { pagesById: vi.fn() } as unknown as StructureDrills
  render(
    <DrillHost>
      <Insights insights={[insight]} drills={drills} />
    </DrillHost>
  )
}

describe('Insights', () => {
  it('says "All" only when the flag lists every page', () => {
    show(flag(['a', 'b', 'c'], 3))
    expect(screen.getByRole('button', { name: /^All 3 pages:/ })).toBeTruthy()
  })

  it('does not call a capped list "All" (25 pages, 20 listed)', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `p${index}`)
    show(flag(ids, 25))
    const drill = screen.getByRole('button', { name: /^20 of 25 pages:/ })
    expect(drill.textContent).toBe('20 of 25 pages')
    expect(screen.queryByRole('button', { name: /^All / })).toBeNull()
  })
})
