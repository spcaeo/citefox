import type { ReactNode } from 'react'
import type { RowFillList, SetupDraft, SetupItem, SetupListId, SetupRow } from '@shared/ipc'
import type { SetupSectionClient } from '../sectionClient'

/** What every section card needs from its step: the draft and the section channels. */
export interface SectionEnv {
  draft: SetupDraft
  /** Functional update, so two quick changes never drop one. */
  onDraft: (update: (current: SetupDraft) => SetupDraft) => void
  client: SetupSectionClient
  /** Polite live-region announcement. */
  announce: (message: string) => void
}

/** A noun for messages: "2 competitors added at the top". */
export interface SectionNoun {
  one: string
  many: string
}

/** One field of a row's in-place edit form. */
export interface RowField {
  key: 'name' | 'detail' | 'url' | 'tag'
  label: string
  placeholder?: string
  /** Code font (addresses, paths). */
  mono?: boolean
  /** A pick list instead of a text box (a question's stage). */
  options?: readonly { value: string; label: string }[]
}

interface CommonProps {
  env: SectionEnv
  title: string
  /** A muted line beside the title. */
  hint?: string
  /** The ✦ Redo button's label in the Redo box, such as "Redo buyers". */
  redoLabel: string
  /** The step runs a job for this card (step 8's first write): the card shows as working. */
  working?: boolean
}

export interface ListSectionProps extends CommonProps {
  variant: 'list'
  list: SetupListId
  noun: SectionNoun
  /** Default "Find more" (step 8: "Write more"). */
  findMoreLabel?: string
  /** The ⋯ menu's first line. Default "Find more…". */
  findMoreMenuLabel?: string
  /** A hint beside that line, such as "from steps 4–6". */
  findMoreHint?: string
  addPlaceholder: string
  /** Code font in the add box (a domain). */
  addMono?: boolean
  /** Text typed in + Add as a row. Default: the text is the name. Null refuses it. */
  parseAdd?: (text: string) => SetupRow | null
  fields: readonly RowField[]
  /** The mark on an untouched AI row: "✦ found", "✦", or none. */
  aiLabel?: string | null
  /** A row's own tag (a competitor's product, "Partial overlap"); wins over the AI mark. */
  rowTag?: (item: SetupItem) => string | null
  /** The second line under the name. Default: the detail. */
  renderSub?: (item: SetupItem) => ReactNode
  /**
   * A row typed by hand (a name only) is filled in by CiteFox AI: its second part
   * (`products`, `buyers`). Leave out for every other list.
   */
  autoFill?: RowFillList
}

export interface ChipSectionProps extends CommonProps {
  variant: 'chips'
  list: SetupListId
  noun: SectionNoun
  addPlaceholder: string
}

export interface TextSectionProps extends CommonProps {
  variant: 'text'
  section: 'summary' | 'topic'
  /** `card`: a titled card with ✦ Redo and ✎ Edit (step 4). `field`: a labelled line with ✎ (step 8). */
  look?: 'card' | 'field'
  placeholder: string
}

export type SectionCardProps = ListSectionProps | ChipSectionProps | TextSectionProps
