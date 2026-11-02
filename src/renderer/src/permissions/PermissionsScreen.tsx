import { useMemo, useState, type JSX } from 'react'
import type { PermissionId, PermissionItem } from '@shared/ipc'
import { isReady } from '@shared/permissions'
import { useAiContext } from '../assistant/context/useAiContext'
import { askColumn } from '../assistant/sparkle/askColumn'
import {
  Chip,
  EmptyState,
  IconButton,
  ListGrid,
  Panel,
  UiIcon,
  usePermissions,
  type ListColumn,
  type MenuItem
} from '../ui'
import {
  NEED_ORDER,
  SETUP_HREF,
  needLabel,
  permissionsHash,
  stateRank,
  stateTone,
  stateWord
} from './model'
import { usePermissionAction } from './usePermissionAction'
import './permissions.css'

type Filter = 'all' | 'todo' | 'ready'

/**
 * Settings › What CiteFox needs (`#/permissions/<id>`): every permission and
 * connection with what it is for, whether it is required, its live state and
 * its one action. The open item's details, and what the system will show
 * before an action that asks it, sit in the right rail.
 */
export function PermissionsScreen({
  focusId,
  navigate = (hash) => {
    window.location.hash = hash
  }
}: {
  /** The open item, from the route. */
  focusId?: string | null
  /** Tests capture navigation. */
  navigate?: (hash: string) => void
}): JSX.Element {
  const permissions = usePermissions()
  const [filter, setFilter] = useState<Filter>('all')
  const [confirmFor, setConfirmFor] = useState<PermissionId | null>(null)
  const snapshot = permissions?.snapshot ?? null
  const items = useMemo(() => snapshot?.items ?? [], [snapshot])
  const rows = items.filter((item) =>
    filter === 'all' ? true : filter === 'ready' ? isReady(item.state) : !isReady(item.state)
  )
  const open =
    items.find((item) => item.id === focusId) ??
    items.find((item) => !isReady(item.state)) ??
    items[0] ??
    null

  useAiContext({
    ...(open
      ? {
          entities: [
            {
              kind: 'setting' as const,
              id: open.id,
              label: open.title,
              detail: stateWord(open.state)
            }
          ]
        }
      : {}),
    filters: { show: filter === 'all' ? '' : filter === 'ready' ? 'Ready' : 'Needs a step' },
    numbers: snapshot
      ? [
          { label: 'Ready', value: `${snapshot.readyCount} of ${items.length}` },
          { label: 'Required steps left', value: String(snapshot.requiredOpen) }
        ]
      : [],
    // What needs a step first: only the first 12 facts are kept.
    facts: [...items]
      .sort((a, b) => stateRank(a.state) - stateRank(b.state))
      .map((item) => `${item.title}: ${stateWord(item.state)} (${needLabel(item.need)})`)
  })

  function setup(id: PermissionId): void {
    const href = SETUP_HREF[id]
    if (href) navigate(href)
  }

  function act(item: PermissionItem): void {
    const action = item.action
    if (action === null || permissions === null) return
    if (action.kind === 'setup') {
      setup(item.id)
      return
    }
    if (item.osPrompt !== null && item.id !== 'claude') {
      setConfirmFor(item.id)
      navigate(permissionsHash(item.id))
      return
    }
    void permissions.request(item.id)
  }

  /** The row ⋯ menu: the item's one action, and its details in the rail. */
  function rowActions(row: PermissionItem): MenuItem[] {
    const busy = permissions?.busy ?? null
    return [
      ...(row.action
        ? [
            {
              id: 'act',
              label: row.action.label,
              disabled: busy !== null,
              onSelect: () => act(row)
            }
          ]
        : []),
      {
        id: 'details',
        label: 'Show details',
        icon: 'panel-left' as const,
        onSelect: () => navigate(permissionsHash(row.id))
      }
    ]
  }

  const columns: ListColumn<PermissionItem>[] = [
    {
      id: 'item',
      label: 'Item',
      width: 'fill',
      minWidth: 200,
      sort: (row) => row.title,
      render: (row) => (
        <span className="pm-cell-title">
          <a href={permissionsHash(row.id)} aria-current={open?.id === row.id ? 'true' : undefined}>
            {row.title}
          </a>
          <span className="pm-cell-sub">{row.purpose}</span>
        </span>
      )
    },
    {
      id: 'state',
      label: 'State',
      width: 240,
      sort: (row) => stateRank(row.state),
      render: (row) => (
        <Chip size="sm" dot tone={stateTone(row.state)} label={stateWord(row.state)}>
          {row.statusLabel}
        </Chip>
      )
    },
    askColumn((row) => ({
      kind: 'setting',
      id: row.id,
      label: row.title,
      detail: stateWord(row.state)
    }))
  ]

  if (permissions === null) {
    return <p role="status">What CiteFox needs is not available in this window.</p>
  }

  return (
    <div className="pm-screen">
      <p className="pm-lede">
        {snapshot ? (
          <>
            <strong className="num">
              {snapshot.readyCount} of {items.length} ready
            </strong>
            {snapshot.requiredOpen > 0
              ? ` · ${snapshot.requiredOpen} required ${snapshot.requiredOpen === 1 ? 'step' : 'steps'} left. `
              : ' · every required item works. '}
          </>
        ) : null}
        CiteFox asks your computer for nothing until you click, and says first what will appear.
      </p>
      <div className="pm-page">
        <div className="pm-page-main">
          {permissions.error ? (
            <p className="field-error" role="alert">
              {permissions.error}
            </p>
          ) : null}
          <ListGrid<PermissionItem>
            label="What CiteFox needs"
            noun={['item', 'items']}
            rows={rows}
            rowKey={(row) => row.id}
            rowLabel={(row) => row.title}
            columns={columns}
            search={{ text: (row) => `${row.title} ${row.purpose} ${row.statusLabel}` }}
            filter={{
              label: 'Show',
              options: [
                { value: 'all', label: 'All' },
                { value: 'todo', label: 'Needs a step' },
                { value: 'ready', label: 'Ready' }
              ],
              value: filter,
              onChange: (value) => setFilter(value === 'todo' || value === 'ready' ? value : 'all')
            }}
            group={{
              key: (row) => ({ key: row.need, label: needLabel(row.need) }),
              order: NEED_ORDER
            }}
            actions={
              <IconButton
                icon="refresh"
                label="Read again"
                data-tip="Read again"
                aria-busy={permissions.loading || undefined}
                disabled={permissions.loading}
                onClick={() => void permissions.refresh()}
              />
            }
            rowMenu={(row) => rowActions(row)}
            onActivate={(row) => navigate(permissionsHash(row.id))}
            isRowCurrent={(row) => row.id === open?.id}
            pageSize="all"
            empty={
              <EmptyState
                title={permissions.loading ? 'Reading what is set up…' : 'Nothing to show'}
              />
            }
          />
          <p className="pm-live" role="status" aria-live="polite">
            {permissions.message ?? ''}
          </p>
        </div>
        {open ? (
          <PermissionDetail
            key={`${open.id}:${confirmFor === open.id ? 'confirm' : 'view'}`}
            item={open}
            confirmFirst={confirmFor === open.id}
            onSetup={setup}
            onDone={() => setConfirmFor(null)}
          />
        ) : null}
      </div>
    </div>
  )
}

