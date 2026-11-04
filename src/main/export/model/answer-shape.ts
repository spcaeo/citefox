import {
  ANSWER_SHAPE_CODES,
  ANSWER_SHAPE_GROUPS,
  ANSWER_SHAPE_LABELS,
  fingerprintLabel,
  overviewHash,
  shapeFingerprint,
  type AnswerShapeCode,
  type StoredAnswerShape
} from '../../analytics/answer-shape/vocabulary'
import type { DrillRegistry } from './drills'
import type { ScopeData } from './rows'
import type { AnswerShapeSection, ShapeJourney } from './types'

/** Section 9, Answer shape, from stored classifications (no new searches, no AI call here). */
export function buildAnswerShape(
  scope: ScopeData,
  shapes: readonly StoredAnswerShape[],
  drills: DrillRegistry
): AnswerShapeSection {
  const byHash = new Map(shapes.map((shape) => [shape.overviewHash, shape]))
  const analysed: string[] = []
  const notAnalysed: string[] = []
  const fingerprints = new Map<string, AnswerShapeCode[]>()
  const blocksByRow = new Map<string, readonly { code: AnswerShapeCode }[]>()
  let templateHash: string | null = null
  for (const [rowId, text] of scope.aioText) {
    const shape = byHash.get(overviewHash(text))
    if (shape === undefined || shape.blocks.length === 0) {
      notAnalysed.push(rowId)
      continue
    }
    analysed.push(rowId)
    templateHash ??= shape.templateHash
    blocksByRow.set(rowId, shape.blocks)
    fingerprints.set(rowId, shapeFingerprint(shape.blocks))
  }

  const frequency = ANSWER_SHAPE_CODES.flatMap((code) => {
    const rows = [...blocksByRow.entries()]
      .filter(([, blocks]) => blocks.some((block) => block.code === code))
      .map(([rowId]) => rowId)
    if (rows.length === 0) return []
    const blocks = [...blocksByRow.values()].reduce(
      (total, list) => total + list.filter((block) => block.code === code).length,
      0
    )
    return [
      {
        code,
        label: ANSWER_SHAPE_LABELS[code],
        answers: drills.count(`shape:${code}`, rows),
        blocks
      }
    ]
  })

  const journeysByKey = new Map<string, { codes: AnswerShapeCode[]; rows: string[] }>()
  for (const [rowId, codes] of fingerprints) {
    const key = fingerprintLabel(codes)
    const entry = journeysByKey.get(key)
    if (entry === undefined) journeysByKey.set(key, { codes, rows: [rowId] })
    else entry.rows.push(rowId)
  }
  const journeys: ShapeJourney[] = [...journeysByKey.entries()]
    .map(([fingerprint, entry]) => ({
      fingerprint,
      codes: entry.codes,
      prompts: drills.count(`journey:${fingerprint}`, entry.rows)
    }))
    .sort(
      (left, right) =>
        right.prompts.n - left.prompts.n ||
        left.codes.length - right.codes.length ||
        left.fingerprint.localeCompare(right.fingerprint)
    )

  const changes: { rowId: string; prompt: string; before: string; after: string }[] = []
  for (const [rowId, codes] of fingerprints) {
    const prior = scope.previous.get(rowId)
    if (prior === undefined || prior.aioText === null) continue
    const before = byHash.get(overviewHash(prior.aioText))
    if (before === undefined || before.blocks.length === 0) continue
    const beforeLabel = fingerprintLabel(shapeFingerprint(before.blocks))
    const afterLabel = fingerprintLabel(codes)
    if (beforeLabel === afterLabel) continue
    const row = scope.rows.find((item) => item.id === rowId)
    changes.push({ rowId, prompt: row?.text ?? '', before: beforeLabel, after: afterLabel })
  }

  const repeating = journeys.filter((journey) => journey.prompts.n >= 2)
  const seenCodes = new Set(
    [...blocksByRow.values()].flatMap((blocks) => blocks.map((block) => block.code))
  )
  return {
    empty:
      scope.aioText.size === 0
        ? {
            title: 'No AI Overviews to analyse yet',
            message:
              'Answer shape reads the stored overview text, so it needs a check that found AI Overviews.',
            nextStep:
              'Run a check. The overviews are classified after the check, with no new searches.'
          }
        : analysed.length === 0
          ? {
              title: 'Not measured yet',
              message: `${notAnalysed.length} ${notAnalysed.length === 1 ? 'overview is' : 'overviews are'} waiting to be classified.`,
              nextStep:
                'Connect an AI and run a check — answer shape is classified after the check, from the stored overviews.'
            }
          : null,
    legend: ANSWER_SHAPE_GROUPS,
    labels: ANSWER_SHAPE_LABELS,
    analysed: drills.count('shape:analysed', analysed),
    notAnalysed: drills.count('shape:pending', notAnalysed),
    blockTypes: seenCodes.size,
    repeatingShapes: repeating.length,
    mostCommon: repeating[0] ?? null,
    changed: drills.count(
      'shape:changed',
      changes.map((change) => change.rowId)
    ),
    frequency,
    journeys,
    changes,
    templateHash
  }
}
