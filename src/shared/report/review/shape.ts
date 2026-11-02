import {
  ANSWER_SHAPE_CODES,
  ANSWER_SHAPE_GROUPS,
  ANSWER_SHAPE_MEANINGS,
  ANSWER_SHAPE_NAMES,
  ANSWER_SHAPE_TIPS,
  fingerprintLabel,
  shapeFingerprint,
  type AnswerShapeCode
} from '../../answer-shape'
import type { MetricRow } from '../../metrics/types'
import type { SectionInput } from './sections'
import type { AnswerExtras, JourneyRow, ShapeBlockRow, ShapeView } from './sources-types'

/**
 * The Answer shape tab, ported from the Full report's answer shape section
 * (src/main/export/model/answer-shape.ts) to every engine: what the answers are made of,
 * the recurring journeys (the order of blocks) and a page outline in that order. Reads
 * the stored classifications only; a question counts once (All engines: its first
 * engine answer that has been read). Pure.
 */

const GROUP_OF: Readonly<Record<AnswerShapeCode, string>> = Object.fromEntries(
  ANSWER_SHAPE_GROUPS.flatMap((group) => group.codes.map((code) => [code, group.label]))
) as Record<AnswerShapeCode, string>

type Read = { codes: readonly AnswerShapeCode[] } | 'waiting' | null

/** The blocks of a row (or its first engine answer that has them). */
export function readOf(
  input: SectionInput,
  extras: AnswerExtras,
  row: MetricRow | undefined
): Read {
  if (row === undefined) return null
  const parts =
    row.parts === undefined
      ? [row]
      : row.parts.flatMap((id) => {
          const part = input.metrics.rows[id]
          return part === undefined ? [] : [part]
        })
  let waiting = false
  for (const part of parts) {
    const blocks = extras.blocks[part.id]
    if (blocks === undefined) continue
    if (blocks.length > 0) return { codes: blocks }
    waiting = true
  }
  return waiting ? 'waiting' : null
}

export function journeyLabel(codes: readonly AnswerShapeCode[]): string {
  // Blocks that read the same in a row (three comparisons) show once.
  const names = codes.map((code) => ANSWER_SHAPE_NAMES[code])
  return names.filter((name, index) => index === 0 || names[index - 1] !== name).join(' → ')
}

/** "Write a page in this order": one numbered line per block. */
export function journeyOutline(codes: readonly AnswerShapeCode[]): string[] {
  return codes.map(
    (code, index) => `${index + 1}. ${ANSWER_SHAPE_NAMES[code]}: ${ANSWER_SHAPE_TIPS[code]}`
  )
}

export function shapeView(input: SectionInput, extras: AnswerExtras): ShapeView {
  const { metrics, book } = input
  const analysed: string[] = []
  const waiting: string[] = []
  const codesOf = new Map<string, readonly AnswerShapeCode[]>()
  const changed: string[] = []
  for (const id of metrics.now.checked.ids) {
    const read = readOf(input, extras, metrics.rows[id])
    if (read === null) continue
    if (read === 'waiting') {
      waiting.push(id)
      continue
    }
    analysed.push(id)
    codesOf.set(id, read.codes)
    if (!input.metrics.comparison) continue
    const fromId = metrics.fromOf[id]
    const before = fromId === undefined ? null : readOf(input, extras, metrics.rows[fromId])
    if (before === null || before === 'waiting') continue
    const was = fingerprintLabel(shapeFingerprint(before.codes.map((code) => ({ code }))))
    const now = fingerprintLabel(shapeFingerprint(read.codes.map((code) => ({ code }))))
    if (was !== now) changed.push(id)
  }

  const blocks: ShapeBlockRow[] = ANSWER_SHAPE_CODES.flatMap((code) => {
    const ids = analysed.filter((id) => codesOf.get(id)?.includes(code))
    if (ids.length === 0) return []
    const count = ids.reduce(
      (sum, id) => sum + (codesOf.get(id) ?? []).filter((item) => item === code).length,
      0
    )
    return [
      {
        code,
        name: ANSWER_SHAPE_NAMES[code],
        group: GROUP_OF[code],
        answers: book.add(`shape:block:${code}`, {
          title: `Answers with: ${ANSWER_SHAPE_NAMES[code]}`,
          kind: 'questions',
          ids,
          sub: ANSWER_SHAPE_MEANINGS[code]
        }),
        blocks: count
      }
    ]
  }).sort((a, b) => b.answers.n - a.answers.n || a.code.localeCompare(b.code))

  const byJourney = new Map<string, { codes: AnswerShapeCode[]; ids: string[] }>()
  for (const id of analysed) {
    const codes = shapeFingerprint((codesOf.get(id) ?? []).map((code) => ({ code })))
    const key = fingerprintLabel(codes)
    const entry = byJourney.get(key)
    if (entry === undefined) byJourney.set(key, { codes, ids: [id] })
    else entry.ids.push(id)
  }
  const journeys: JourneyRow[] = [...byJourney.entries()]
    .map(([fingerprint, entry]) => {
      const label = journeyLabel(entry.codes)
      const outline = journeyOutline(entry.codes)
      const first = entry.codes[0]
      return {
        fingerprint,
        codes: entry.codes,
        label,
        opensWith: first === undefined ? '—' : ANSWER_SHAPE_NAMES[first],
        answers: book.add(`shape:journey:${fingerprint}`, {
          title: `Journey: ${label}`,
          kind: 'questions',
          ids: entry.ids,
          sub: 'Answers built in this order. Write your page in the same order.',
          outline
        }),
        outline
      }
    })
    .sort(
      (a, b) =>
        b.answers.n - a.answers.n ||
        a.codes.length - b.codes.length ||
        a.fingerprint.localeCompare(b.fingerprint)
    )

  return {
    withText: analysed.length + waiting.length,
    analysed: book.add('shape:analysed', {
      title: 'Answers analysed',
      kind: 'questions',
      ids: analysed
    }),
    waiting: book.add('shape:waiting', {
      title: 'Answers not read yet',
      kind: 'questions',
      ids: waiting,
      sub: 'CiteFox AI reads each answer after a check.'
    }),
    mostCommon: journeys.find((journey) => journey.answers.n >= 2) ?? journeys[0] ?? null,
    changed: input.metrics.comparison
      ? book.add('shape:changed', {
          title: 'Answers whose shape changed',
          kind: 'questions',
          ids: changed,
          sub: `The order of blocks is different from ${input.fromLabel ?? 'the earlier check'}.`
        })
      : null,
    blocks,
    journeys,
    legend: ANSWER_SHAPE_GROUPS.map((group) => ({
      label: group.label,
      items: group.codes.map((code) => ({
        code,
        name: ANSWER_SHAPE_NAMES[code],
        meaning: ANSWER_SHAPE_MEANINGS[code]
      }))
    }))
  }
}
