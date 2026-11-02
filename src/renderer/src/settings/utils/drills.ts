import type { ClaudeCheckupResult } from '@shared/ipc'
import type { ItemDrill } from '../../drill/types'
import { APP_SCOPE, formatCount } from '../../keys/serpUsage'
import { sectionHash } from '../../shell/routes'
import { planLabel } from '@shared/plan-label'

const CONNECTIONS = { kind: 'hash', hash: sectionHash('connections') } as const

/** The Claude Code line: the last checkup's three rows, opening Connections. */
export function checkupDrill(checkup: ClaudeCheckupResult): ItemDrill {
  const rows: readonly { id: string; label: string; row: ClaudeCheckupResult['rows']['binary'] }[] =
    [
      { id: 'binary', label: 'Claude Code installed', row: checkup.rows.binary },
      { id: 'login', label: 'Logged in', row: checkup.rows.login },
      { id: 'roundTrip', label: 'Answers a test call', row: checkup.rows.roundTrip }
    ]
  const facts = [
    checkup.binaryPath ? `Path \`${checkup.binaryPath}\`` : null,
    checkup.version ? `version ${checkup.version}` : null,
    checkup.plan ? planLabel(checkup.plan) : null,
    checkup.resolvedModel ? `model ${checkup.resolvedModel}` : null,
    checkup.durationMs === null ? null : `test call ${formatCount(checkup.durationMs)} ms`
  ].filter((part): part is string => part !== null)
  return {
    kind: 'items',
    id: 'settings:claude-checkup',
    title: 'Claude Code checkup',
    description: [checkup.message, facts.length > 0 ? `${facts.join(' · ')}.` : null]
      .filter((part): part is string => part !== null)
      .join(' '),
    noun: ['check', 'checks'],
    primaryLabel: 'Check',
    columns: [{ id: 'state', label: 'Result', width: '120px' }],
    items: rows.map(({ id, label, row }) => ({
      id,
      primary: label,
      secondary: row.detail,
      target: CONNECTIONS,
      cells: { state: row.statusLabel },
      detail: row.nextStep ? `**Next step:** ${row.nextStep}` : null
    })),
    note: 'Select a check to run the checkup again in Connections.',
    scope: APP_SCOPE
  }
}
