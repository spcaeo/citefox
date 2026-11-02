import { useEffect, useMemo, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { AlertLogEntry, AlertRule } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { errorText } from '../../components/errorText'
import { LoadError } from '../../components/LoadError'
import { marketLabel } from '../../shell/model'
import { navigateHash } from '../../shell/routes'
import { useEngineRevision } from '../../shell/engineRevision'
import { useGridQueryState } from '../../utils/queryState'
import { EmptyState, ListGrid, UrlText, type ListColumn } from '../../ui'
import type { RulesClient } from '../rules/rulesClient'
import { pathOf, shortWhen } from '../rules/ruleModel'
import { entryHash } from './logModel'

/**
 * Alert log (`#/alerts/log`): every alert the rules sent, newest first: when, which
 * rule, which page, what changed and where it went. A row opens the check it came
 * from. Search, the rule filter and the sort are on the URL (`log.q`, `log.f`, `log.sort`).
 */
export function AlertLogTab({
  client,
  projectId,
  rules,
  markets,
  site,
  onOpenRule
}: {
  client: RulesClient
  projectId: string
  rules: readonly AlertRule[]
  markets: readonly Market[]
  site: string | null
  onOpenRule: (ruleId: string) => void
}): JSX.Element {
  const grid = useGridQueryState('log')
  const revision = useEngineRevision()
  const [entries, setEntries] = useState<readonly AlertLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    client.log(projectId).then(
      (log) => {
        if (!live) return
        setEntries(log.entries)
        setError(null)
      },
      (cause: unknown) => {
        if (live) setError(errorText(cause, 'Could not load the alert log.'))
      }
    )
    return () => {
      live = false
    }
  }, [client, projectId, attempt, revision])

  const ruleFilter = grid.filter
  const shown = useMemo(
    () =>
      entries === null
        ? []
        : ruleFilter === null
          ? entries
          : entries.filter((entry) => entry.ruleId === ruleFilter),
    [entries, ruleFilter]
  )

  if (error !== null && entries === null) {
    return (
      <LoadError
        title="Could not load the alert log."
        message={error}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    )
  }
  if (entries === null) return <p role="status">Loading the alert log…</p>

  const ruleNames = new Map<string, string>()
  for (const entry of entries) ruleNames.set(entry.ruleId, entry.ruleName)
  for (const rule of rules) ruleNames.set(rule.id, rule.name)

  const columns: readonly ListColumn<AlertLogEntry>[] = [
    {
      id: 'at',
      label: 'Alert',
      width: 180,
      sort: (entry) => entry.at,
      render: (entry) => (
        <span className="ar-cell-stack">
          <time className="num" dateTime={entry.at}>
            {shortWhen(entry.at)}
          </time>
          {rules.some((rule) => rule.id === entry.ruleId) ? (
            <button
              type="button"
              className="ar-link ar-ellipsis"
              onClick={(event) => {
                event.stopPropagation()
                onOpenRule(entry.ruleId)
              }}
            >
              {entry.ruleName}
            </button>
          ) : (
            <span className="faint ar-ellipsis" title="This rule was deleted">
              {entry.ruleName}
            </span>
          )}
        </span>
      )
    },
    {
      id: 'page',
      label: 'Page',
      width: 'fill',
      minWidth: 180,
      sort: (entry) => entry.pageLabel.toLowerCase(),
      render: (entry) => {
        const market = markets.find((item) => item.id === entry.marketId)
        return (
          <span className="ar-cell-stack">
            <span className="ar-ellipsis">
              {entry.pageLabel}
              <span className="faint"> · {market ? marketLabel(market) : entry.marketId}</span>
            </span>
            {entry.pageUrl ? (
              <UrlText
                url={entry.pageUrl}
                site={site}
                label={pathOf(entry.pageUrl)}
                variant="path"
                icon={false}
              />
            ) : (
              <span className="faint">Topic</span>
            )}
          </span>
        )
      }
    },
    {
      id: 'what',
      label: 'What changed',
      width: 220,
      wrap: true,
      render: (entry) => (
        <span className="ar-cell-stack">
          <span>{entry.summary}</span>
          {entry.details[0] ? (
            <span className="faint ar-ellipsis">
              {entry.details[0]}
              {entry.details.length > 1 ? ` +${entry.details.length - 1}` : ''}
            </span>
          ) : null}
        </span>
      )
    },
    {
      id: 'sent',
      label: 'Delivered to',
      width: 130,
      wrap: true,
      render: (entry) => (
        <span
          className={entry.deliveredTo.some((item) => item.includes('failed')) ? 'warn-ink' : ''}
        >
          {entry.deliveredTo.length > 0 ? entry.deliveredTo.join(', ') : 'Nowhere'}
        </span>
      )
    }
  ]

  return (
    <div data-testid="alert-log">
      <ListGrid
        label="Alert log"
        noun={['alert', 'alerts']}
        rows={shown}
        rowKey={(entry) => entry.id}
        rowLabel={(entry) => `${entry.ruleName} on ${entry.pageLabel}`}
        columns={columns}
        search={{
          text: (entry) =>
            `${entry.ruleName} ${entry.pageLabel} ${entry.pageUrl ?? ''} ${entry.summary} ${entry.details.join(' ')}`,
          placeholder: 'Search alerts'
        }}
        {...grid.listProps}
        initialSort={[{ key: 'at', dir: 'desc' }]}
        toolbar={
          <label className="ar-rule-filter">
            <span className="sr-only">Rule</span>
            <select
              className="select"
              value={ruleFilter ?? ''}
              onChange={(event) => grid.setFilter(event.target.value || null)}
            >
              <option value="">Every rule</option>
              {[...ruleNames].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        }
        rowMenu={(entry) => [
          {
            id: 'check',
            label: 'Open the check',
            icon: 'external',
            onSelect: () => navigateHash(entryHash(entry))
          },
          ...(rules.some((rule) => rule.id === entry.ruleId)
            ? [
                {
                  id: 'rule',
                  label: 'Open the rule',
                  icon: 'pencil' as const,
                  onSelect: () => onOpenRule(entry.ruleId)
                }
              ]
            : [])
        ]}
        onActivate={(entry) => navigateHash(entryHash(entry))}
        empty={
          <EmptyState
            icon="inbox"
            title="No alerts sent yet"
            body="When a rule fires after a check, the alert shows here with what changed and where it went."
          />
        }
        summary={(info) =>
          info.matching === entries.length
            ? pluralize(entries.length, 'alert')
            : `${pluralize(info.matching, 'alert')} of ${entries.length.toLocaleString('en-US')}`
        }
      />
    </div>
  )
}
