// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { KpiTile } from '../../ui'
import { currentAiContext, resetAiContext, setAiBase } from '../context/store'
import type { AiContextBase } from '../context/types'
import { AiSlotProvider } from './AiSlotProvider'
import { sparkleQuestions } from './questions'

const BASE: AiContextBase = {
  screen: 'prompt',
  screenLabel: 'Question detail',
  route: '#/pages/page-1/prompt/prompt-1',
  crumbs: ['TextBolt', 'Text alerts for business', 'Question'],
  projectId: 'proj-1',
  projectName: 'TextBolt',
  pageId: 'page-1',
  topicId: null,
  promptId: 'prompt-1',
  marketId: null,
  runId: null,
  filters: {}
}

afterEach(() => {
  cleanup()
  resetAiContext()
})

describe('KPI ✦ questions', () => {
  test('carry the tile value: "Why is citation share 14%?"', () => {
    const lines = sparkleQuestions({ kind: 'kpi', label: 'Citation share', detail: '14%' })
    expect(lines[0]).toBe('Explain this number: Citation share (14%)')
    expect(lines).toContain('Why is citation share 14%?')
    expect(lines.length).toBeLessThanOrEqual(5)
  })

  test('keep an acronym label as written and add no value question without a value', () => {
    expect(sparkleQuestions({ kind: 'kpi', label: 'AI Overviews', detail: '7' })).toContain(
      'Why is AI Overviews 7?'
    )
    const bare = sparkleQuestions({ kind: 'kpi', label: 'Status' })
    expect(bare[0]).toBe('Explain this number: Status')
    expect(bare.some((line) => line.startsWith('Why is'))).toBe(false)
  })

  test('a Status tile drawn in the shell reads its value and asks about it', async () => {
    setAiBase(BASE)
    render(
      <AiSlotProvider>
        <KpiTile
          label="Status"
          value={
            <button type="button" className="drill-num">
              Cited
            </button>
          }
        />
      </AiSlotProvider>
    )
    // The value is read after the tile mounts (the ✦ sits before the number).
    await waitFor(() =>
      expect(currentAiContext().numbers).toContainEqual({
        label: 'Status',
        value: 'Cited',
        drill: null
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ask CiteFox about Status' }))
    expect(
      await screen.findByRole('menuitem', { name: 'Explain this number: Status (Cited)' })
    ).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Why is status Cited?' })).toBeTruthy()
  })
})
