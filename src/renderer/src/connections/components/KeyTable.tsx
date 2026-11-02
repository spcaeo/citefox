import { useEffect, useState, type JSX } from 'react'
import type { ApiKeyMetadata, ConnectionActivityLog } from '@shared/domain'
import { askColumn } from '../../assistant/sparkle/askColumn'
import { DrillButton } from '../../drill'
import { EmptyState, IconButton, ListGrid, Panel, type ListColumn, type MenuItem } from '../../ui'
import type { KeyActions } from '../hooks/useKeyActions'
import { keyProjectsDrill, keyUsageDrill } from '../utils/drills'
import { keyRowId, type KeyFocusRequest } from '../utils/keyFocus'
import {
  accountLine,
  maskOf,
  planOf,
  servesLabel,
  SORT_NOTE,
  statusTone,
  statusWhy,
  statusWords,
  usedLine,
  usedOf,
  usedPercent,
  type ProjectRef
} from '../utils/model'
import { KeyRowEditor } from './KeyRowEditor'
import { KeyStatusPanel } from './KeyStatusPanel'

/** Columns a narrow window gives up first, so Used this month and Status never clip. */
const NARROW_DROPS = ['projects', 'order', 'key'] as const

const STATUS_ORDER: Readonly<Record<ReturnType<typeof statusTone>, number>> = {
  warning: 0,
  unchecked: 1,
  ok: 2,
  off: 3
}

/**
 * One provider's keys (FR-11.1, FR-11.5) as a v2 list grid. Rows arrive in
 * rotation order (the Order column); sorting a header changes this view only,
 * and Move up or down in the row menu changes the real order. A row opens the
 * key's status and settings in the panel under the grid.
 */
