// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { QuestionSource } from '@shared/ipc'
import { DrillHost } from '../../drill'
import { questionsGroupDrill } from '../drills'
import { questionRow, questionsList, TOPIC } from '../questions.fixtures.test-helper'
import { GroupMeta } from './GroupMeta'

type Rows = Parameters<typeof GroupMeta>[0]['rows']

function renderMeta(rows: Rows): ReturnType<typeof render> {
  const list = questionsList({ rows: [...rows] })
  const sources = new Map<string, QuestionSource>(list.sources.map((item) => [item.id, item]))
  return render(
    <DrillHost>
      <GroupMeta
        rows={rows}
        groupKey={TOPIC.id}
        label={TOPIC.name}
        mode="topic"
        band={undefined}
        addHref={null}
        onSort={() => undefined}
        drillFor={(part) =>
          questionsGroupDrill({
            part,
            mode: 'topic',
            groupKey: TOPIC.id,
            label: TOPIC.name,
            rows,
            list,
            sources,
            marketLabel: 'US · EN'
          })
        }
      />
    </DrillHost>
  )
}

function meta(rows: Rows): string {
  const view = renderMeta(rows)
  const text = view.container.textContent ?? ''
  view.unmount()
  return text
}

/** The rows the open drill drawer lists. */
async function drawerRows(dialog: HTMLElement): Promise<number> {
  const grid = within(dialog).queryByRole('grid')
  if (grid === null) return 0
  await waitFor(() => expect(grid.querySelectorAll('[data-drill-row]').length).toBeGreaterThan(0))
  return Number(grid.getAttribute('aria-rowcount')) - 1
}

describe('GroupMeta', () => {
  afterEach(() => {
    cleanup()
    window.location.hash = ''
  })

  it('shows only the cited share when the group holds questions only', () => {
    const rows = [
      questionRow({ promptId: 'q1', sourceId: TOPIC.id, text: 'One', cited: true }),
      questionRow({ promptId: 'q2', sourceId: TOPIC.id, text: 'Two' })
    ]
    expect(meta(rows)).toContain('cited 1 of 2')
    expect(meta(rows)).not.toContain('keyword')
  })

  it('splits questions from keywords, so the size matches the Topics screen', () => {
    const rows = [
      questionRow({ promptId: 'q1', sourceId: TOPIC.id, text: 'One', cited: true }),
      questionRow({ promptId: 'q2', sourceId: TOPIC.id, text: 'Two' }),
      questionRow({ promptId: 'k1', sourceId: TOPIC.id, text: 'alerts', promptKind: 'keyword' })
    ]
    expect(meta(rows)).toContain('2 questions · 1 keyword · cited 1 of 2')
  })

  it('opens exactly the questions behind "cited N of M", keywords left out', async () => {
    window.location.hash = '#/questions'
    const rows = [
      questionRow({ promptId: 'q1', sourceId: TOPIC.id, text: 'One', cited: true }),
      questionRow({ promptId: 'q2', sourceId: TOPIC.id, text: 'Two' }),
      questionRow({ promptId: 'q3', sourceId: TOPIC.id, text: 'Three', overview: false }),
      questionRow({
        promptId: 'k1',
        sourceId: TOPIC.id,
        text: 'alerts',
        promptKind: 'keyword',
        cited: true
      })
    ]
    const view = renderMeta(rows)
    const cited = view.getByRole('button', { name: /^cited 1: / })
    expect(cited.textContent).toBe('1')
    fireEvent.click(cited)
    let dialog = await view.findByRole('dialog')
    expect(await drawerRows(dialog)).toBe(1)
    expect(dialog.textContent).toContain('One')
    expect(dialog.textContent).not.toContain('alerts')
    await waitFor(() =>
      expect(window.location.hash).toMatch(/drawer=drill&drill=questions%3Agroup/)
    )
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(view.queryByRole('dialog')).toBeNull())

    const of = view.getByRole('button', { name: /^of 2: / })
    expect(of.textContent).toBe('2')
    fireEvent.click(of)
    dialog = await view.findByRole('dialog')
    expect(await drawerRows(dialog)).toBe(2)
  })

  it('draws a zero as plain text', () => {
    const rows = [questionRow({ promptId: 'q1', sourceId: TOPIC.id, text: 'One' })]
    const view = renderMeta(rows)
    expect(view.container.textContent).toContain('cited 0 of 1')
    expect(view.queryByRole('button', { name: /^cited 0/ })).toBeNull()
    expect(view.getByRole('button', { name: /^of 1: / })).toBeTruthy()
  })
})
