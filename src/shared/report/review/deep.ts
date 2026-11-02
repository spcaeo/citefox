import { isAnswered, isCitedRow, isMeasured } from '../../metrics/counts'
import type { MetricRow } from '../../metrics/types'
import type { AgencyInput } from './agency'
import type { AnswerShape } from './extras'
import { plural } from './items'
import type { BarItem, BucketItem, DeepView, Num } from './types'

/**
 * Deep dives (Docs/REPORT-SPEC.md "Ready reports"): how the shape of answers changed
 * (lists, steps, tables, length, read from the stored answer text), where you sit among
 * the sources before and now, and whether the engines agree on citing you. Every bar
 * drills to exactly the questions it counts.
 */

const LONG_WORDS = 120

const SHAPE_KINDS = [
  { key: 'list', label: 'Answers with a list', test: (s: AnswerShape) => s.list },
  { key: 'steps', label: 'Answers with steps', test: (s: AnswerShape) => s.steps },
  { key: 'table', label: 'Answers with a table', test: (s: AnswerShape) => s.table },
  {
    key: 'long',
    label: `Long answers (${LONG_WORDS}+ words)`,
    test: (s: AnswerShape) => s.words >= LONG_WORDS
  }
] as const

/**
 * A row's shape: its own, or under All engines the merge of its engines' answers (a
 * list, steps or a table in any of them; long when any is long). `each` holds every
 * answer read, for the average length.
 */
function shapeOfRow(
  input: AgencyInput,
  row: MetricRow | undefined
): { shape: AnswerShape; each: readonly AnswerShape[] } | null {
  if (row === undefined || !isAnswered(row)) return null
  const own = input.extras.shapes[row.id]
  if (own !== undefined) return { shape: own, each: [own] }
  const parts = (row.parts ?? []).flatMap((id) => {
    const shape = input.extras.shapes[id]
    return shape === undefined ? [] : [shape]
  })
  if (parts.length === 0) return null
  return {
    shape: {
      words: Math.max(...parts.map((part) => part.words)),
      list: parts.some((part) => part.list),
      steps: parts.some((part) => part.steps),
      table: parts.some((part) => part.table)
    },
    each: parts
  }
}

function shapesOf(input: AgencyInput): DeepView['shapes'] {
  const { metrics, book, toIds } = input
  const nowRows = metrics.now.answered.ids
  const fromIds = metrics.comparison === null ? [] : Object.values(metrics.fromOf)
  const nowShapes = nowRows.flatMap((id) => {
    const read = shapeOfRow(input, metrics.rows[id])
    return read === null ? [] : [{ id, ...read }]
  })
  const beforeShapes = fromIds.flatMap((id) => {
    const read = shapeOfRow(input, metrics.rows[id])
    return read === null ? [] : [{ id, ...read }]
  })
  if (nowShapes.length === 0 && beforeShapes.length === 0) return null
  const comparing = metrics.comparison !== null
  const items: BarItem[] = SHAPE_KINDS.map((kind) => {
    const now = book.add(`shape:${kind.key}:a`, {
      title: `${kind.label}, ${input.toLabel}`,
      kind: 'questions',
      ids: nowShapes.filter((item) => kind.test(item.shape)).map((item) => item.id)
    })
    const before = comparing
      ? book.add(`shape:${kind.key}:b`, {
          title: `${kind.label}, ${input.fromLabel ?? ''}`,
          kind: 'questions',
          ids: toIds(beforeShapes.filter((item) => kind.test(item.shape)).map((item) => item.id))
        })
      : null
    return {
      label: kind.label,
      before: before?.n ?? 0,
      now: now.n,
      beforeDrill: before?.drill ?? null,
      nowDrill: now.drill,
      tone: 'target' as const
    }
  })
  const mean = (list: readonly { each: readonly AnswerShape[] }[]): number | null => {
    const all = list.flatMap((item) => item.each)
    return all.length === 0
      ? null
      : Math.round(all.reduce((sum, shape) => sum + shape.words, 0) / all.length)
  }
  return {
    items,
    wordsBefore: comparing ? mean(beforeShapes) : null,
    wordsNow: mean(nowShapes),
    read: nowShapes.reduce((sum, item) => sum + item.each.length, 0)
  }
}

const BUCKETS = ['1', '2', '3', '4-5', '6+'] as const

function bucketOf(position: number): (typeof BUCKETS)[number] {
  if (position <= 1) return '1'
  if (position <= 2) return '2'
  if (position <= 3) return '3'
  if (position <= 5) return '4-5'
  return '6+'
}

function spreadOf(input: AgencyInput): BarItem[] {
  const { metrics, book, toIds } = input
  const group = (ids: readonly string[]): Map<string, string[]> => {
    const out = new Map<string, string[]>()
    for (const id of ids) {
      const row = metrics.rows[id]
      if (row === undefined || !isCitedRow(row) || typeof row.position !== 'number') continue
      const key = bucketOf(row.position)
      out.set(key, [...(out.get(key) ?? []), id])
    }
    return out
  }
  const now = group(metrics.now.cited.ids)
  const comparing = metrics.comparison !== null
  const before = comparing ? group(Object.values(metrics.fromOf)) : new Map<string, string[]>()
  return BUCKETS.map((key) => {
    const label = key === '6+' ? 'Source #6 or lower' : `Source #${key.replace('-', '–')}`
    const a = book.add(`spread:${key}:a`, {
      title: `${input.ctx.brand} is ${label.toLowerCase()}, ${input.toLabel}`,
      kind: 'questions',
      ids: now.get(key) ?? []
    })
    const b: Num | null = comparing
      ? book.add(`spread:${key}:b`, {
          title: `${input.ctx.brand} is ${label.toLowerCase()}, ${input.fromLabel ?? ''}`,
          kind: 'questions',
          ids: toIds(before.get(key) ?? [])
        })
      : null
    return {
      label,
      before: b?.n ?? 0,
      now: a.n,
      beforeDrill: b?.drill ?? null,
      nowDrill: a.drill,
      tone: 'target' as const
    }
  })
}

function agreeOf(input: AgencyInput): DeepView['agree'] {
  const { metrics, book } = input
  if (metrics.engine !== 'all') return null
  const engines = metrics.offeredEngines.length
  if (engines < 2) return null
  const byCount = new Map<number, string[]>()
  let any = false
  for (const id of metrics.now.checked.ids) {
    const row = metrics.rows[id]
    const parts = (row?.parts ?? [])
      .map((part) => metrics.rows[part])
      .filter((part): part is MetricRow => part !== undefined && isMeasured(part))
    if (parts.length < 2) continue
    any = true
    const cited = parts.filter((part) => isCitedRow(part)).length
    byCount.set(cited, [...(byCount.get(cited) ?? []), id])
  }
  if (!any) return null
  const buckets: BucketItem[] = []
  for (let count = 0; count <= engines; count += 1) {
    const label =
      count === 0
        ? 'No engine'
        : count === engines
          ? `All ${engines} engines`
          : `${count} ${plural(count, 'engine')}`
    const num = book.add(`agree:${count}`, {
      title: count === 0 ? 'No engine cites you' : `Cited on ${label.toLowerCase()}`,
      kind: 'questions',
      ids: byCount.get(count) ?? [],
      sub: 'Questions two or more engines answered.'
    })
    buckets.push({
      label,
      sub: 'cite you',
      value: num.n,
      drill: num.drill
    })
  }
  return { engines, buckets }
}

export function deepView(input: AgencyInput): DeepView {
  return { shapes: shapesOf(input), spread: spreadOf(input), agree: agreeOf(input) }
}
