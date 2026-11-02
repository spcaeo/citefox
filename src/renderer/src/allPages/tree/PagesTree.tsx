import type { JSX } from 'react'
import type { AllPageRow, ProjectDetail } from '@shared/ipc'
import { isStructurePart } from '../../shell/routes'
import type { StructureClient } from '../../structure/client'
import { SiteStructure, type SiteStructurePart } from '../../structure'
import { patchHashQuery } from '../../utils/hashQuery'
import { useQueryState, writeQuery } from '../../utils/queryState'
import { FolderTree } from './FolderTree'

/**
 * Pages · Tree: the site's folders with totals, then the rest of Site
 * structure (clusters, groups, sitemaps, the last sync, what Claude noticed).
 * The part is `?part=` (none is Folders); `?focus=` is an old cluster or
 * group link, which opens its drawer.
 */
export function PagesTree({
  project,
  client,
  rows,
  domain,
  onOpenPage,
  onCited,
  onPagesChanged
}: {
  project: ProjectDetail
  client: StructureClient
  rows: readonly AllPageRow[]
  domain: string
  onOpenPage: (row: AllPageRow) => void
  onCited: (row: AllPageRow) => void
  /** Reloads the page rows after a structure action (Find sitemaps, Sync now, Track all). */
  onPagesChanged: () => void
}): JSX.Element {
  const [part] = useQueryState('part')
  const [focus] = useQueryState('focus')
  const patch = (next: SiteStructurePart): Record<string, string | null> => ({
    part: next === 'folders' ? null : next,
    focus: null
  })
  return (
    <SiteStructure
      client={client}
      project={project}
      part={part === 'folders' || isStructurePart(part) ? part : null}
      focus={focus}
      onPart={(next) => writeQuery(patch(next), 'push')}
      hrefFor={(next) => patchHashQuery(window.location.hash, patch(next))}
      onChanged={onPagesChanged}
      folders={({ state }) => (
        <FolderTree
          rows={rows}
          domain={domain}
          client={client}
          projectId={project.id}
          structure={state}
          onOpenPage={onOpenPage}
          onCited={onCited}
        />
      )}
    />
  )
}
