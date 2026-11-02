import type { MetricRow } from '../../metrics/types'
import type { ChangedInput } from './changed'
import type { ShapeChange, StructureView } from './changed-types'
import { endRows } from './named'
import type { BarItem, QuestionItem } from './types'

/**
 * Answer structure (Docs/REPORT-SPEC.md "What changed"): the Full report's answer-shape
 * blocks (`answer_shapes`, src/main/export/model/answer-shape.ts) read at both ends of
 * the window. Which blocks gained ground (answers holding each block, before → now),
 * which answers changed shape, and how many opened with a different block. Plain block
 * names throughout; only compared questions whose answer was read at both ends count.
 */

/** A row's blocks: its own, or under All engines its Google AI Overview part's. */
export function blocksOf(
  blocks: Readonly<Record<string, readonly string[]>>,
  row: MetricRow | null
): readonly string[] | null {
  if (row === null) return null
  const own = blocks[row.id]
  if (own !== undefined && own.length > 0) return own
  for (const id of row.parts ?? []) {
    const part = blocks[id]
    if (part !== undefined && part.length > 0) return part
  }
  return null
}

export function structureView(
  input: ChangedInput,
  byId: ReadonlyMap<string, QuestionItem>
): StructureView | null {
  const { metrics, book, extras } = input
  const blocks = extras.blocks ?? {}
  if (metrics.comparison === null || Object.keys(blocks).length === 0) return null
  const labels = extras.blockLabels ?? {}
  const name = (code: string): string => labels[code] ?? code
  const read = endRows(metrics).flatMap(({ to, from }) => {
    const after = blocksOf(blocks, to)
    const before = blocksOf(blocks, from)
    return after === null || before === null ? [] : [{ id: to.id, before, after }]
  })
  if (read.length === 0) return null
  const opener = read.filter((item) => item.before[0] !== item.after[0])
  const reshaped = read.filter((item) => item.before.join(' ') !== item.after.join(' '))
  const analysed = book.add('blk:analysed', {
    title: 'Answers whose blocks were read at both checks',
    kind: 'questions',
    ids: read.map((item) => item.id)
  })
  const changedOpener = book.add('blk:opener', {
    title: 'Answers that open with a different block',
    kind: 'questions',
    ids: opener.map((item) => item.id)
  })
  const changedShape = book.add('blk:reshaped', {
    title: 'Answers that changed shape',
    kind: 'questions',
    ids: reshaped.map((item) => item.id)
  })
  const codes = new Set(read.flatMap((item) => [...item.before, ...item.after]))
  const items: BarItem[] = [...codes].map((code) => {
    const nowIds = read.filter((item) => item.after.includes(code)).map((item) => item.id)
    const beforeIds = read.filter((item) => item.before.includes(code)).map((item) => item.id)
    const now = book.add(`blk:${code}:a`, {
      title: `Answers with a “${name(code)}” block, ${input.toLabel}`,
      kind: 'questions',
      ids: nowIds
    })
    const before = book.add(`blk:${code}:b`, {
      title: `Answers with a “${name(code)}” block, ${input.fromLabel ?? ''}`,
      kind: 'questions',
      ids: beforeIds
    })
    return {
      label: name(code),
      before: before.n,
      now: now.n,
      beforeDrill: before.drill,
      nowDrill: now.drill,
      tone: now.n < before.n ? ('not-cited' as const) : ('target' as const)
    }
  })
  items.sort(
    (a, b) =>
      b.now - b.before - (a.now - a.before) || b.now - a.now || a.label.localeCompare(b.label)
  )
  const changes: ShapeChange[] = reshaped.flatMap((item) => {
    const question = byId.get(item.id)
    if (question === undefined) return []
    return [
      {
        question,
        before: item.before.map(name).join(' → '),
        after: item.after.map(name).join(' → '),
        opener: item.before[0] !== item.after[0]
      }
    ]
  })
  return { analysed, changedOpener, changedShape, blocks: items, changes }
}
