import type { QuestionRow, QuestionSource, TopicFolder } from '@shared/ipc'
import { NO_FOLDER } from '../../topics/views/model'

/** `folder=none`: the topics in no folder (the Topics dashboard's "No folder"). */
export const NO_FOLDER_KEY = 'none'

/**
 * The sources a folder filter (`folder=<id>` or `none`) keeps, or null for no filter.
 * A folder holds topics only, so `none` is every topic outside a folder, never a page.
 * An unknown folder keeps nothing.
 */
export function folderSourceIds(
  folders: readonly TopicFolder[],
  key: string | null,
  sources: readonly QuestionSource[]
): ReadonlySet<string> | null {
  if (key === null) return null
  if (key === NO_FOLDER_KEY) {
    const filed = new Set(folders.flatMap((folder) => folder.topicIds))
    return new Set(
      sources
        .filter((source) => source.kind === 'topic' && !filed.has(source.id))
        .map((source) => source.id)
    )
  }
  return new Set(folders.find((folder) => folder.id === key)?.topicIds ?? [])
}

export function inFolderRows(
  rows: readonly QuestionRow[],
  ids: ReadonlySet<string> | null
): readonly QuestionRow[] {
  return ids === null ? rows : rows.filter((row) => ids.has(row.sourceId))
}

/** The chip's name for the folder filter; null when the folder is not known (yet). */
export function folderName(folders: readonly TopicFolder[], key: string | null): string | null {
  if (key === null) return null
  if (key === NO_FOLDER_KEY) return NO_FOLDER
  return folders.find((folder) => folder.id === key)?.name ?? null
}
