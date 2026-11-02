// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UndoToastHost } from '../ui/UndoToast'
import { resetUndoToastForTests, runUndo, useUndoToast } from '../ui/undoStore'
import {
  blockingProblem,
  changeCount,
  editRequest,
  formFrom,
  withSameEverywhere,
  withText
} from './editModel'
import { questionMenuItems } from './menu'
import { decodeRefs, encodeRefs } from './open'
import { moveQuestions, setBuyerStage, setStage, updateQuestions } from './ops'
import { recheckPlanOf } from './recheck'
import { fakeEditSource, questionDetail } from './questionEdit.fixtures.test-helper'

afterEach(() => {
  cleanup()
  resetUndoToastForTests()
})

/** The toast now shown, read through the store. */
function toast(): ReturnType<typeof useUndoToast> {
  let state: ReturnType<typeof useUndoToast> = null
  function Probe(): null {
    state = useUndoToast()
    return null
  }
  render(createElement('div', null, createElement(Probe), createElement(UndoToastHost)))
  return state
}

describe('edit model', () => {
  it('saves only what changed, as one request', () => {
    const detail = questionDetail()
    const form = formFrom(detail)
    expect(form.sameEverywhere).toBe(true)
    expect(editRequest(detail, form)).toBeNull()
    const text = 'what does a business texting app cost each month for a team of ten'
    const next = { ...withText(form, 'm-us', text), intentStage: 'problem' as const }
    const request = editRequest(detail, next)
    expect(request).toEqual({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: 'p-1',
      texts: [
        { marketId: 'm-us', text },
        { marketId: 'm-uk', text }
      ],
      intentStage: 'problem'
    })
    expect(changeCount(request)).toBe(3)
  })

  it('edits one market once "every market" is off, and checks the wording rules', () => {
    const detail = questionDetail()
    const own = withSameEverywhere(formFrom(detail), false, 'm-us')
    const short = withText(own, 'm-uk', 'too short')
    expect(short.texts['m-us']).toBe(detail.wordings[0]?.text)
    expect(blockingProblem(detail, short)).toMatch(/8/)
    expect(
      blockingProblem(
        detail,
        withText(own, 'm-uk', 'is TextBolt any good for sending texts to a team')
      )
    ).toMatch(/TextBolt|brand/i)
    expect(blockingProblem(detail, { ...own, label: ' ' })).toBe('Give the question a name.')
  })

  it('sends a topic stage only for a topic question', () => {
    const topic = questionDetail({
      sourceKind: 'topic',
      topicKind: 'question',
      topicStage: 'options',
      rules: { kind: 'question', minWords: 1, maxWords: 32, brands: [] }
    })
    const request = editRequest(topic, { ...formFrom(topic), topicStage: 'decide', label: 'x' })
    expect(request).toEqual({
      projectId: 'proj-1',
      sourceId: 'page-1',
      promptId: 'p-1',
      topicStage: 'decide'
    })
  })
})

describe('question refs and menu', () => {
  it('round-trips refs on the URL and drops broken ones', () => {
    const refs = [
      { sourceId: 'page-1', promptId: 'p-1' },
      { sourceId: 'topic-1', promptId: 'p-t1' }
    ]
    expect(decodeRefs(encodeRefs(refs))).toEqual(refs)
    expect(decodeRefs('~p,page-1~,ok~yes')).toEqual([{ sourceId: 'ok', promptId: 'yes' }])
  })

  it('keeps the standard order and shows stages only in a topic', () => {
    const handlers = {
      onOpen: vi.fn(),
      onEdit: vi.fn(),
      onCopyText: vi.fn(),
      onDuplicate: vi.fn(),
      onMove: vi.fn(),
      onSetStage: vi.fn(),
      onToggle: vi.fn(),
      onRemove: vi.fn()
    }
    const base = { sourceId: 'page-1', promptId: 'p-1', text: 'q', enabled: true, stage: null }
    const page = questionMenuItems({ ...base, inTopic: false }, handlers).map((item) => item.id)
    expect(page).toEqual(['open', 'edit', 'copy', 'duplicate', 'move', 'toggle', 'remove'])
    const topic = questionMenuItems({ ...base, inTopic: true, stage: 'options' }, handlers)
    expect(topic.filter((item) => item.id.startsWith('stage:')).length).toBeGreaterThan(1)
    expect(topic.find((item) => item.id === 'stage:options')?.disabled).toBe(true)
    expect(topic.at(-1)?.tone).toBe('danger')
  })
})

