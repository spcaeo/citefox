import type { JSX, ReactNode } from 'react'
import type { ClaudeProvider, ConnectionState, JinaMode } from '@shared/domain'
import type { ConnectionsOverview, StatusCapsule } from '@shared/ipc'
import { DrillButton } from '../../drill'
import { serpKeysDrill, serpUsageSummary, usageNoun } from '../../keys/serpUsage'
import { loginStatusLabel } from '../../onboarding/claudeLogin'
import { navigateHash, sectionHash } from '../../shell/routes'
import { withHashTab } from '../../shell/useHashTab'
import { LinkButton, ListGrid, type ListColumn } from '../../ui'
import { count, keyProblem, monthResetLabel } from '../utils/model'
import { StateChip } from './StatusSection'
import { aiCliCopy, checkupProvider } from '../../connections/aiProvider'

/** One service in the summary. `id` is the name link's id, which the status popover focuses. */
interface ConnectionRow {
  id: 'st-serp' | 'st-claude' | 'st-jina' | 'st-yt'
  name: string
  state: ConnectionState
  keys: number
  summary: ReactNode
  problem: string | null
}

function jinaLine(mode: JinaMode | null): string {
  if (mode === 'always') return 'Always reads pages through Jina'
  if (mode === 'never') return 'Never uses Jina'
  return 'Used when a normal fetch fails'
}

function keyWord(total: number): string {
  return total === 1 ? '1 key' : `${count(total)} keys`
}

/** The SerpApi line: searches used of the monthly total over every key (drills to the keys). */
function serpSummary(
  overview: ConnectionsOverview,
  capsule: StatusCapsule | null,
  now: Date
): ReactNode {
  const summary = serpUsageSummary(overview.keys)
  const left = capsule?.searchesLeft ?? overview.searchesLeft
  const total = overview.keys.filter((key) => key.provider === 'serpapi').length
  if (total === 0) return 'No SerpApi key yet. Add one to run checks.'
  if (!summary) {
    return left === null
      ? 'Searches left are not known yet. Test a key to read its plan.'
      : `${count(left)} searches left this month`
  }
  const words = `${count(summary.used)} of ${count(summary.limit)} ${usageNoun(summary)}`
  return (
    <>
      <DrillButton drill={serpKeysDrill(overview.keys)} label={`${words}: show each key`} untracked>
        {words}
      </DrillButton>
      {left === null ? null : ` · ${count(left)} left`} · resets {monthResetLabel(now)}
    </>
  )
}

/** The four services as rows: state, keys and one line each (FR-24.2). */
function connectionRows({
  overview,
  capsule,
  now,
  provider,
  jinaMode
}: {
  overview: ConnectionsOverview
  capsule: StatusCapsule | null
  now: Date
  provider: ClaudeProvider | null
  jinaMode: JinaMode | null
}): ConnectionRow[] {
  const keysOf = (kind: string): typeof overview.keys =>
    overview.keys.filter((key) => key.provider === kind)
  const firstProblem = (kind: string): string | null =>
    keysOf(kind)
      .map((key) => keyProblem(key))
      .find((problem): problem is string => problem !== null) ?? null
  const checkup = overview.claudeCheckup
  const youtube = keysOf('youtube').length
  return [
    {
      id: 'st-serp',
      name: 'SerpApi',
      state: capsule?.serpapi ?? overview.serpapi,
      keys: keysOf('serpapi').length,
      summary: serpSummary(overview, capsule, now),
      problem: firstProblem('serpapi')
    },
    {
      id: 'st-claude',
      name: 'Claude',
      state: overview.claudeCode,
      keys: keysOf('anthropic').length,
      summary: [
        `${aiCliCopy(checkupProvider(checkup)).program}: ${checkup ? loginStatusLabel(checkup) : 'not checked yet'}`,
        provider
          ? `writes with ${provider === 'anthropic-api' ? 'the Anthropic API' : aiCliCopy(provider).program}`
          : null
      ]
        .filter(Boolean)
        .join(' · '),
      problem:
        checkup && !checkup.ready && checkup.nextStep ? checkup.nextStep : firstProblem('anthropic')
    },
    {
      id: 'st-jina',
      name: 'Jina Reader',
      state: overview.jina,
      keys: keysOf('jina').length,
      summary: `${keyWord(keysOf('jina').length)} · ${jinaLine(jinaMode)}`,
      problem: firstProblem('jina')
    },
    {
      id: 'st-yt',
      name: 'YouTube Data API',
      state: youtube > 0 ? overview.youtube : 'off',
      keys: youtube,
      summary: youtube > 0 ? keyWord(youtube) : 'Add a key to see video views. Optional.',
      problem: firstProblem('youtube')
    }
  ]
}

/** Each service's tab on the Connections screen (cloro is its first tab, so each row names its own). */
const CONNECTIONS_TAB: Readonly<Record<ConnectionRow['id'], string>> = {
  'st-serp': 'serpapi',
  'st-claude': 'claude',
  'st-jina': 'jina',
  'st-yt': 'youtube'
}

/**
 * Status › Connections: one summary row per service. Keys are listed and
 * changed only on the Connections screen; each name and the toolbar link
 * open it.
 */
export function ConnectionsSummary(props: {
  overview: ConnectionsOverview
  capsule: StatusCapsule | null
  now: Date
  provider: ClaudeProvider | null
  jinaMode: JinaMode | null
}): JSX.Element {
  const connections = sectionHash('connections')
  const columns: ListColumn<ConnectionRow>[] = [
    {
      id: 'name',
      label: 'Connection',
      width: 200,
      render: (row) => (
        <a
          id={row.id}
          className="sts-conn-name"
          href={withHashTab(connections, CONNECTIONS_TAB[row.id])}
        >
          {row.name}
        </a>
      )
    },
    {
      id: 'state',
      label: 'State',
      width: 128,
      render: (row) => <StateChip state={row.state} />
    },
    {
      id: 'summary',
      label: 'This month',
      width: 'fill',
      minWidth: 240,
      render: (row) => (
        <span className="sts-conn-line">
          <span className="sts-clip">{row.summary}</span>
          {row.problem ? (
            <span className="st-problem sts-clip">Last problem: {row.problem}</span>
          ) : null}
        </span>
      )
    },
    {
      id: 'keys',
      label: 'Keys',
      width: 72,
      numeric: true,
      render: (row) => row.keys
    }
  ]
  return (
    <ListGrid<ConnectionRow>
      label="Connections"
      noun={['connection', 'connections']}
      rows={connectionRows(props)}
      rowKey={(row) => row.id}
      rowLabel={(row) => row.name}
      columns={columns}
      toolbar={<h2 className="st-title">Connections</h2>}
      actions={
        <LinkButton href={connections} size="sm" iconEnd="arrow-right">
          Manage in Connections
        </LinkButton>
      }
      onActivate={(row) => navigateHash(withHashTab(connections, CONNECTIONS_TAB[row.id]))}
      summary={() => 'Keys are listed, tested and changed in Connections.'}
      empty={null}
    />
  )
}
