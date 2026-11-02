import type { ImportCandidate } from '@shared/ipc'
import type { DrillTarget, ItemDrill } from '../../drill'
import { candidatePage, pagesDrill, pageTarget, type DrillPage } from '../../structure/utils/drills'

export function folderName(folder: string): string {
  return folder === '/' ? 'other' : folder
}

/** A folder's pages, or its tracked pages. The count shown is this list's length. */
export function folderDrill(
  rows: readonly ImportCandidate[],
  folder: string,
  part: 'all' | 'tracked'
): ItemDrill {
  const name = folderName(folder)
  const pages = rows
    .filter((row) => row.folder === folder && (part === 'all' || row.alreadyTracked))
    .map(candidatePage)
  return pagesDrill({
    id: `import-folder-${part}:${folder}`,
    title: part === 'all' ? `Pages in ${name}` : `Tracked pages in ${name}`,
    description:
      part === 'all'
        ? 'Every page CiteFox found in this folder.'
        : 'Pages in this folder that are tracked, setting up or paused. They keep their markets, questions and history.',
    pages
  })
}

/** A cluster's pages in the import list. */
export function clusterDrill(
  rows: readonly ImportCandidate[],
  cluster: { id: string; name: string }
): ItemDrill {
  return pagesDrill({
    id: `import-cluster:${cluster.id}`,
    title: `Pages in ${cluster.name}`,
    description: 'Every page CiteFox found in this Site structure cluster.',
    pages: rows.filter((row) => row.clusterId === cluster.id).map(candidatePage)
  })
}

/** The pages Claude picked, one row per picked id. */
export function pickedDrill(
  rows: readonly ImportCandidate[],
  pageIds: readonly string[]
): ItemDrill {
  const byId = new Map(rows.map((row) => [row.pageId, row]))
  const pages = pageIds.map((pageId): DrillPage => {
    const row = byId.get(pageId)
    return row
      ? candidatePage(row)
      : { pageId, url: '', title: 'A page no longer in your sitemaps', status: null }
  })
  return pagesDrill({
    id: 'import-claude-pick',
    title: "CiteFox AI's pick",
    description: 'The pages CiteFox AI picked as most likely to win AI Overviews.',
    pages
  })
}

/** Where a preview row's title opens: a tracked page in CiteFox, else the URL in the browser. */
export function candidateTarget(row: ImportCandidate): DrillTarget | null {
  return pageTarget(candidatePage(row))
}