describe('question actions with Undo', () => {
  it('removes, then Undo restores the earlier version', async () => {
    const source = fakeEditSource()
    const changed = await updateQuestions(source, 'proj-1', 'remove', [
      { sourceId: 'page-1', promptId: 'p-1' }
    ])
    expect(changed).toBe(1)
    const shown = toast()
    expect(shown?.spec.message).toBe('Removed 1 question.')
    await runUndo(shown?.id ?? -1)
    expect(source['questions:restore']).toHaveBeenCalledWith({
      projectId: 'proj-1',
      points: [{ sourceId: 'page-1', promptSetId: 'set-1', replacedBy: 'set-2' }]
    })
  })

  it('Undo of a stage change puts each old stage back', async () => {
    const source = fakeEditSource()
    await setStage(
      source,
      'proj-1',
      [
        { sourceId: 'topic-1', promptId: 'a', previous: 'options' },
        { sourceId: 'topic-1', promptId: 'b', previous: null }
      ],
      'decide'
    )
    await runUndo(toast()?.id ?? -1)
    const calls = source['topics:setQuestionStage'].mock.calls.map((call) => call[0])
    expect(calls.slice(1)).toEqual([
      { projectId: 'proj-1', items: [{ sourceId: 'topic-1', promptId: 'a' }], stage: 'options' },
      { projectId: 'proj-1', items: [{ sourceId: 'topic-1', promptId: 'b' }], stage: null }
    ])
  })

  it('Undo of a move moves each question back to where it was', async () => {
    const source = fakeEditSource()
    source['questions:list'].mockResolvedValueOnce({
      rows: [
        { promptId: 'p-1-moved', sourceId: 'topic-2' },
        { promptId: 'p-t1-moved', sourceId: 'topic-2' }
      ]
    } as never)
    await moveQuestions(
      source,
      'proj-1',
      [
        { sourceId: 'page-1', promptId: 'p-1', fromTopicId: null },
        { sourceId: 'topic-1', promptId: 'p-t1', fromTopicId: 'topic-1' }
      ],
      { kind: 'topic', topicId: 'topic-2' }
    )
    await runUndo(toast()?.id ?? -1)
    const back = source['topics:moveQuestions'].mock.calls.slice(1).map((call) => call[0])
    expect(back).toEqual([
      {
        projectId: 'proj-1',
        items: [{ sourceId: 'topic-2', promptId: 'p-1-moved' }],
        to: { kind: 'page' }
      },
      {
        projectId: 'proj-1',
        items: [{ sourceId: 'topic-2', promptId: 'p-t1-moved' }],
        to: { kind: 'topic', topicId: 'topic-1' }
      }
    ])
  })

  it('sets buyer stages one version each and undoes newest first', async () => {
    const source = fakeEditSource()
    let n = 0
    source['questions:edit'].mockImplementation(async (request: { sourceId: string }) => {
      n += 1
      return {
        sourceId: request.sourceId,
        promptId: `x${n}`,
        previousPromptId: 'p',
        changed: true,
        restore: {
          sourceId: request.sourceId,
          promptSetId: `set-${n}`,
          replacedBy: `set-${n + 1}`
        },
        message: ''
      }
    })
    const done = await setBuyerStage(
      source,
      'proj-1',
      [
        questionDetail({ promptId: 'a' }),
        questionDetail({ promptId: 'b' }),
        questionDetail({ promptId: 'c', intentStage: 'problem' })
      ],
      'problem'
    )
    expect(done).toBe(2)
    await runUndo(toast()?.id ?? -1)
    expect(source['questions:restore'].mock.calls[0]?.[0]).toEqual({
      projectId: 'proj-1',
      points: [
        { sourceId: 'page-1', promptSetId: 'set-2', replacedBy: 'set-3' },
        { sourceId: 'page-1', promptSetId: 'set-1', replacedBy: 'set-2' }
      ]
    })
  })

  it('a failed action says why in the toast', async () => {
    const source = fakeEditSource()
    source['questions:update'].mockRejectedValueOnce(new Error('The page was removed.'))
    expect(
      await updateQuestions(source, 'proj-1', 'disable', [{ sourceId: 'x', promptId: 'y' }])
    ).toBeNull()
    expect(toast()?.spec.message).toBe('The page was removed.')
  })

  it('prices a re-check by samples per source', () => {
    const plan = recheckPlanOf({
      refs: [
        { sourceId: 'page-1', promptId: 'a' },
        { sourceId: 'page-1', promptId: 'b' },
        { sourceId: 'topic-1', promptId: 'c' }
      ],
      skipped: 1,
      marketId: 'm-us',
      marketLabel: 'US · EN',
      samples: new Map([['page-1', 2]])
    })
    expect(plan.pageIds).toEqual(['page-1', 'topic-1'])
    expect(plan.skipped).toBe(1)
    expect(plan.max).toBeGreaterThanOrEqual(plan.min)
    expect(plan.min).toBeGreaterThan(0)
  })
})