/** The rail: what the open item is for, its checks, what the system will show, and its action. */
export function PermissionDetail({
  item,
  confirmFirst = false,
  onSetup,
  onDone
}: {
  item: PermissionItem
  confirmFirst?: boolean
  onSetup: (id: PermissionId) => void
  onDone?: () => void
}): JSX.Element {
  const { button, confirm } = usePermissionAction(item, onSetup, {
    variant: 'secondary',
    size: 'md',
    confirmFirst,
    ...(onDone ? { onDone } : {})
  })
  return (
    <aside className="ui-rail pm-detail-panel" aria-label={`${item.title} details`}>
      <Panel title={item.title} titleAs="h2">
        <div className="pm-detail-chips">
          <Chip size="sm" tone={item.need === 'required' ? 'info' : 'neutral'}>
            {needLabel(item.need)}
          </Chip>
          <Chip size="sm" dot tone={stateTone(item.state)} label={stateWord(item.state)}>
            {item.statusLabel}
          </Chip>
        </div>
        <p className="pm-detail-text">{item.purpose}</p>
        {item.checks.length > 0 ? (
          <ul className="pm-checks" aria-label="Checks">
            {item.checks.map((check) => (
              <li className="pm-check" key={check.label} data-state={check.state}>
                <span className="pm-check-mark" aria-hidden="true">
                  <UiIcon
                    name={
                      check.state === 'ok'
                        ? 'check'
                        : check.state === 'warning'
                          ? 'warning'
                          : 'dots'
                    }
                    size={14}
                  />
                </span>
                <span className="pm-check-label">
                  {check.label}
                  <span className="sr-only"> · {check.state}</span>
                </span>
                <span className="pm-check-detail">{check.detail}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {item.detail ? <p className="pm-detail-text">{item.detail}</p> : null}
        {item.osPrompt && !confirm ? (
          <p className="pm-os">
            <strong>What your computer may show</strong>
            {item.osPrompt}
          </p>
        ) : null}
        {confirm}
        {button}
      </Panel>
    </aside>
  )
}
