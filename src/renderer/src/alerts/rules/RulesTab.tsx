import { useMemo, useState, type JSX } from 'react'
import type { AlertRule, AlertRuleStatus } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import type { ScopeOptions } from '../../scope'
import { useGridQueryState } from '../../utils/queryState'
import { Button, Chip, Confirm, EmptyState, ListGrid, type ListColumn } from '../../ui'
import { deliveryText, marketsText, scopeText, sendToText, shortDay, whenText } from './ruleModel'
import './rules.css'

export interface RuleActions {
  create: () => void
  edit: (rule: AlertRule) => void
  duplicate: (rule: AlertRule) => void
  setStatus: (rules: readonly AlertRule[], status: AlertRuleStatus) => Promise<void>
  remove: (rules: readonly AlertRule[]) => Promise<void>
  /** The Alert log, filtered to this rule. */
  openLog: (rule: AlertRule) => void
}

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'On' },
  { value: 'paused', label: 'Paused' }
] as const

/**
 * Alert rules as a list (`#/alerts`): what each rule watches, where it goes, how often,
 * and when it last fired. A row opens its drawer; ⋯ edits, duplicates, pauses or deletes;
 * the bulk bar pauses, resumes or deletes many. Search, filter and sort are on the URL.
 */
export function RulesTab({
  rules,
  options,
  openRuleId,
  actions
}: {
  rules: readonly AlertRule[]
  options: ScopeOptions | null
  /** The rule open in the drawer, marked in the list. */
  openRuleId: string | null
  actions: RuleActions
}): JSX.Element {
  const grid = useGridQueryState('rules')
  const filter = grid.filter ?? 'all'
  const [deleting, setDeleting] = useState<{
    rules: readonly AlertRule[]
    done: () => void
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const markets = options?.markets ?? []
  const shown = useMemo(
    () => (filter === 'all' ? rules : rules.filter((rule) => rule.status === filter)),
    [rules, filter]
  )

  const columns: readonly ListColumn<AlertRule>[] = [
    {
      id: 'name',
      label: 'Rule',
      width: 'fill',
      minWidth: 180,
      sort: (rule) => rule.name.toLowerCase(),
      render: (rule) => (
        <span className="ar-cell-stack">
          <strong className="ar-rule-name">{rule.name}</strong>
          <span className="faint">{whenText(rule)}</span>
        </span>
      )
    },
    {
      id: 'scope',
      label: 'Watches',
      width: 150,
      sort: (rule) => scopeText(rule.scope, options),
      render: (rule) => (
        <span className="ar-cell-stack">
          <span>{scopeText(rule.scope, options)}</span>
          <span className="faint">{marketsText(rule.marketIds, markets)}</span>
        </span>
      )
    },
    {
      id: 'send',
      label: 'Send to',
      width: 160,
      render: (rule) => (
        <span className="ar-cell-stack">
          <span className="ar-ellipsis">{sendToText(rule)}</span>
          <span className="faint">{deliveryText(rule.delivery)}</span>
        </span>
      )
    },
    {
      id: 'fired',
      label: 'Fired',
      width: 100,
      numeric: true,
      sort: (rule) => rule.firedCount,
      render: (rule) => (
        <span className="ar-cell-stack ar-cell-end">
          <span className="num">{rule.firedCount.toLocaleString('en-US')}</span>
          <span className="faint">
            {rule.lastFiredAt ? `last ${shortDay(rule.lastFiredAt)}` : 'not yet'}
          </span>
        </span>
      )
    },
    {
      id: 'status',
      label: 'Status',
      width: 84,
      sort: (rule) => rule.status,
      render: (rule) =>
        rule.status === 'active' ? (
          <Chip tone="ok" size="sm" dot>
            On
          </Chip>
        ) : (
          <Chip tone="neutral" size="sm">
            Paused
          </Chip>
        )
    }
  ]

  async function run(task: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ar-rules" data-testid="alert-rules">
      <ListGrid
        label="Alert rules"
        noun={['rule', 'rules']}
        rows={shown}
        rowKey={(rule) => rule.id}
        rowLabel={(rule) => rule.name}
        columns={columns}
        search={{
          text: (rule) => `${rule.name} ${whenText(rule)} ${rule.emailTo.join(' ')}`,
          placeholder: 'Search rules'
        }}
        {...grid.listProps}
        filter={{
          label: 'Status',
          options: FILTERS,
          value: filter,
          onChange: (value) => grid.setFilter(value === 'all' ? null : value)
        }}
        actions={
          <Button variant="primary" size="sm" icon="plus" onClick={actions.create}>
            New rule
          </Button>
        }
        bulk={({ selected, clear }) => (
          <>
            <Button
              size="sm"
              icon="pause"
              disabled={busy}
              onClick={() => void run(() => actions.setStatus(selected, 'paused')).then(clear)}
            >
              Pause {selected.length}
            </Button>
            <Button
              size="sm"
              icon="play"
              disabled={busy}
              onClick={() => void run(() => actions.setStatus(selected, 'active')).then(clear)}
            >
              Resume {selected.length}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon="trash"
              disabled={busy}
              onClick={() => setDeleting({ rules: selected, done: clear })}
            >
              Delete {selected.length}
            </Button>
          </>
        )}
        rowMenu={(rule) => [
          { id: 'edit', label: 'Edit rule', icon: 'pencil', onSelect: () => actions.edit(rule) },
          {
            id: 'duplicate',
            label: 'Duplicate rule',
            icon: 'copy',
            onSelect: () => actions.duplicate(rule)
          },
          rule.status === 'active'
            ? {
                id: 'pause',
                label: 'Pause rule',
                icon: 'pause',
                onSelect: () => void run(() => actions.setStatus([rule], 'paused'))
              }
            : {
                id: 'resume',
                label: 'Resume rule',
                icon: 'play',
                onSelect: () => void run(() => actions.setStatus([rule], 'active'))
              },
          {
            id: 'log',
            label: 'See what it sent',
            icon: 'list',
            onSelect: () => actions.openLog(rule)
          },
          {
            id: 'delete',
            label: 'Delete rule',
            icon: 'trash',
            tone: 'danger',
            groupStart: true,
            onSelect: () => setDeleting({ rules: [rule], done: () => undefined })
          }
        ]}
        onActivate={actions.edit}
        isRowCurrent={(rule) => rule.id === openRuleId}
        virtualize={false}
        empty={
          <EmptyState
            icon="bolt"
            title="No alert rules yet"
            body="A rule tells you only when something important changes: a lost citation, a score drop, a competitor cited instead. Each one is checked after every check."
            action={
              <Button variant="primary" icon="plus" onClick={actions.create}>
                New rule
              </Button>
            }
          />
        }
        summary={(info) =>
          `${pluralize(info.matching, 'rule')} · ${pluralize(
            rules.filter((rule) => rule.status === 'active').length,
            'rule'
          )} on`
        }
      />
      {deleting ? (
        <Confirm
          title={
            deleting.rules.length === 1
              ? 'Delete this alert rule?'
              : `Delete ${deleting.rules.length} alert rules?`
          }
          body={
            deleting.rules.length === 1
              ? `“${deleting.rules[0]?.name ?? ''}” stops firing. Alerts it already sent stay in the Alert log.`
              : 'They stop firing. Alerts they already sent stay in the Alert log.'
          }
          confirmLabel={deleting.rules.length === 1 ? 'Delete rule' : 'Delete rules'}
          busy={busy}
          onConfirm={() =>
            void run(() => actions.remove(deleting.rules)).then(() => {
              deleting.done()
              setDeleting(null)
            })
          }
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </div>
  )
}
