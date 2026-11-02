// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { CoverageMatrix, CoverageRecord } from '@shared/domain'
import { textboltCatalog } from '../mocks/m2/catalog'
import { createProjectMemory, memoryActiveProjectStore } from '../mocks/m2/memory'
import { createMockAssistClient } from '../assist/client'
import type { ShellClient } from '../projects/client'
import { createMockShellClient } from '../projects/mockClient'
import { createMockTemplatesClient } from '../templates/client'
import { GapsScreen } from './GapsScreen'

afterEach(cleanup)

function row(index: number): CoverageRecord {
  return {
    id: `row-${index}`,
    runId: 'run-1',
    pageId: 'alerts',
    promptId: `prompt-${index}`,
    coverage: 'weak',
    whereCovered: [],
    currentContent: 'One line.',
    whatToUpdate: 'Add a section.',
    mainGap: 'No answer.',
    priority: 'high',
    actions: ['update_existing'],
    suggestedFaq: null,
    done: false
  }
}

describe('Coverage matrix', () => {
  it('virtualizes a long matrix instead of rendering every row', async () => {
    const base = createMockShellClient({
      catalog: textboltCatalog(),
      activeStore: memoryActiveProjectStore()
    })
    const matrix: CoverageMatrix = {
      runId: 'run-1',
      pageId: 'alerts',
      recordedAt: '2026-10-19T09:00:00.000Z',
      templateId: 'tpl',
      templateName: 'Shipped',
      templateHash: 'a'.repeat(64),
      templateUpdatedAt: null,
      contentHash: 'b'.repeat(64),
      reused: false,
      stale: false,
      rows: Array.from({ length: 200 }, (_, index) => row(index)),
      findings: []
    }
    const client: ShellClient = { ...base, getGaps: () => Promise.resolve(matrix) }
    const page = createProjectMemory(textboltCatalog()).getPage('textbolt', 'alerts')
    const view = render(
      <GapsScreen
        client={client}
        templatesClient={createMockTemplatesClient()}
        projectId="textbolt"
        page={page}
        marketId="us"
        assistClient={createMockAssistClient()}
      />
    )
    const grid = await view.findByRole('grid', { name: 'Coverage matrix' })
    const rendered = grid.querySelectorAll('[data-row]').length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(40)
    expect(Number.parseFloat(grid.style.maxHeight)).toBeLessThanOrEqual(600)
  })
})
