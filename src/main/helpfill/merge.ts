import { brandNamed } from '@shared/brand-mentions'
import {
  HELPFILL_MAX_ROWS,
  type HelpFillCounts,
  type HelpFillResult,
  type HelpFillRow
} from '@shared/ipc'
import { indexed, SimilarIndex } from '../import/similar'
import type { HelpFillContext, HelpFillDraftRow, HelpFillKindDef, HelpFillSection } from './types'

/**
 * The one pass both ways share, after the reader (paste) or Claude (Describe):
 * tidy each row (`clean`), merge near-duplicates into a tracked item or an earlier
 * row with the importer's normaliser (`questionMergeKey` through `SimilarIndex`:
 * case, punctuation, articles, plurals and years ignored), and set aside rows that
 * name the brand in a neutral list. Nothing is saved.
 */
export function settleRows(
  definition: HelpFillKindDef,
  context: HelpFillContext,
  drafted: readonly HelpFillDraftRow[],
  warnings: readonly string[] = []
): HelpFillResult {
  const counts: HelpFillCounts = { read: 0, tracked: 0, repeats: 0, setAside: 0, ready: 0 }
  const tracked = definition.tracked(context).merge
  const trackedIndexes = new Map<string, SimilarIndex<string>>()
  const seenIndexes = new Map<string, SimilarIndex<string>>()
  const rows: HelpFillRow[] = []
  const setAside: HelpFillRow[] = []
  const notes = [...warnings]
  let cut = false
  for (const draft of drafted) {
    const section = sectionFor(definition, draft.section)
    if (section === null) continue
    // `clean` returning null drops the row (no fallback to the raw values).
    const values =
      definition.clean === undefined
        ? draft.values
        : definition.clean(draft.values, context, section)
    if (values === null) continue
    const main = (values[section.columns[0] ?? ''] ?? '').trim()
    if (main.length === 0) continue
    counts.read += 1
    const key = definition.key?.(values, section) ?? main
    const probe = indexed(key, key)
    const known = indexFor(trackedIndexes, section.id, tracked[section.id] ?? [])
    if (known.exact(probe) !== null || known.merged(probe) !== null) {
      counts.tracked += 1
      continue
    }
    const seen = indexFor(seenIndexes, section.id, [])
    if (seen.exact(probe) !== null || seen.merged(probe) !== null) {
      counts.repeats += 1
      continue
    }
    seen.add(probe)
    const row: HelpFillRow = {
      id: `row-${counts.read}`,
      section: draft.section,
      values: { ...values }
    }
    if ((section.neutral ?? definition.neutral) && brandNamed(main, context.brands)) {
      counts.setAside += 1
      setAside.push(row)
      continue
    }
    if (rows.length >= HELPFILL_MAX_ROWS) {
      cut = true
      continue
    }
    rows.push(row)
  }
  counts.ready = rows.length
  if (cut) notes.push(`Only the first ${HELPFILL_MAX_ROWS} rows were kept.`)
  return {
    kind: definition.kind,
    rows,
    setAside,
    counts,
    noun: definition.noun,
    brand: context.brands[0] ?? null,
    warnings: rows.length > 0 ? notes.filter((note) => !note.startsWith('No table')) : notes
  }
}

function sectionFor(definition: HelpFillKindDef, id: string | null): HelpFillSection | null {
  if (id === null) return definition.sections.length === 1 ? (definition.sections[0] ?? null) : null
  return definition.sections.find((section) => section.id === id) ?? null
}

function indexFor(
  indexes: Map<string, SimilarIndex<string>>,
  sectionId: string,
  texts: readonly string[]
): SimilarIndex<string> {
  let index = indexes.get(sectionId)
  if (index === undefined) {
    index = new SimilarIndex<string>()
    for (const text of texts) index.add(indexed(text, text))
    indexes.set(sectionId, index)
  }
  return index
}
