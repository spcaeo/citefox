import type { SetupDraft, SetupItem, SetupListId, SetupRow } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { rowOf } from '../setupDraft'
import { applyMore, applyRedo, isUserOwned } from './merge'
import type { SectionNoun } from './types'
import type { AiMode } from './useSectionAi'

/** The draft with one list changed by `change`. */
export function withList(
  draft: SetupDraft,
  list: SetupListId,
  change: (items: readonly SetupItem[]) => readonly SetupItem[]
): SetupDraft {
  return { ...draft, lists: { ...draft.lists, [list]: change(draft.lists[list]) } }
}

/**
 * The rows a run sends as `current`: every row for Find more (so nothing
 * listed, even unticked, comes back), the user's own rows for Redo (to keep).
 */
export function currentRows(items: readonly SetupItem[], mode: AiMode): SetupRow[] {
  return (mode === 'redo' ? items.filter(isUserOwned) : items).map(rowOf)
}

/**
 * Merges a run's rows into one list of the draft and says what happened.
 * Uses a functional update so a slow run never drops an edit made meanwhile.
 */
export function mergeIntoList(
  onDraft: (update: (current: SetupDraft) => SetupDraft) => void,
  list: SetupListId,
  rows: readonly SetupRow[],
  mode: AiMode,
  noun: SectionNoun,
  /** The list as the card shows it now, for the words (React may run the update later). */
  shown: readonly SetupItem[]
): string {
  const merge = (items: readonly SetupItem[]): ReturnType<typeof applyMore> =>
    mode === 'more' ? applyMore(items, rows) : applyRedo(items, rows)
  const added = merge(shown).added
  onDraft((draft) => withList(draft, list, (items) => merge(items).items))
  return resultLine(mode, added, rows.length, noun)
}

/** "2 competitors added at the top, marked new." */
export function resultLine(
  mode: AiMode,
  added: number,
  returned: number,
  noun: SectionNoun
): string {
  if (mode === 'more') {
    if (added > 0) return `${pluralize(added, noun.one, noun.many)} added at the top, marked new.`
    return returned > 0
      ? `Nothing new: every ${noun.one} that came back is already listed.`
      : `Nothing new came back. Try Redo this section with your words.`
  }
  if (returned === 0) return `Nothing came back, so nothing changed.`
  return `Redone: ${pluralize(returned, noun.one, noun.many)} from CiteFox AI. Your own and edited ${noun.many} are kept.`
}
