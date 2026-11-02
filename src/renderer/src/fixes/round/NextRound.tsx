import type { JSX } from 'react'
import { isLoopStep, type LoopStep } from '@shared/fix-loop'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import type { AssistClient } from '../../assist/client'
import { useAiContext } from '../../assistant/context/useAiContext'
import { pagesDrill } from '../../changes/drills'
import { pageName } from '../../changes/model'
import { DrillNumber } from '../../drill'
import { openDrawer } from '../../shell/drawers'
import { KpiStrip, KpiTile } from '../../ui'
import { backlinkRows } from '../backlinks/model'
import { newFixValues } from '../drawer/model'
import type { ProjectFixesSource } from '../source'
import { viewPatch, type ScreenKey, type SetScreenQuery } from '../views'
import { DraftPanel } from './DraftPanel'
import { IndexSection } from './IndexSection'
import { LoopSteps } from './LoopSteps'
import { notIndexedRows, roundRows, tooNewRows } from './model'
import { RoundGrid } from './RoundGrid'
import './round.css'

/**
 * Next round (the Fixes screen's default view): the five steps with their owners,
 * four headline numbers, the Google index check, and the pages going into the next
 * round. Owner edits, the index confirm and the draft drawer are in the URL.
 */
export function NextRound({
  ledger,
  projectId,
  client,
  assistClient,
  query,
  setQuery,
  reload
}: {
  ledger: ChangeLedger
  projectId: string
  client: ProjectFixesSource
  assistClient?: AssistClient
  query: Readonly<Record<ScreenKey, string | null>>
  setQuery: SetScreenQuery
  reload: () => void
}): JSX.Element {
  const editing: LoopStep | null = isLoopStep(query.owner) ? query.owner : null
  const draftRow = roundRows(ledger).find((row) => row.pageId === query.draft) ?? null
  const inRound = roundRows(ledger)
  const tooNew = tooNewRows(ledger)
  const notIndexed = notIndexedRows(ledger)
  const backlinks = backlinkRows(ledger).map((item) => item.row)
  useAiContext({
    ...(draftRow ? { pageId: draftRow.pageId } : {}),
    numbers: [
      { label: 'In the next round now', value: String(inRound.length), drill: 'round:kpi:in' },
      { label: 'Too new to judge', value: String(tooNew.length), drill: 'round:kpi:new' },
      { label: 'Not indexed', value: String(notIndexed.length), drill: 'round:kpi:index' },
      {
        label: 'Pages to build backlinks to',
        value: String(backlinks.length),
        drill: 'round:kpi:links'
      }
    ],
    facts: [`Next round: ${inRound.map(pageName).slice(0, 8).join(', ') || 'no pages'}`],
    capabilities: ['draft-fix']
  })

  async function saveOwner(step: LoopStep, label: string): Promise<void> {
    await client['fixes:setOwner']({ projectId, step, label })
    setQuery({ owner: null }, { replace: true })
    reload()
  }

  function openChange(row: ChangeRow): void {
    setQuery({ ...viewPatch('changes'), row: row.fixId })
  }

  return (
    <div className="fxp-view rnd-view">
      <LoopSteps
        ledger={ledger}
        editing={editing}
        onEdit={(step) => setQuery({ owner: step }, { replace: step === null })}
        onSaveOwner={saveOwner}
      />
      <KpiStrip label="Next round numbers">
        <KpiTile
          label="In the next round now"
          value={
            <DrillNumber
              drill={pagesDrill(ledger, inRound, {
                id: 'round:kpi:in',
                title: 'In the next round',
                description: 'Pages not cited yet, and pages that lost ground.'
              })}
            />
          }
          sub="Not cited yet, or lost ground"
        />
        <KpiTile
          label="Too new to judge"
          value={
            <DrillNumber
              drill={pagesDrill(ledger, tooNew, {
                id: 'round:kpi:new',
                title: 'Too new to judge',
                description: 'Live 3 days or less. The next check measures them.'
              })}
            />
          }
          sub="Live 3 days or less"
        />
        <KpiTile
          label="Not indexed"
          value={
            <DrillNumber
              drill={pagesDrill(ledger, notIndexed, {
                id: 'round:kpi:index',
                title: 'Not indexed by Google',
                description:
                  'From each page’s last “Check index”. A page Google has not indexed cannot be cited.'
              })}
            />
          }
          sub="From the last index check"
        />
        <KpiTile
          label="Pages to build backlinks to"
          value={
            <DrillNumber
              drill={pagesDrill(ledger, backlinks, {
                id: 'round:kpi:links',
                title: 'Pages to build backlinks to',
                description: 'The backlink ask list, First before Next.'
              })}
            />
          }
          sub="The list is ready to copy"
        />
      </KpiStrip>
      <IndexSection
        ledger={ledger}
        projectId={projectId}
        client={client}
        confirming={query.index === 'confirm'}
        onConfirming={(open) => setQuery({ index: open ? 'confirm' : null }, { replace: !open })}
        onChecked={reload}
      />
      <RoundGrid
        ledger={ledger}
        onDraft={(row) => setQuery({ draft: row.pageId })}
        onLost={(row) => setQuery({ ...viewPatch('lost'), lost: row.pageId })}
        onOpen={openChange}
      />
      {draftRow ? (
        <DraftPanel
          key={draftRow.pageId}
          ledger={ledger}
          row={draftRow}
          projectId={projectId}
          {...(assistClient ? { assistClient } : {})}
          onClose={() => setQuery({ draft: null })}
          onLog={(text) => {
            setQuery({ draft: null }, { replace: true })
            openDrawer('fix', newFixValues({ pageId: draftRow.pageId, text }))
          }}
        />
      ) : null}
    </div>
  )
}
