import { topicsHash } from '../../../shell/routes'
import type { DashFolder, DashTopic, Dashboard } from '../../views/model'
import { QUESTIONS_DRILL_PREFIX } from '../../views/url'
import type { TopicLine } from '../model'

/** The dashboard's folder filter in the URL: a folder id, or `none` for "No folder". */
export const NO_FOLDER_KEY = 'none'

/** One topic on the dashboard: its totals, its list line (for the row actions) and folder. */
export interface DashRow {
  id: string
  topic: DashTopic
  line: TopicLine
  folder: DashFolder
}

/** The dashboard's topics joined to their list lines, in folder order. */
export function dashRows(board: Dashboard, lines: readonly TopicLine[]): DashRow[] {
  const byId = new Map(lines.map((line) => [line.id, line]))
  const out: DashRow[] = []
  for (const folder of board.folders) {
    for (const topic of folder.topics) {
      const line = byId.get(topic.id)
      if (line) out.push({ id: topic.id, topic, line, folder })
    }
  }
  return out
}

/** The URL key of a folder (`folder=<id>`, or `none`). */
export function folderKey(folder: Pick<DashFolder, 'id'>): string {
  return folder.id ?? NO_FOLDER_KEY
}

/** The rows of one folder, or every row when no folder is picked. */
export function inFolder(rows: readonly DashRow[], key: string | null): readonly DashRow[] {
  return key === null ? rows : rows.filter((row) => folderKey(row.folder) === key)
}

/** The dashboard's List of one folder's topics (`#/topics?view=list&folder=<id>`). */
export function folderListHash(folder: Pick<DashFolder, 'id'>): string {
  return topicsHash({ view: 'list', folder: folderKey(folder) })
}

/**
 * Questions narrowed to one folder's topics (`#/questions?view=list&folder=<id>`), or
 * the drill page of one result there (`#/questions?folder=<id>&d.result=not_cited`), or
 * of the searches that need work (`d.work=1`): a list as long as the count. A null
 * folder is every topic and page.
 */
export function folderResultHash(
  folderId: string | null | undefined,
  result: string | null,
  work = false
): string {
  const params = new URLSearchParams()
  if (result === null && !work) params.set('view', 'list')
  if (folderId !== undefined) params.set('folder', folderKey({ id: folderId }))
  if (result !== null) params.set(`${QUESTIONS_DRILL_PREFIX}result`, result)
  if (work) params.set(`${QUESTIONS_DRILL_PREFIX}work`, '1')
  return `#/questions?${params.toString()}`
}

/** What the folder drawer does (`tf.mode`). */
export type FolderMode = 'create' | 'rename' | 'delete' | 'move'

export function isFolderMode(value: string | undefined): value is FolderMode {
  return value === 'create' || value === 'rename' || value === 'delete' || value === 'move'
}
