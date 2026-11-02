import { useMemo, useState, type JSX } from 'react'
import { rollupPageFixes } from '@shared/page-fixes'
import type { DrawerEntry } from '../../shell/drawerUrl'
import { closeDrawer, setDrawerParams } from '../../shell/drawers'
import { Drawer, IconButton } from '../../ui'
import { usePageFixBriefs } from '../hooks/usePageFixBriefs'
import { useProjectSearches } from '../hooks/useProjectSearches'
import { createProjectFixesSource, type ProjectFixesSource } from '../source'
import { takeStartOnOpen } from './openPageFix'
import { PageFixDrawer } from './PageFixDrawer'
import { pageFixTab } from './pageFixTab'
import './todo.css'

/**
 * The page fix drawer over any screen (`drawer=page-fix&pfx.id=<fix>`), the same drawer
 * What to fix opens, so Get fix brief never leaves the screen it was pressed on. It
 * reads the project's searches and rolls them up as Fixes does; a brief that covers
 * several fixes (`pfx.ids`) opens the first and steps through the rest.
 */
export function PageFixHost({
  entry,
  depth,
  projectId,
  source
}: {
  entry: DrawerEntry
  depth: number
  projectId: string
  /** Tests only. Production reads through the fixes channels. */
  source?: ProjectFixesSource
}): JSX.Element {
  const client = useMemo(() => source ?? createProjectFixesSource(), [source])
  const searches = useProjectSearches(client, projectId)
  const briefs = usePageFixBriefs(client, projectId)
  const rollup = useMemo(
    () => (searches.data ? rollupPageFixes(searches.data.searches, null) : null),
    [searches.data]
  )
  const id = entry.params['pfx.id'] ?? ''
  const ids = useMemo(() => {
    const listed = (entry.params['pfx.ids'] ?? '').split(',').filter((item) => item !== '')
    return listed.includes(id) ? listed : [id]
  }, [entry.params, id])
  // A Get fix brief press starts the brief of the fix it opened (never one stepped to).
  const [startId] = useState(() => (takeStartOnOpen(id) ? id : null))
  const close = (): void => closeDrawer(depth)
  const fix = rollup?.fixes.find((item) => item.id === id) ?? null

  if (fix === null || searches.data === null) {
    return (
      <Drawer
        id="page-fix"
        title="Page fix"
        depth={depth}
        onClose={close}
        loading={searches.data === null && searches.error === null}
        {...(searches.error
          ? { error: { message: searches.error, onRetry: searches.reload } }
          : {})}
        footer={{ cancel: 'Close' }}
      >
        <p className="muted" role="status">
          That fix is done or no longer needed.
        </p>
      </Drawer>
    )
  }

  const at = ids.indexOf(id)
  const step = (next: number): void => {
    const target = ids[next]
    if (target) setDrawerParams(depth, { 'pfx.id': target, 'pfx.tab': null })
  }
  const status =
    ids.length > 1 ? (
      <span className="fxt-step">
        <span className="num">
          Fix {at + 1} of {ids.length}
        </span>
        <IconButton
          icon="chevron-left"
          size="sm"
          label="Previous page fix"
          disabled={at <= 0}
          onClick={() => step(at - 1)}
        />
        <IconButton
          icon="chevron-right"
          size="sm"
          label="Next page fix"
          disabled={at >= ids.length - 1}
          onClick={() => step(at + 1)}
        />
      </span>
    ) : undefined

  return (
    <PageFixDrawer
      stacked
      fix={fix}
      projectId={projectId}
      domain={searches.data.domain}
      source={client}
      autoStart={startId === id}
      saved={briefs.byFix.get(fix.id)?.brief ?? null}
      onSaved={briefs.put}
      onClose={close}
      onChanged={searches.reload}
      tab={pageFixTab(entry.params['pfx.tab'] ?? null)}
      onTab={(next) => setDrawerParams(depth, { 'pfx.tab': next === 'brief' ? null : next })}
      {...(status ? { status } : {})}
    />
  )
}
