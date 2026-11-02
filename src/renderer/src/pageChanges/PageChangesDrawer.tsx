import { useMemo, useState, type JSX } from 'react'
import type { PageChange } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { errorText } from '../components/errorText'
import { closeDrawer } from '../shell/drawers'
import { Button, Drawer, EmptyState, MarkerDot, UrlText } from '../ui'
import { createPageChangesSource, type PageChangesSource } from './client'
import { usePageChangeActions, usePageChanges } from './hooks'
import { changeDay, changePath, openChanges } from './model'
import './pageChanges.css'

/**
 * Every page change nobody logged yet (window-wide drawer `page-changes`), newest
 * first, each with Log as fix, See what changed and Not a fix (Undo).
 */
export function PageChangesDrawer({
  projectId,
  depth,
  source
}: {
  projectId: string
  depth: number
  source?: PageChangesSource
}): JSX.Element {
  const client = useMemo(() => source ?? createPageChangesSource(), [source])
  const { list, error, reload } = usePageChanges(projectId, client)
  const actions = usePageChangeActions(projectId, client)
  const waiting = openChanges(list)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const notAFix = (change: PageChange): void => {
    setBusyId(change.id)
    setFailed(null)
    actions.notAFix(change).then(
      () => setBusyId(null),
      (cause: unknown) => {
        setBusyId(null)
        setFailed(errorText(cause, 'Could not save that. Try again.'))
      }
    )
  }

  return (
    <Drawer
      id="page-changes"
      title="Page changes"
      heading={
        <>
          Page changes{' '}
          {list ? (
            <span className="num faint">{waiting.length.toLocaleString('en-US')}</span>
          ) : null}
        </>
      }
      subtitle="Changes CiteFox saw on your pages that nobody logged yet. Log the ones you made as fixes, so CiteFox can measure them."
      depth={depth}
      testId="page-changes-drawer"
      loading={list === null && error === null}
      error={error ? { message: error, onRetry: reload } : undefined}
      focusOnOpen="close"
      onClose={() => closeDrawer(depth)}
      footer={{
        summary: list ? pluralize(waiting.length, 'change') + ' waiting' : null,
        cancel: 'Close'
      }}
    >
      {failed ? (
        <p className="pc-banner-error" role="alert">
          {failed}
        </p>
      ) : null}
      {list && waiting.length === 0 ? (
        <EmptyState
          title="Nothing waiting."
          body="Every change CiteFox saw is logged as a fix or marked as not a fix."
        />
      ) : (
        <ul className="pc-list" aria-label="Page changes nobody logged">
          {waiting.map((change) => (
            <li key={change.id} className="pc-list-item">
              <MarkerDot kind="page" label="?" />
              <div className="pc-list-body">
                <p className="pc-list-lead">
                  <UrlText url={change.url} label={changePath(change)} icon={false} cut="end" />
                  <span className="faint"> · changed on {changeDay(change)}</span>
                </p>
                <p className="pc-list-detail">{change.sentence}</p>
                <div className="pc-banner-actions">
                  <Button size="sm" variant="secondary" onClick={() => actions.logAsFix(change)}>
                    Log as fix, live {changeDay(change)}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => actions.seeWhatChanged(change)}>
                    See what changed
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    busy={busyId === change.id}
                    onClick={() => notAFix(change)}
                  >
                    Not a fix
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  )
}
