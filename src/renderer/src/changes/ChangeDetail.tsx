import type { JSX } from 'react'
import { fixKindLabel, type PromptCheckRow } from '@shared/domain'
import type { ChangeLedger, ChangeRow } from '@shared/ipc'
import { Markdown } from '../components/Markdown'
import { DrillLink, DrillNumber, openTarget, type DrillTarget } from '../drill'
import { pathOf } from '../fixes/model'
import { statusLabel } from '../m3/model'
import { pageHash } from '../shell/routes'
import { useAiContext } from '../assistant/context/useAiContext'
import { ScreenDrawerLevel } from '../shell/DrawerLevel'
import {
  Drawer,
  DrawerFacts,
  DrawerGrid,
  DrawerMain,
  DrawerRail,
  DrawerSection,
  ListGrid,
  UrlText,
  type ListColumn
} from '../ui'
import { formatDay, formatMoment } from '../utils/dates'
import { IndexPill } from './cells'
import { DidItWork } from './DidItWork'
import { topSpotsDrill } from './drills'
import {
  averageLabel,
  averagePosition,
  citedRows,
  daysLabel,
  pageDateLine,
  pageName,
  questionMoves,
  type QuestionMove
} from './model'
import { verdictOf } from './verdict'
import { VerdictPill } from './VerdictCells'

/**
 * "Change detail" (`?row=<fixId>`, a drawer kept in the screen's own URL value):
 * Did it work? (the fix's searches before → now, won and lost, untouched searches,
 * Google updates), what changed, when it went live, the dates the page states, and
 * every question of the page's check before → now. A question opens Prompt detail in
 * that check. Edit opens the fix drawer on the logged change.
 */
export function ChangeDetail({
  ledger,
  row,
  onClose,
  onLost,
  onEdit
}: {
  ledger: ChangeLedger
  row: ChangeRow
  onClose: () => void
  onLost: () => void
  /** Closes this drawer and opens the fix drawer on the change. */
  onEdit: () => void
}): JSX.Element {
  return (
    <ScreenDrawerLevel onClose={onClose}>
      <ChangeDrawer ledger={ledger} row={row} onClose={onClose} onLost={onLost} onEdit={onEdit} />
    </ScreenDrawerLevel>
  )
}

function ChangeDrawer({
  ledger,
  row,
  onClose,
  onLost,
  onEdit
}: {
  ledger: ChangeLedger
  row: ChangeRow
  onClose: () => void
  onLost: () => void
  onEdit: () => void
}): JSX.Element {
  const moves = questionMoves(row)
  const dateLine = pageDateLine(row)
  const topSpots = topSpotsDrill(ledger, row)
  const view = verdictOf(row.measure, row.liveSince, ledger.builtAt)
  useAiContext({
    pageId: row.pageId,
    entities: [{ kind: 'fix', id: row.fixId, label: `Fix ${row.number} · ${pageName(row)}` }],
    numbers: [
      { label: 'Days live', value: daysLabel(row.daysLive) },
      { label: 'Fix searches cited before', value: String(view.citedBefore) },
      { label: 'Fix searches cited now', value: String(view.citedNow) },
      { label: 'Fix searches measured', value: String(view.measured) },
      {
        label: 'Questions cited before',
        value: row.before ? String(citedRows(row.before).length) : 'Not checked'
      },
      {
        label: 'Questions cited now',
        value: row.now ? String(citedRows(row.now).length) : 'Not checked'
      }
    ]
  })
  const target = (move: QuestionMove): DrillTarget => {
    const check = move.now ? row.now : row.before
    return {
      kind: 'prompt',
      pageId: row.pageId,
      promptId: move.promptId,
      marketId: check?.marketId ?? null,
      runId: check?.runId ?? null
    }
  }
  const columns: readonly ListColumn<QuestionMove>[] = [
    {
      id: 'question',
      label: 'Question',
      width: 'fill',
      minWidth: 180,
      render: (move) => (
        <DrillLink target={target(move)} className="chg-q-link">
          <span className="num faint">Q{move.promptPosition}</span> {move.text}
        </DrillLink>
      )
    },
    {
      id: 'before',
      label: row.before ? `Before · ${formatMoment(row.before.checkedAt)}` : 'Before',
      width: 128,
      render: (move) => stateText(move.before, row.before !== null)
    },
    {
      id: 'now',
      label: row.now ? `Now · ${formatMoment(row.now.checkedAt)}` : 'Now',
      width: 128,
      render: (move) => stateText(move.now, row.now !== null)
    }
  ]
  return (
    <Drawer
      id="change"
      title={pageName(row)}
      subtitle={`Change detail · ${fixKindLabel(row.kind)} · Fix ${row.number}`}
      status={<VerdictPill view={view} />}
      focusOnOpen="close"
      onClose={onClose}
      footer={{
        cancel: 'Close',
        secondary:
          row.status === 'lost'
            ? { label: 'See what happened', icon: 'trend-down', onClick: onLost }
            : undefined,
        primary: {
          label: 'Edit the change',
          icon: 'pencil',
          onClick: onEdit
        }
      }}
    >
      <DrawerGrid>
        <DrawerMain>
          <DidItWork ledger={ledger} row={row} view={view} />
          <DrawerSection title="What changed">
            <div className="chg-detail">
              <Markdown baseLevel={4}>{row.description}</Markdown>
            </div>
          </DrawerSection>
          <DrawerSection title="Questions before and now" count={moves.length} tone="plain">
            <ListGrid<QuestionMove>
              label="Questions before and now"
              noun={['question', 'questions']}
              rows={moves}
              rowKey={(move) => move.promptId}
              rowLabel={(move) => `Q${move.promptPosition}`}
              columns={columns}
              pageSize="all"
              onActivate={(move) => openTarget(target(move))}
              empty={
                <p className="muted chg-detail-empty">
                  No full check of this page yet. The next scheduled check measures it.
                </p>
              }
            />
          </DrawerSection>
        </DrawerMain>
        <DrawerRail label="About this change">
          <DrawerSection title="The page">
            <DrawerFacts
              label="About this change"
              items={[
                {
                  label: 'Page',
                  value: <UrlText url={row.url} label={pathOf(row.url)} site={ledger.domain} />
                },
                {
                  label: 'Live since',
                  value: (
                    <span className="num">
                      {formatDay(row.liveSince)} · {daysLabel(row.daysLive)}
                    </span>
                  )
                },
                { label: 'On the page', value: dateLine ?? 'The page states no date' },
                { label: 'Google index', value: <IndexPill row={row} /> },
                {
                  label: '#1 spots now',
                  value: topSpots ? <DrillNumber drill={topSpots} /> : 'Not checked'
                },
                { label: 'Avg position now', value: averageLabel(averagePosition(row.now)) },
                {
                  label: 'Its page',
                  value: (
                    <a href={pageHash(row.pageId, 'progress', { filter: `fix:${row.number}` })}>
                      Fix {row.number} on Progress
                    </a>
                  )
                }
              ]}
            />
          </DrawerSection>
        </DrawerRail>
      </DrawerGrid>
    </Drawer>
  )
}

/** "Page cited #2", "Not cited", or "—" when that check did not ask the question. */
function stateText(row: PromptCheckRow | null, checked: boolean): string {
  if (!row) return checked ? 'Not asked' : '—'
  const label = statusLabel(row.status)
  return row.position !== null && row.status === 'page_cited' ? `${label} #${row.position}` : label
}
