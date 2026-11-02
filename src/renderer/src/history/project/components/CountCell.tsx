import { useContext, useEffect, useState, type JSX } from 'react'
import type { Market, PageResults } from '@shared/domain'
import type { HistorySubject, ProjectCheck } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillContext } from '../../../drill/context'
import { resultsScope } from '../../../drill/fromResults'
import type { PromptDrill } from '../../../drill/types'
import { useDrawerEntry } from '../../../shell/drawers'
import { formatMoment } from '../../../utils/dates'
import type { LoadRunResults } from '../hooks/useRunResults'
import { COUNT_TITLES as TITLES, countRows, type CountKind } from '../utils/compare'

/**
 * A row's Overviews, Cited or Named number. It opens the drill drawer with the
 * questions behind it, read from that check's results when first clicked, so the
 * grid itself loads nothing extra. A copied drill link to this number loads them
 * as the cell draws, so the link reopens the list. Zero, or no drill host, is
 * plain text.
 */
export function CountCell({
  check,
  kind,
  value,
  subject,
  market,
  load
}: {
  check: ProjectCheck
  kind: CountKind
  value: number
  subject: HistorySubject | undefined
  market: Market | undefined
  load: LoadRunResults
}): JSX.Element {
  const drill = useContext(DrillContext)
  const [busy, setBusy] = useState(false)
  const id = `history:${kind}:${check.runId}`
  const linked = useDrawerEntry('drill')?.entry.params.drill === id
  const active = value !== 0 && drill !== null && subject !== undefined
  const request = (results: PageResults): PromptDrill | null =>
    subject === undefined
      ? null
      : {
          kind: 'prompts',
          id,
          title: TITLES[kind],
          description: `${subject.label} · the ${formatMoment(check.startedAt)} check.`,
          rows: countRows(results.prompts, kind, subject.kind === 'topic'),
          scope: resultsScope(results, {
            pageId: check.pageId,
            market: market ?? null,
            runId: check.runId
          })
        }
  // A pasted or Back-restored link to this number: load its rows and tell the host.
  useEffect(() => {
    if (!linked || !active || drill === null) return
    let live = true
    load(check)
      .then((results) => {
        const made = request(results)
        if (live && made !== null) drill.register(made)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // `request` reads the same props as the deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, active, drill, load, check, kind, subject, market])
  if (!active) {
    return <span className="num">{value}</span>
  }
  const noun = pluralize(value, 'question')
  return (
    <button
      type="button"
      className="drill-num"
      aria-label={`${noun}: ${TITLES[kind]}, ${formatMoment(check.startedAt)}`}
      aria-busy={busy || undefined}
      data-nfr-drill={id}
      data-drill-open=""
      onClick={() => {
        setBusy(true)
        load(check)
          .then((results) => {
            const made = request(results)
            if (made !== null) drill.open(made)
          })
          .catch(() => undefined)
          .finally(() => setBusy(false))
      }}
    >
      <span data-nfr-figure={id}>{value}</span>
    </button>
  )
}
