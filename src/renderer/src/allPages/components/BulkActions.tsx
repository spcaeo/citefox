import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  INTERVAL_DAYS,
  intervalDaysText,
  type GridMembership,
  type IntervalDays,
  type Market
} from '@shared/domain'
import type {
  AllPageRow,
  BulkAction,
  BulkActionRequest,
  BulkEstimate,
  StoppedPage
} from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { BulkContext } from '../../grid'
import { messageOf } from '../../grid/hooks/useSavedViews'
import { marketLabel } from '../../shell/model'
import { Button, buttonClass, MenuButton, UiIcon, type MenuItem } from '../../ui'
import type { AllPagesSource } from '../source'
import { estimateDetail } from '../utils/format'
import { isWorking } from '../utils/rowMenu'

const INTERVALS: readonly IntervalDays[] = INTERVAL_DAYS

const LABELS: Record<BulkAction, string> = {
  track: 'Track',
  check: 'Check now',
  add_market: 'Add market',
  change_schedule: 'Change schedule',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop tracking',
  pin: 'Pin',
  add_to_group: 'Add to group',
  remove_from_group: 'Remove from group',
  export: 'Export'
}

/** Actions the bulk bar opens in a drawer instead of the inline cost line. */
export interface BulkDrawerActions {
  /** Check now with these pages picked (`check-now` drawer). */
  checkNow: (ids: readonly string[]) => void
  /** Move pages: `to` cluster or group; `fresh` starts on "New group" / "New cluster". */
  move: (ids: readonly string[], to: 'cluster' | 'group', fresh: boolean) => void
  /** Add questions for one page (the drawer takes one target at a time). */
  addQuestions: (id: string) => void
}

/** What a finished bulk action hands back: its message, and Undo data for Stop tracking. */
export interface BulkOutcome {
  message: string
  changed: boolean
  stopped?: readonly StoppedPage[]
}

/**
 * FR-20.3 and deep audit §7b. The common actions are buttons; the rest sit in
 * "More". Actions that change pages first show what they change and their
 * search cost (`allpages:estimate`) and run only after "Run". Check now, Move
 * to cluster, Add to group and Add questions open their drawer.
 */
