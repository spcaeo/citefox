// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { questionRow, questionsList } from '../questions/questions.fixtures.test-helper'
import { kpiRows, questionsKpiDrill } from '../questions/drills'
import { questionKpis } from '../questions/model'
import { InlineQuestionEdit } from '../questions/components/InlineEdit'
import { axeViolations } from '../ui/axe.test-helper'
import { UndoToastHost } from '../ui/UndoToast'
import { resetUndoToastForTests } from '../ui/undoStore'
import { EditQuestionDrawer } from './EditQuestionDrawer'
import { MoveQuestionsDrawer } from './MoveQuestionsDrawer'
import { fakeEditSource, questionDetail } from './questionEdit.fixtures.test-helper'

beforeEach(() => {
  window.history.replaceState(null, '', '#/questions')
})

afterEach(() => {
  cleanup()
  resetUndoToastForTests()
})

const LONGER = 'what does a business texting app cost each month for a team of ten people'

describe('EditQuestionDrawer', () => {
  it('saves every change as one version, then offers Undo', async () => {
    const source = fakeEditSource()
    const onClose = vi.fn()
    const view = render(
      <>
        <EditQuestionDrawer
          source={source}
          projectId="proj-1"
          sourceId="page-1"
          promptId="p-1"
          tab={null}
          onTab={vi.fn()}
          onClose={onClose}
        />
        <UndoToastHost />
      </>
    )
    const box = await view.findByLabelText('Wording in US · EN')
    const save = view.getByRole('button', { name: 'Save' })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'too short' } })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(box, { target: { value: LONGER } })
    expect(view.getByText(/2 changes · saved as one new version/)).toBeTruthy()
    expect(await axeViolations(view.container)).toEqual([])
    fireEvent.click(save)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(source['questions:edit']).toHaveBeenCalledWith({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: 'p-1',
      texts: [
        { marketId: 'm-us', text: LONGER },
        { marketId: 'm-uk', text: LONGER }
      ]
    })
    await view.findByText('Saved the question as a new version.')
    fireEvent.click(view.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(source['questions:restore']).toHaveBeenCalled())
  })

  it('removes at once from the footer', async () => {
    const source = fakeEditSource()
    const onClose = vi.fn()
    const view = render(
      <EditQuestionDrawer
        source={source}
        projectId="proj-1"
        sourceId="page-1"
        promptId="p-1"
        tab={null}
        onTab={vi.fn()}
        onClose={onClose}
      />
    )
    fireEvent.click(await view.findByRole('button', { name: 'Remove question' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(source['questions:update']).toHaveBeenCalledWith({
      projectId: 'proj-1',
      action: 'remove',
      items: [{ sourceId: 'page-1', promptId: 'p-1' }]
    })
  })

  it('blocks saving while the page has unsaved Questions edits', async () => {
    const source = fakeEditSource(questionDetail({ draftOpen: true }))
    const view = render(
      <EditQuestionDrawer
        source={source}
        projectId="proj-1"
        sourceId="page-1"
        promptId="p-1"
        tab={null}
        onTab={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const box = (await view.findByLabelText('Wording in US · EN')) as HTMLTextAreaElement
    expect(box.disabled).toBe(true)
    expect((view.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('MoveQuestionsDrawer', () => {
  it('moves the picked questions to a topic', async () => {
    const source = fakeEditSource()
    const onDone = vi.fn()
    const view = render(
      <MoveQuestionsDrawer
        source={source}
        projectId="proj-1"
        refs={[{ sourceId: 'page-1', promptId: 'p-1' }]}
        mode="move"
        depth={0}
        onMode={vi.fn()}
        onClose={vi.fn()}
        onDone={onDone}
      />
    )
    const group = await view.findByRole('radiogroup', { name: 'Move to' })
    fireEvent.click(within(group).getByLabelText(/Text alerts/))
    fireEvent.click(view.getByRole('button', { name: 'Move 1 question' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(source['topics:moveQuestions']).toHaveBeenCalledWith({
      projectId: 'proj-1',
      items: [{ sourceId: 'page-1', promptId: 'p-1' }],
      to: { kind: 'topic', topicId: 'topic-2' }
    })
  })

  it('duplicates into another page', async () => {
    const source = fakeEditSource()
    const onDone = vi.fn()
    const view = render(
      <MoveQuestionsDrawer
        source={source}
        projectId="proj-1"
        refs={[{ sourceId: 'page-1', promptId: 'p-1' }]}
        mode="copy"
        depth={0}
        onMode={vi.fn()}
        onClose={vi.fn()}
        onDone={onDone}
      />
    )
    const group = await view.findByRole('radiogroup', { name: 'Duplicate into' })
    fireEvent.click(within(group).getByLabelText(/Features/))
    fireEvent.click(view.getByRole('button', { name: 'Copy 1 question' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(source['prompts:addQuestions']).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', pageId: 'page-2' })
    )
  })
})

describe('InlineQuestionEdit', () => {
  it('counts words, checks the rules, saves on Enter and cancels on Escape', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    const row = questionRow({
      promptId: 'p-1',
      sourceId: 'page-1',
      text: 'how much does a texting app cost for a small team'
    })
    const view = render(
      <InlineQuestionEdit
        row={row}
        rules={{ kind: 'buyer_prompt', minWords: 8, maxWords: 32, brands: ['TextBolt'] }}
        busy={false}
        onSave={onSave}
        onCancel={onCancel}
      />
    )
    const input = view.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'too short' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    expect(view.getByRole('status').hasAttribute('data-problem')).toBe(true)
    fireEvent.change(input, { target: { value: LONGER } })
    expect(view.getByRole('status').textContent ?? '').toContain('15 words')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith(LONGER)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('Questions KPI drills', () => {
  it('lists exactly the questions each tile counts', () => {
    const list = questionsList()
    const sources = new Map(list.sources.map((source) => [source.id, source]))
    const kpis = questionKpis(list.rows)
    expect(kpiRows(list.rows, 'tracked')).toHaveLength(kpis.tracked)
    expect(kpiRows(list.rows, 'overviews')).toHaveLength(kpis.overviews)
    expect(kpiRows(list.rows, 'cited')).toHaveLength(kpis.cited)
    expect(kpiRows(list.rows, 'named')).toHaveLength(kpis.named)
    expect(kpiRows(list.rows, 'off')).toHaveLength(list.rows.length - kpis.tracked)
    const drill = questionsKpiDrill('off', list, sources, 'US · EN')
    expect(drill.items.map((item) => item.primary)).toEqual(['sms pricing per message'])
    expect(drill.items[0]?.cells?.result).toBe('Left out')
  })
})
