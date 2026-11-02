// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuildToolsContext, ipcBuildClient } from '../buildMenu/buildClient'
import { MOCK_CATALOG_STORAGE_KEY } from '../onboarding/flags'
import { AddQuestionsDialog } from './AddQuestionsDialog'
import { createMockAddQuestionsSource, resetMockAddQuestions } from './mockSource'
import { createAddQuestionsSource } from './source'

/**
 * W3I-G: on the mock build, Add questions read its pages from the real main
 * process, which does not know the mock catalog's projects ("That project was
 * not found"). In mock mode it now answers from the mock catalog.
 */

beforeEach(() => {
  localStorage.setItem(MOCK_CATALOG_STORAGE_KEY, 'textbolt')
  resetMockAddQuestions()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('Add questions on the mock catalog', () => {
  it('lists the mock project’s tracked pages and never calls the preload bridge', async () => {
    const bridge = new Proxy(
      {},
      {
        get: () => () => Promise.reject(new Error('That project was not found'))
      }
    )
    vi.stubGlobal('citefox', bridge)
    const source = createAddQuestionsSource('mock')
    const loaded = await source['prompts:addTargets']({ projectId: 'textbolt' })
    expect(loaded.projectId).toBe('textbolt')
    expect(loaded.targets.length).toBeGreaterThan(0)
    expect(loaded.targets.some((item) => item.status === 'tracked')).toBe(true)
    expect(loaded.markets.length).toBeGreaterThan(0)
  })

  it('still refuses a project the mock does not have', async () => {
    await expect(
      createMockAddQuestionsSource()['prompts:addTargets']({ projectId: 'nope' })
    ).rejects.toThrow('No project with that id')
  })

  it('checks rows, adds them as one batch, flags them as tracked after, and undoes', async () => {
    const source = createMockAddQuestionsSource()
    const { targets } = await source['prompts:addTargets']({ projectId: 'textbolt' })
    const page = targets.find((item) => item.status === 'tracked')
    expect(page).toBeDefined()
    const targetId = page?.id ?? ''
    const rules = { keywords: true }
    const text = 'What is the best text alert service for a clinic?'
    const checked = await source['import:validate']({
      projectId: 'textbolt',
      entity: 'questions',
      targetId,
      rules,
      rows: [
        { key: 'a', values: { question: text } },
        { key: 'b', values: { question: `${text.toUpperCase()}` } },
        { key: 'c', values: { question: ' ' } }
      ]
    })
    expect(checked.rows.map((row) => row.result)).toEqual(['new', 'duplicate', 'fix'])
    expect(checked.counts).toMatchObject({ new: 1, duplicate: 1, fix: 1, total: 3 })

    const committed = await source['import:commit']({
      projectId: 'textbolt',
      entity: 'questions',
      targetId,
      rules,
      rows: [{ values: { question: text }, keep: false }]
    })
    expect(committed.added).toBe(1)
    expect(committed.promptIds[0]?.sourceId).toBe(targetId)
    const again = await source['import:validate']({
      projectId: 'textbolt',
      entity: 'questions',
      targetId,
      rules,
      rows: [{ key: 'a', values: { question: text } }]
    })
    expect(again.rows[0]?.result).toBe('duplicate')
    const after = await source['prompts:addTargets']({ projectId: 'textbolt' })
    expect(after.targets.find((item) => item.id === targetId)?.questions).toBe(
      (page?.questions ?? 0) + 1
    )

    const undone = await source['import:undo']({
      projectId: 'textbolt',
      batchId: committed.batchId ?? ''
    })
    expect(undone.removed).toBe(1)
  })

  it('renders the drawer with the mock pages and no load error', async () => {
    render(
      <BuildToolsContext.Provider value={{ client: ipcBuildClient, notify: () => undefined }}>
        <AddQuestionsDialog
          projectId="textbolt"
          targetId={null}
          kindHint={null}
          source={createAddQuestionsSource('mock')}
          onClose={() => undefined}
        />
      </BuildToolsContext.Provider>
    )
    await waitFor(() =>
      expect((screen.getByTestId('aq-target') as HTMLSelectElement).value).not.toBe('')
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toContain('That project was not found')
    fireEvent.change(screen.getByLabelText('Question 1'), {
      target: { value: 'What is the best text alert service for a clinic?' }
    })
    await waitFor(() =>
      expect(screen.getByTestId('add-questions-drawer').textContent).toContain('1 to add')
    )
  })
})
