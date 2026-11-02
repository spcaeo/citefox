import { useEffect, useSyncExternalStore, type JSX } from 'react'
import { closeDrawersThen, openDrawer, useDrawerEntry } from '../shell/drawers'
import { sectionHash } from '../shell/routes'
import { Drawer, DrawerGrid, DrawerSection } from '../ui'
import { UiIcon } from '../ui/UiIcon'
import {
  activitySnapshot,
  ensureActivityFeed,
  subscribeActivity,
  type ActivityEntry
} from './activity'
import type { StartClient } from './client'
import './extras.css'

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function useActivityEntries(): readonly ActivityEntry[] {
  return useSyncExternalStore(subscribeActivity, activitySnapshot, activitySnapshot)
}

/**
 * The top bar's Activity icon button (owner feedback 4; Header.dc.html), with
 * a count badge while jobs run. With the work console it
 * opens the console; on its own it opens the Activity drawer, which is on the
 * URL (`drawer=activity`), so Back closes it and a pasted link reopens it.
 */
export function ActivityControl({
  client,
  onToggle,
  expanded
}: {
  client: StartClient
  /** The work console: the button opens it instead (the list stays at `drawer=activity`). */
  onToggle?: () => void
  /** With `onToggle`: whether the console is open. */
  expanded?: boolean
}): JSX.Element {
  useEffect(() => {
    ensureActivityFeed(client)
  }, [client])
  const entries = useActivityEntries()
  const open = useDrawerEntry('activity') !== null
  const running = entries.filter((entry) => entry.state === 'running')

  const tip = running.length > 0 ? `Activity · ${running.length} running` : 'Activity'
  return (
    <button
      type="button"
      className="topbar-icon act-btn"
      aria-expanded={onToggle ? (expanded ?? false) : open}
      aria-haspopup="dialog"
      data-tip={tip}
      onClick={() => (onToggle ? onToggle() : open ? undefined : openDrawer('activity'))}
    >
      <UiIcon name="activity" />
      <span className="sr-only">Activity</span>
      {running.length > 0 ? (
        <>
          <span className="topbar-badge act-badge" aria-hidden="true">
            {running.length}
          </span>
          <span className="sr-only">, {running.length} running</span>
        </>
      ) : null}
    </button>
  )
}

/**
 * The Activity drawer (`drawer=activity`, a shell drawer over any screen):
 * what CiteFox is doing now and what it did in this window. Read-only, so
 * focus starts on ✕ and the footer has a single Close.
 */
export function ActivityDrawer({ onClose }: { onClose: () => void }): JSX.Element {
  const entries = useActivityEntries()
  const running = entries.filter((entry) => entry.state === 'running')
  const earlier = entries.filter((entry) => entry.state !== 'running').reverse()
  return (
    <Drawer
      id="activity"
      title="Activity"
      subtitle="What CiteFox is doing now and what it did in this window."
      focusOnOpen="close"
      testId="activity-drawer"
      onClose={onClose}
      footer={{
        summary: 'This window only · past checks are in History',
        cancel: 'Close',
        secondary: {
          label: 'Open history',
          onClick: () => closeDrawersThen(sectionHash('history'))
        }
      }}
    >
      <DrawerGrid>
        <DrawerSection title="Now" count={running.length}>
          {running.length === 0 ? (
            <p className="act-empty">Nothing is running.</p>
          ) : (
            <EntryList entries={running} label="Running now" />
          )}
        </DrawerSection>
        <DrawerSection title="Earlier" count={earlier.length}>
          {earlier.length === 0 ? (
            <p className="act-empty">Nothing yet in this window.</p>
          ) : (
            <EntryList entries={earlier} label="Earlier" />
          )}
        </DrawerSection>
      </DrawerGrid>
    </Drawer>
  )
}

function EntryList({
  entries,
  label
}: {
  entries: readonly ActivityEntry[]
  label: string
}): JSX.Element {
  return (
    <ul className="act-list" aria-label={label}>
      {entries.map((entry) => (
        <li key={`${entry.key}:${entry.at}`} className={`act-item act-${entry.state}`}>
          <span className="act-state" aria-hidden="true" />
          <span>
            {entry.text} <span className="act-area">· {entry.area}</span>
            {entry.state === 'warning' ? <span className="sr-only"> (needs a look)</span> : null}
          </span>
          <time className="act-time num" dateTime={new Date(entry.at).toISOString()}>
            {timeOf(entry.at)}
          </time>
        </li>
      ))}
    </ul>
  )
}
