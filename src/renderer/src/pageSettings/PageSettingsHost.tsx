import type { JSX } from 'react'
import type { PageDetail } from '@shared/ipc'
import { DrawerLevel } from '../shell/DrawerLevel'
import { closeDrawersThen, useDrawerEntry } from '../shell/drawers'
import { sectionHash, topicsHash } from '../shell/routes'
import { PageSettingsDrawer, type PageSettingsClient } from './PageSettingsDrawer'
import { isPageSettingsSection } from './model'

/**
 * Draws the Page settings drawer when the URL asks for it
 * (`drawer=page-settings`), over whichever page tab is open.
 */
export function PageSettingsHost({
  client,
  projectId,
  page,
  onChanged,
  onPinsChanged
}: {
  client: PageSettingsClient
  projectId: string
  page: PageDetail
  onChanged: (page: PageDetail | null) => void
  onPinsChanged: () => void
}): JSX.Element | null {
  const api = useDrawerEntry('page-settings')
  if (api === null) return null
  const section = api.entry.params['ps.section']
  return (
    <DrawerLevel depth={api.depth}>
      <PageSettingsDrawer
        client={client}
        projectId={projectId}
        page={page}
        section={isPageSettingsSection(section) ? section : null}
        onClose={() => api.close()}
        onChanged={onChanged}
        onPinsChanged={onPinsChanged}
        navigate={closeDrawersThen}
        afterRemoveHash={page.kind === 'topic' ? topicsHash() : sectionHash('pages')}
      />
    </DrawerLevel>
  )
}
