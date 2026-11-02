import type { JSX } from 'react'
import type { ProjectDetail } from '@shared/ipc'
import { DrillHost } from '../drill'
import { isStructurePart, structureHash } from '../shell/routes'
import { useQueryState } from '../utils/queryState'
import type { StructureClient } from './client'
import { SiteStructure } from '.'

/**
 * Tests only. Site structure as Pages' Tree view shows it: the part (`part`)
 * and an old cluster or group link (`focus`) are read from the URL.
 */
export function StructureScreen({
  client,
  project
}: {
  client: StructureClient
  project: ProjectDetail
}): JSX.Element {
  const [part, setPart] = useQueryState('part', { history: 'push' })
  const [focus] = useQueryState('focus')
  return (
    <DrillHost>
      <SiteStructure
        client={client}
        project={project}
        part={part === 'folders' || isStructurePart(part) ? part : null}
        focus={focus}
        onPart={(next) => setPart(next)}
        hrefFor={(next) => structureHash(next === 'folders' ? undefined : next)}
        folders={() => <p>Folders</p>}
      />
    </DrillHost>
  )
}
