import { useState, type JSX } from 'react'
import type { PageChange, PageChangeList } from '@shared/ipc'
import { openDrawer } from '../shell/drawers'
import { Button, MarkerDot, UrlText } from '../ui'
import { errorText } from '../components/errorText'
import type { PageChangeActions } from './actions'
import { PageDates } from './PageDates'
import { bannerText, changeDay, changePath, datesForChange, openChanges } from './model'
import './pageChanges.css'

/**
 * Pages › "Is this a fix?" (mock-up section 4): the newest change nobody logged,
 * with Log as fix (the day it went live), See what changed and Not a fix (Undo).
 * Several waiting changes share one banner with a count and "See all", which
 * opens the list drawer. Nothing shows when every change is decided.
 */
export function PageChangeBanner({
  list,
  actions
}: {
  list: PageChangeList | null
  actions: PageChangeActions
}): JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waiting = openChanges(list)
  const change: PageChange | undefined = waiting[0]
  if (!change) return null
  const text = bannerText(change)
  const more = waiting.length - 1
  const dates = datesForChange(list, change)

  const notAFix = (): void => {
    setBusy(true)
    setError(null)
    actions.notAFix(change).then(
      () => setBusy(false),
      (cause: unknown) => {
        setBusy(false)
        setError(errorText(cause, 'Could not save that. Try again.'))
      }
    )
  }

  return (
    <section
      className="pc-banner"
      aria-label={waiting.length === 1 ? 'A page changed' : `${waiting.length} page changes`}
      data-testid="page-change-banner"
    >
      <MarkerDot kind="page" label="?" />
      <div className="pc-banner-body">
        {waiting.length > 1 ? (
          <p className="pc-banner-count">
            {waiting.length} page changes nobody logged yet. The newest:
          </p>
        ) : null}
        <p className="pc-banner-lead">
          <UrlText url={change.url} label={changePath(change)} icon={false} cut="end" />
          <span> changed on {changeDay(change)}.</span>
        </p>
        <p className="pc-banner-detail">{text.detail}</p>
        {dates ? <PageDates dates={dates} previousModifiedAt={change.previousModifiedAt} /> : null}
        {error ? (
          <p className="pc-banner-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="pc-banner-actions">
          <Button size="sm" variant="primary" onClick={() => actions.logAsFix(change)}>
            Log as fix, live {changeDay(change)}
          </Button>
          <Button size="sm" onClick={() => actions.seeWhatChanged(change)}>
            See what changed
          </Button>
          <Button size="sm" variant="ghost" busy={busy} onClick={notAFix}>
            Not a fix
          </Button>
          {more > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              iconEnd="chevron-right"
              onClick={() => openDrawer('page-changes')}
            >
              See all {waiting.length}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
