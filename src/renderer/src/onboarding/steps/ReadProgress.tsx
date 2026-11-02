import type { JSX } from 'react'
import { BusyMark, formatElapsed, useNow, type BusyState } from '../../ui'
import { SearchLines } from './SearchLines'
import { readFraction, stageLabel, type ReadStage, type SiteReadState } from './useSiteRead'
import './read-live.css'

/**
 * Step 3's working view (panel 3b): a bar and one line per stage, each with ✓, a
 * spinner or an empty circle, and its elapsed time. Under a line, what it found so far
 * (owner, 2026-10-29): the products, each product's competitor search with the
 * competitors found so far, the buyers and what sends them looking. The marks and the
 * clock are the kit's busy pieces (ui/Busy.tsx), so it looks like every other wait.
 */
export function ReadProgress({
  read,
  onRetry
}: {
  read: SiteReadState
  /** "Try again" for one product's competitor search. */
  onRetry: (productId: string) => void
}): JSX.Element {
  const searching = read.live.searches.some(
    (search) => search.state === 'running' || search.state === 'waiting'
  )
  const now = useNow(read.status === 'running' || searching)
  const percent = Math.round(readFraction(read.stages) * 100)
  return (
    <div className="obs-read">
      <div
        className="obs-bar"
        role="progressbar"
        aria-label="Reading your site"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="obs-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <ol className="obs-stages" aria-label="What CiteFox is doing">
        {read.stages.map((stage) => {
          const label = stageLabel(stage, read)
          const elapsed =
            stage.startedAt === null ? '' : formatElapsed((stage.endedAt ?? now) - stage.startedAt)
          const detail = stageDetail(stage, read, now, onRetry)
          return (
            <li key={stage.id} className={`obs-stage obs-stage-${stage.state}`}>
              <StageMark state={stage.state} />
              <span className="obs-stage-text">
                {stage.state === 'running' ? (
                  <>
                    <strong>{label}</strong>… please wait
                  </>
                ) : (
                  label
                )}
                {stage.note ? <span className="obs-stage-note">{stage.note}</span> : null}
              </span>
              <span className="obs-stage-time num">{elapsed}</span>
              {detail === null ? null : <div className="obs-stage-detail">{detail}</div>}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** What a stage found, under its line. Null when there is nothing to show yet. */
function stageDetail(
  stage: ReadStage,
  read: SiteReadState,
  now: number,
  onRetry: (productId: string) => void
): JSX.Element | null {
  const { live } = read
  switch (stage.id) {
    case 'pages':
      return null
    case 'site':
      return live.site === null || live.site.products.length === 0 ? null : (
        <Names label="What you sell" names={live.site.products.map((product) => product.name)} />
      )
    case 'competitors':
      return live.searches.length === 0 ? null : (
        <SearchLines live={live} now={now} onRetry={onRetry} />
      )
    case 'buyers':
      return live.buyers.length === 0 ? null : <Names label="Who buys" names={live.buyers} />
    case 'triggers':
      return live.triggers.length === 0 ? null : (
        <Names label="What sends them looking" names={live.triggers} />
      )
  }
}

function Names({ label, names }: { label: string; names: readonly string[] }): JSX.Element {
  return (
    <ul className="obs-names" aria-label={label}>
      {names.map((name, index) => (
        <li key={`${index}-${name}`}>{name}</li>
      ))}
    </ul>
  )
}

const STAGE_MARK: Record<ReadStage['state'], { state: BusyState; label: string }> = {
  done: { state: 'done', label: 'Done' },
  warning: { state: 'warning', label: 'Finished with a warning' },
  running: { state: 'running', label: 'Running' },
  waiting: { state: 'waiting', label: 'Waiting' }
}

function StageMark({ state }: { state: ReadStage['state'] }): JSX.Element {
  const mark = STAGE_MARK[state]
  return <BusyMark state={mark.state} size="sm" label={mark.label} />
}
