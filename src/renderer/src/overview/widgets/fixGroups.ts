import type { ChangeLedger } from '@shared/ipc'
import { verdictLabel } from '@shared/fix-verdict'
import { verdictOf } from '../../changes/verdict'
import type { DrillItem, ItemDrill } from '../../drill'
import { viewFixValues } from '../../fixes/drawer/model'
import { changePath } from '../../pageChanges/model'
import { formatWhen } from '../../utils/dates'

/** Fixes working: each logged fix in one of three groups by its verdict. Pure. */
export type VerdictGroup = 'worked' | 'early' | 'none'

export const GROUP_TITLE: Readonly<Record<VerdictGroup, string>> = {
  worked: 'Worked',
  early: 'Too early',
  none: 'No change'
}

function groupOf(state: string): VerdictGroup {
  if (state === 'worked') return 'worked'
  if (state === 'no_change' || state === 'worse') return 'none'
  return 'early'
}

/** The fixes behind one verdict group, each opening its fix drawer. */
export function fixGroupDrills(ledger: ChangeLedger): Record<VerdictGroup, ItemDrill> {
  const items: Record<VerdictGroup, DrillItem[]> = { worked: [], early: [], none: [] }
  for (const row of ledger.rows) {
    const view = verdictOf(row.measure, row.liveSince, ledger.builtAt)
    items[groupOf(view.state)].push({
      id: row.fixId,
      primary: `Fix ${row.number} · ${row.title ?? changePath(row)}`,
      secondary: row.url,
      target: { kind: 'drawer', id: 'fix', values: viewFixValues(row.fixId) },
      cells: { verdict: verdictLabel(view), live: formatWhen(row.liveSince) }
    })
  }
  const scope = {
    pageId: null,
    marketId: null,
    runId: null,
    marketLabel: '',
    checkDateLabel: '',
    brand: ledger.brand,
    domain: ledger.domain
  }
  const make = (group: VerdictGroup, description: string): ItemDrill => ({
    kind: 'items',
    id: `w:fixes:${group}`,
    title: `Fixes: ${GROUP_TITLE[group]}`,
    description,
    noun: ['fix', 'fixes'],
    primaryLabel: 'Fix',
    columns: [
      { id: 'verdict', label: 'Did it work?', width: 'minmax(140px, 0.6fr)' },
      { id: 'live', label: 'Live since', width: 'minmax(110px, 0.4fr)' }
    ],
    items: items[group],
    note: 'Select a fix to open it.',
    scope
  })
  return {
    worked: make(
      'worked',
      'Fixes whose searches cite the page more than before, after 14 days live.'
    ),
    early: make('early', 'Fixes live less than 14 days, or waiting for a check: no verdict yet.'),
    none: make('none', 'Fixes live 14 days or more whose searches did not move up.')
  }
}