export function BulkActions({
  source,
  projectId,
  context,
  markets,
  groups,
  drawers,
  onDone
}: {
  source: AllPagesSource
  projectId: string
  context: BulkContext<AllPageRow>
  markets: readonly Market[]
  groups: readonly GridMembership[] | null
  drawers: BulkDrawerActions
  onDone: (outcome: BulkOutcome) => void
}): JSX.Element {
  const [action, setAction] = useState<BulkAction | null>(null)
  const [marketId, setMarketId] = useState<string>(markets[0]?.id ?? '')
  const [interval, setIntervalDays] = useState<IntervalDays>(30)
  const [estimate, setEstimate] = useState<BulkEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const selected = context.selected
  const pageIds = selected.map((row) => row.id)
  const idsKey = pageIds.join('\n')
  // Groups the selected pages are in, for "Remove from group".
  const memberGroups = useMemo(() => {
    const seen = new Map<string, GridMembership>()
    for (const row of selected) for (const group of row.groups ?? []) seen.set(group.id, group)
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [selected])
  const [groupChoice, setGroupId] = useState<string>('')
  const groupId = memberGroups.some((group) => group.id === groupChoice)
    ? groupChoice
    : (memberGroups[0]?.id ?? '')

  const request = (next: BulkAction): BulkActionRequest => ({
    projectId,
    pageIds: idsKey.split('\n').filter((id) => id.length > 0),
    action: next,
    marketId: next === 'add_market' ? marketId || null : null,
    intervalDays: next === 'change_schedule' ? interval : null,
    groupId: next === 'remove_from_group' ? groupId || null : null
  })

  useEffect(() => {
    if (action === null) return
    let cancelled = false
    const wanted: BulkActionRequest = {
      projectId,
      pageIds: idsKey.split('\n').filter((id) => id.length > 0),
      action,
      marketId: action === 'add_market' ? marketId || null : null,
      intervalDays: action === 'change_schedule' ? interval : null,
      groupId: action === 'remove_from_group' ? groupId || null : null
    }
    if (wanted.pageIds.length === 0) return
    source.estimate(wanted).then(
      (result) => {
        if (!cancelled) {
          setEstimate(result)
          setError(null)
        }
      },
      (cause: unknown) => {
        if (!cancelled) setError(messageOf(cause, 'Could not estimate this action.'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [source, projectId, action, idsKey, marketId, interval, groupId])

  function pick(next: BulkAction): void {
    setAction(next)
    setEstimate(null)
    setError(null)
  }

  async function run(): Promise<void> {
    if (action === null) return
    setBusy(true)
    try {
      if (action === 'export') {
        onDone({ message: await context.exportSelected(), changed: false })
      } else {
        const result = await source.run(request(action))
        onDone({
          message: result.message,
          changed: result.changed > 0,
          ...(result.previous && result.previous.length > 0 ? { stopped: result.previous } : {})
        })
        context.clear()
      }
      setAction(null)
      setEstimate(null)
    } catch (cause) {
      setError(messageOf(cause, 'Could not run this action.'))
    } finally {
      setBusy(false)
    }
  }

  const count = pageIds.length
  const running = (row: AllPageRow): boolean =>
    row.status === 'tracked' || row.status === 'setting_up'
  // Paused pages can be tracked again, so Track hides only when every page runs.
  const allTracked = selected.length > 0 && selected.every(running)
  const anyPaused = selected.some((row) => row.status === 'paused')
  const anyRunning = selected.some(running)
  const anyWorking = selected.some(isWorking)
  const first = selected.find(isWorking) ?? selected[0]

  const more: MenuItem[] = [
    {
      id: 'cluster',
      label: 'Move to cluster…',
      icon: 'arrow-right',
      onSelect: () => drawers.move(pageIds, 'cluster', false)
    },
    {
      id: 'new-group',
      label: `New group with these ${pluralize(count, 'page')}`,
      icon: 'plus',
      onSelect: () => drawers.move(pageIds, 'group', true)
    },
    ...(memberGroups.length > 0
      ? [
          {
            id: 'remove_from_group',
            label: 'Remove from group…',
            icon: 'x' as const,
            onSelect: () => pick('remove_from_group')
          }
        ]
      : []),
    {
      id: 'questions',
      label: count > 1 ? 'Add questions to the first page…' : 'Add questions…',
      icon: 'plus',
      groupStart: true,
      disabled: first === undefined,
      onSelect: () => {
        if (first) drawers.addQuestions(first.id)
      }
    },
    { id: 'pin', label: 'Pin', icon: 'target', onSelect: () => pick('pin') },
    { id: 'add_market', label: 'Add market…', icon: 'plus', onSelect: () => pick('add_market') },
    {
      id: 'change_schedule',
      label: 'Change schedule…',
      icon: 'refresh',
      onSelect: () => pick('change_schedule')
    },
    ...(anyWorking
      ? [
          {
            id: 'stop',
            label: 'Stop tracking…',
            icon: 'x' as const,
            tone: 'danger' as const,
            groupStart: true,
            onSelect: () => pick('stop')
          }
        ]
      : [])
  ]

  return (
    <>
      {allTracked ? null : (
        <Button size="sm" aria-pressed={action === 'track'} onClick={() => pick('track')}>
          Track
        </Button>
      )}
      {anyRunning ? (
        <Button size="sm" onClick={() => drawers.checkNow(pageIds)}>
          Check now
        </Button>
      ) : null}
      {anyPaused ? (
        <Button size="sm" aria-pressed={action === 'resume'} onClick={() => pick('resume')}>
          Resume
        </Button>
      ) : null}
      {anyRunning ? (
        <Button size="sm" aria-pressed={action === 'pause'} onClick={() => pick('pause')}>
          Pause
        </Button>
      ) : null}
      <Button size="sm" onClick={() => drawers.move(pageIds, 'group', (groups?.length ?? 0) === 0)}>
        Add to group
      </Button>
      <Button size="sm" aria-pressed={action === 'export'} onClick={() => pick('export')}>
        Export
      </Button>
      <MenuButton
        label="More bulk actions"
        items={more}
        align="end"
        width={264}
        trigger={(props) => (
          <button {...props} type="button" className={buttonClass('secondary', 'sm')}>
            More
            <UiIcon name="chevron-down" size={14} />
          </button>
        )}
      />
      {action !== null ? (
        <div className="ap-confirm" role="group" aria-label={`${LABELS[action]}: cost and confirm`}>
          {action === 'add_market' ? (
            <label className="dg-inline">
              <span>Market</span>
              <select
                className="select"
                value={marketId}
                onChange={(event) => setMarketId(event.target.value)}
              >
                {markets.map((market) => (
                  <option key={market.id} value={market.id}>
                    {marketLabel(market)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {action === 'change_schedule' ? (
            <label className="dg-inline">
              <span>Check every</span>
              <select
                className="select"
                value={interval}
                onChange={(event) => setIntervalDays(Number(event.target.value) as IntervalDays)}
              >
                {INTERVALS.map((days) => (
                  <option key={days} value={days}>
                    {intervalDaysText(days)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {action === 'remove_from_group' ? (
            <label className="dg-inline">
              <span>Group</span>
              <select
                className="select"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                {memberGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="ap-cost" role="status">
            {error ??
              (estimate
                ? `${action === 'stop' ? `Stop tracking ${pluralize(estimate.eligible, 'page')}? ` : ''}${estimateDetail(estimate)}`
                : 'Working out the search cost…')}
          </p>
          <Button
            size="sm"
            className="ap-run"
            variant={action === 'stop' ? 'danger' : 'secondary'}
            disabled={busy || estimate === null || estimate.eligible === 0}
            busy={busy}
            onClick={() => void run()}
          >
            Run {LABELS[action].toLowerCase()}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAction(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
    </>
  )
}
