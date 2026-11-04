import type { JSX } from 'react'
import type { LlmCallRecord, LlmUsage, LlmUsageByConnection, LlmUsageByStep } from '@shared/ipc'
import { formatClock, formatDay } from '../utils/dates'
import { useQueryChoice } from '../utils/queryState'
import {
  Chip,
  EmptyState,
  KpiStrip,
  KpiTile,
  ListGrid,
  TabPanel,
  Tabs,
  type ListColumn
} from '../ui'
import {
  callStep,
  connectionLabel,
  formatSeconds,
  formatTokens,
  stepLabel,
  usageSummary
} from './model'

type UsageTab = 'steps' | 'connections' | 'errors'

/** The tab is `?usage.tab=` in the route; By step, the first, has no value. */
const USAGE_TABS: readonly UsageTab[] = ['steps', 'connections', 'errors']

const STEP_COLUMNS: readonly ListColumn<LlmUsageByStep>[] = [
  {
    id: 'step',
    label: 'Step',
    width: 'fill',
    minWidth: 180,
    sort: (row) => stepLabel(row.step),
    render: (row) => stepLabel(row.step)
  },
  {
    id: 'calls',
    label: 'Calls',
    width: 90,
    numeric: true,
    sort: (row) => row.calls,
    render: (row) => row.calls.toLocaleString('en-US')
  },
  {
    id: 'failed',
    label: 'Failed',
    width: 90,
    numeric: true,
    sort: (row) => row.failed,
    render: (row) => row.failed.toLocaleString('en-US')
  },
  {
    id: 'time',
    label: 'Average time',
    width: 120,
    numeric: true,
    sort: (row) => row.averageDurationMs,
    render: (row) => `about ${formatSeconds(row.averageDurationMs)}`
  }
]

const CONNECTION_COLUMNS: readonly ListColumn<LlmUsageByConnection>[] = [
  {
    id: 'connection',
    label: 'Connection',
    width: 'fill',
    minWidth: 200,
    sort: (row) => connectionLabel(row.connection),
    render: (row) => connectionLabel(row.connection)
  },
  {
    id: 'calls',
    label: 'Calls',
    width: 100,
    numeric: true,
    sort: (row) => row.calls,
    render: (row) => row.calls.toLocaleString('en-US')
  },
  {
    id: 'in',
    label: 'Tokens in',
    width: 110,
    numeric: true,
    sort: (row) => row.tokensIn,
    render: (row) => formatTokens(row.tokensIn)
  },
  {
    id: 'out',
    label: 'Tokens out',
    width: 110,
    numeric: true,
    sort: (row) => row.tokensOut,
    render: (row) => formatTokens(row.tokensOut)
  }
]

const ERROR_COLUMNS: readonly ListColumn<LlmCallRecord>[] = [
  {
    id: 'when',
    label: 'When',
    width: 140,
    sort: (row) => row.startedAt,
    render: (row) => (
      <span className="num">
        {formatDay(row.startedAt, { year: false })} · {formatClock(row.startedAt)}
      </span>
    )
  },
  {
    id: 'step',
    label: 'Step',
    width: 180,
    sort: (row) => stepLabel(callStep(row)),
    render: (row) => stepLabel(callStep(row))
  },
  {
    id: 'error',
    label: 'Error',
    width: 'fill',
    minWidth: 220,
    render: (row) => <span className="cu-error-text">{row.error ?? 'Failed'}</span>
  }
]

/**
 * CiteFox AI usage, v2 layout: four KPI tiles (calls today and this month,
 * tokens in and out this month), then By step, By connection and Recent
 * errors as list grids under tabs.
 */
export function UsageDetail({ usage, idBase }: { usage: LlmUsage; idBase: string }): JSX.Element {
  const [tab, setTab] = useQueryChoice('usage.tab', USAGE_TABS, 'steps')
  const panels = `${idBase}-usage`
  return (
    <div className="cu-detail">
      <p className="sr-only">{usageSummary(usage)}</p>
      <KpiStrip className="cu-kpis">
        <KpiTile
          label="Calls today"
          value={usage.callsToday.toLocaleString('en-US')}
          chip={
            usage.failedToday > 0 ? (
              <Chip tone="warn" size="sm">
                {usage.failedToday} failed today
              </Chip>
            ) : undefined
          }
        />
        <KpiTile label="Calls this month" value={usage.callsThisMonth.toLocaleString('en-US')} />
        <KpiTile label="Tokens in · month" value={formatTokens(usage.tokensInThisMonth)} />
        <KpiTile label="Tokens out · month" value={formatTokens(usage.tokensOutThisMonth)} />
      </KpiStrip>
      <Tabs
        label="CiteFox AI usage"
        tabs={[
          { id: 'steps', label: 'By step', count: usage.byStep.length },
          { id: 'connections', label: 'By connection', count: usage.byConnection.length },
          { id: 'errors', label: 'Recent errors', count: usage.recentErrors.length }
        ]}
        value={tab}
        onChange={setTab}
        panelId={panels}
      />
      <TabPanel panelId={panels} id="steps" hidden={tab !== 'steps'}>
        <ListGrid
          urlKey="ustep"
          label="CiteFox AI calls by step this month"
          noun={['step', 'steps']}
          rows={usage.byStep}
          rowKey={(row) => row.step}
          rowLabel={(row) => stepLabel(row.step)}
          columns={STEP_COLUMNS}
          initialSort={[{ key: 'calls', dir: 'desc' }]}
          pageSize={10}
          empty={<EmptyState compact title="No CiteFox AI calls this month yet." />}
        />
      </TabPanel>
      <TabPanel panelId={panels} id="connections" hidden={tab !== 'connections'}>
        <ListGrid
          urlKey="uconn"
          label="CiteFox AI calls by connection this month"
          noun={['connection', 'connections']}
          rows={usage.byConnection}
          rowKey={(row) => row.connection}
          rowLabel={(row) => connectionLabel(row.connection)}
          columns={CONNECTION_COLUMNS}
          empty={<EmptyState compact title="No CiteFox AI calls this month yet." />}
        />
      </TabPanel>
      <TabPanel panelId={panels} id="errors" hidden={tab !== 'errors'}>
        <ListGrid
          urlKey="uerr"
          label="Recent CiteFox AI errors"
          noun={['error', 'errors']}
          rows={usage.recentErrors}
          rowKey={(row) => row.id}
          rowLabel={(row) => `${stepLabel(callStep(row))} at ${formatClock(row.startedAt)}`}
          columns={ERROR_COLUMNS}
          empty={<EmptyState compact icon="check" title="No errors" />}
        />
      </TabPanel>
    </div>
  )
}