export function KeyTable({
  keys,
  title,
  caption,
  actions,
  projects,
  detailed,
  ordered = true,
  log = null,
  activeProjectId = null,
  focus = null
}: {
  /** One provider's keys, in rotation order. */
  keys: readonly ApiKeyMetadata[]
  title: string
  /** Accessible name of the grid. */
  caption: string
  actions: KeyActions
  projects: readonly ProjectRef[]
  /** SerpApi: plan, usage, and projects columns. */
  detailed: boolean
  /** False hides the Order column and the sort note (Anthropic keys are chosen per project). */
  ordered?: boolean
  /** Activity rows for the usage and events drawers. */
  log?: ConnectionActivityLog | null
  activeProjectId?: string | null
  focus?: KeyFocusRequest | null
}): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [seenFocus, setSeenFocus] = useState<KeyFocusRequest | null>(null)
  if (focus !== seenFocus) {
    setSeenFocus(focus)
    if (focus && keys.some((key) => key.id === focus.keyId)) setEditing(focus.keyId)
  }
  useEffect(() => {
    if (!focus) return
    const button = document.getElementById(keyRowId(focus.keyId))
    if (!button) return
    button.scrollIntoView?.({ block: 'center' })
    button.focus()
  }, [focus])
  const toggle = (id: string): void => setEditing((current) => (current === id ? null : id))
  const position = (key: ApiKeyMetadata): number => keys.findIndex((item) => item.id === key.id)
  const open = keys.find((key) => key.id === editing) ?? null

  const columns: ListColumn<ApiKeyMetadata>[] = [
    ...(ordered
      ? [
          {
            id: 'order',
            label: 'Order',
            width: 56,
            numeric: true,
            align: 'start' as const,
            sort: (key: ApiKeyMetadata) => position(key),
            render: (key: ApiKeyMetadata) => (
              <span className="mono" title="Rotation order">
                {position(key) + 1}
              </span>
            )
          }
        ]
      : []),
    {
      id: 'name',
      label: 'Name',
      width: 'fill',
      // 120, not 160: every column, Projects included, fits the default 1280px window.
      minWidth: 120,
      sort: (key) => key.name.toLowerCase(),
      render: (key) => (
        <span className="conn-name-cell">
          <button
            type="button"
            id={keyRowId(key.id)}
            className="drill-num key-name"
            aria-expanded={editing === key.id}
            aria-label={`${key.name}: show its status and settings`}
            onClick={() => toggle(key.id)}
          >
            {key.name}
          </button>
          {detailed && planOf(key) ? <span className="faint">{planOf(key)}</span> : null}
        </span>
      )
    },
    {
      id: 'key',
      label: 'Key',
      width: 112,
      cellClassName: 'mono',
      render: (key) => maskOf(key)
    },
    ...(detailed
      ? [
          {
            id: 'used',
            label: 'Used this month',
            width: 184,
            sort: (key: ApiKeyMetadata) => usedOf(key),
            render: (key: ApiKeyMetadata) => {
              // CiteFox's own figure, and under it the account's, so "Near cap" explains itself.
              const account = accountLine(key)
              return (
                <span className="conn-used">
                  <DrillButton
                    drill={keyUsageDrill(key, log, activeProjectId)}
                    className="drill-num mini"
                    label={
                      key.provider === 'cloro'
                        ? `${usedLine(key)} on ${key.name} this month: show each project`
                        : `${usedLine(key)} searches used on ${key.name} this month: show each project`
                    }
                    untracked
                  >
                    {key.provider === 'cloro' ? null : (
                      <span className="bar" aria-hidden="true">
                        <span style={{ width: `${usedPercent(key)}%` }} />
                      </span>
                    )}
                    <span className="mono">{usedLine(key)}</span>
                  </DrillButton>
                  {account ? (
                    <span className="conn-used-account faint" title={account}>
                      {account}
                    </span>
                  ) : null}
                </span>
              )
            }
          },
          {
            id: 'projects',
            label: 'Projects',
            width: 112,
            render: (key: ApiKeyMetadata) => (
              <DrillButton
                drill={keyProjectsDrill(key, projects, activeProjectId)}
                className="drill-num"
                label={`${key.name} serves ${servesLabel(key.projectIds, projects)}: list them`}
                untracked
              >
                {servesLabel(key.projectIds, projects)}
              </DrillButton>
            )
          }
        ]
      : []),
    {
      id: 'status',
      label: 'Status',
      width: 112,
      sort: (key) => STATUS_ORDER[statusTone(key)],
      render: (key) => {
        const why = statusWhy(key)
        return (
          <button
            type="button"
            className={`st st-${statusTone(key)} conn-status-btn`}
            aria-expanded={editing === key.id}
            aria-label={`${key.name} status: ${statusWords(key)}.${why ? ` ${why}` : ''} Show details`}
            title={why ?? undefined}
            onClick={() => setEditing(key.id)}
          >
            {statusWords(key)}
          </button>
        )
      }
    },
    {
      id: 'on',
      label: 'On',
      width: 48,
      render: (key) => (
        <button
          type="button"
          role="switch"
          className={key.on ? 'switch on' : 'switch'}
          aria-checked={key.on}
          aria-label={`Use ${key.name}`}
          disabled={actions.busy}
          onClick={() => void actions.toggle(key)}
        >
          <span className="knob" />
        </button>
      )
    }
  ]

  function menu(key: ApiKeyMetadata): readonly MenuItem[] {
    const at = position(key)
    return [
      {
        id: 'test',
        label: 'Test key',
        icon: 'refresh',
        disabled: actions.busy,
        onSelect: () => void actions.test(key)
      },
      {
        id: 'edit',
        label: editing === key.id ? 'Close settings' : 'Edit key',
        icon: 'pencil',
        onSelect: () => toggle(key.id)
      },
      ...(ordered
        ? [
            {
              id: 'up',
              label: 'Move up in rotation order',
              icon: 'arrow-up' as const,
              disabled: actions.busy || at === 0,
              onSelect: () => void actions.move(keys, key, -1)
            },
            {
              id: 'down',
              label: 'Move down in rotation order',
              icon: 'arrow-down' as const,
              disabled: actions.busy || at === keys.length - 1,
              onSelect: () => void actions.move(keys, key, 1)
            }
          ]
        : [])
    ]
  }

  return (
    <div className="conn-keys">
      <ListGrid
        label={caption}
        noun={[`${title} key`, `${title} keys`]}
        rows={keys}
        rowKey={(key) => key.id}
        rowLabel={(key) => key.name}
        columns={[
          ...columns,
          askColumn((key: ApiKeyMetadata) => ({
            kind: 'connection',
            id: key.id,
            label: `${title} key ${key.name}`
          }))
        ]}
        rowMenu={menu}
        onActivate={(key) => toggle(key.id)}
        isRowCurrent={(key) => key.id === editing}
        pageSize="all"
        narrowDrops={NARROW_DROPS}
        summary={(info) =>
          `${info.total.toLocaleString('en-US')} ${info.total === 1 ? 'key' : 'keys'}${
            ordered ? `. ${SORT_NOTE}` : ''
          }`
        }
        empty={<EmptyState title={`No ${title} keys yet`} compact />}
      />
      {open ? (
        <Panel
          title={open.name}
          titleAs="h3"
          tone="inset"
          className="conn-editor-panel"
          actions={
            <IconButton
              icon="x"
              label={`Close ${open.name} settings`}
              size="sm"
              onClick={() => setEditing(null)}
            />
          }
        >
          <KeyStatusPanel keyMeta={open} actions={actions} log={log} />
          <KeyRowEditor
            key={open.id}
            keyMeta={open}
            title={title}
            actions={actions}
            projects={projects}
            showPlanAndCap={detailed}
            showProjects={detailed}
            onClose={() => setEditing(null)}
          />
        </Panel>
      ) : null}
    </div>
  )
}
