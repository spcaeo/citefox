import { useContext, useEffect, useState, type JSX } from 'react'
import type { Market } from '@shared/domain'
import type { HistorySubject, ProjectCheck } from '@shared/ipc'
import { pluralize } from '@shared/pluralize'
import { DrillContext } from '../../../drill/context'
import type { DrillItem, DrillScope, ItemDrill } from '../../../drill/types'
import { marketLabel } from '../../../shell/model'
import { useDrawerEntry } from '../../../shell/drawers'
import { formatMoment } from '../../../utils/dates'
import type { LoadRunResults } from '../hooks/useRunResults'
import { COUNT_TITLES as TITLES, countRows, type CountKind } from '../utils/compare'

/** No single page, market or check: each row names its own and opens there. */
const MIXED_SCOPE: DrillScope = {
  pageId: null,
  marketId: null,
  runId: null,
  marketLabel: '',
  checkDateLabel: '',
  brand: '',
  domain: ''
}

/**
 * A day's or the "All checks" Overviews, Cited or Named total (audit #3). Like
 * CountCell, it opens the drill drawer with the questions behind the number: every
 * check under it is read when first clicked, and each row names its page or topic and
 * check and opens that question in that check. A copied link reloads the list.
 */
export function CountTotal({
  checks,
  kind,
  count,
  groupId,
  groupLabel,
  subjects,
  markets,
  load
}: {
  checks: readonly ProjectCheck[]
  kind: CountKind
  /** The number one check adds: the total is their sum. */
  count: (check: ProjectCheck) => number
  /** The day group's opaque id; null for the "All checks" row. */
  groupId: string | null
  /** "Oct 19, 2026", or null for the "All checks" row. */
  groupLabel: string | null
  subjects: ReadonlyMap<string, HistorySubject>
  markets: ReadonlyMap<string, Market>
  load: LoadRunResults
}): JSX.Element {
  const drill = useContext(DrillContext)
  const [busy, setBusy] = useState(false)
  const value = checks.reduce((sum, check) => sum + count(check), 0)
  const id = `history:${kind}:${groupId === null ? 'all' : `day-${groupId}`}`
  const linked = useDrawerEntry('drill')?.entry.params.drill === id
  const active = value !== 0 && drill !== null

  async function build(): Promise<ItemDrill> {
    // Only the checks that add to the number are read; one that fails is left out.
    const counted = checks.filter((check) => count(check) > 0 && subjects.has(check.pageId))
    const loaded = await Promise.allSettled(counted.map((check) => load(check)))
    const items: DrillItem[] = []
    let failed = 0
    counted.forEach((check, at) => {
      const subject = subjects.get(check.pageId)
      const read = loaded[at]
      if (read?.status !== 'fulfilled') failed += 1
      if (subject === undefined || read?.status !== 'fulfilled') return
      const results = read.value
      const market = markets.get(check.marketId)
      const where = [
        subject.label,
        market ? marketLabel(market) : null,
        `the ${formatMoment(check.startedAt)} check`
      ]
        .filter(Boolean)
        .join(' · ')
      for (const row of countRows(results.prompts, kind, subject.kind === 'topic')) {
        items.push({
          id: `${check.runId}:${row.promptId}`,
          primary: row.text,
          secondary: where,
          target: {
            kind: 'prompt',
            pageId: check.pageId,
            promptId: row.promptId,
            marketId: check.marketId,
            runId: check.runId
          }
        })
      }
    })
    return {
      kind: 'items',
      id,
      title: TITLES[kind],
      description:
        `${groupLabel ?? 'Every check in this list'} · ${pluralize(counted.length, 'check')}. Each row opens that question in its check.` +
        (failed > 0 ? ` ${pluralize(failed, 'check')} could not be read.` : ''),
      noun: ['question', 'questions'],
      primaryLabel: 'Question',
      items,
      scope: MIXED_SCOPE
    }
  }

  // A pasted or Back-restored link to this total: load its rows and tell the host.
  useEffect(() => {
    if (!linked || !active || drill === null) return
    let live = true
    build()
      .then((made) => {
        if (live) drill.register(made)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
    // `build` reads the same props as the deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked, active, drill, load, checks, kind, count, subjects, markets])

  if (!active) return <span className="num">{value}</span>
  return (
    <button
      type="button"
      className="drill-num"
      aria-label={`${pluralize(value, 'question')}: ${TITLES[kind]}, ${groupLabel === null ? 'every check' : `all checks on ${groupLabel}`}`}
      aria-busy={busy || undefined}
      data-nfr-drill={id}
      data-drill-open=""
      onClick={() => {
        setBusy(true)
        build()
          .then((made) => drill.open(made))
          .catch(() => undefined)
          .finally(() => setBusy(false))
      }}
    >
      <span data-nfr-figure={id}>{value}</span>
    </button>
  )
}
