import type { JSX } from 'react'
import { ENGINE_SHORT_LABEL, type EngineAnswerStatus, type EngineId } from '@shared/domain'
import { SegmentedControl } from '../ui'
import { EngineLogo } from './EngineLogo'
import { dotKind, engineLabel, LEGEND, statusText, type DotKind, type EngineFilter } from './model'
import './engines.css'

/** One engine's dot: filled (cited), half (named), red ring (not cited) or grey (nothing). */
export function EngineDot({
  status,
  engine
}: {
  status: EngineAnswerStatus | null | undefined
  /** With an engine, the dot carries its own tooltip. */
  engine?: EngineId
}): JSX.Element {
  return <Dot kind={dotKind(status)} title={engine ? dotTitle(engine, status) : undefined} />
}

function Dot({ kind, title }: { kind: DotKind; title?: string | undefined }): JSX.Element {
  return <span className={`eng-dot eng-dot-${kind}`} aria-hidden="true" title={title} />
}

function dotTitle(engine: EngineId, status: EngineAnswerStatus | null | undefined): string {
  return `${engineLabel(engine)}: ${statusText(status)}`
}

/**
 * A question's dots, one per engine in display order, then "1 of 2": cited on how many
 * of the engines that answered. The whole row is one image with every status in words.
 */
export function EngineDots({
  engines,
  statuses
}: {
  engines: readonly EngineId[]
  statuses: Partial<Record<EngineId, EngineAnswerStatus>> | undefined
}): JSX.Element {
  const kinds = engines.map((engine) => dotKind(statuses?.[engine]))
  const answeredCount = kinds.filter((kind) => kind !== 'none').length
  const cited = kinds.filter((kind) => kind === 'cited').length
  const words = engines.map((engine) => dotTitle(engine, statuses?.[engine])).join('; ')
  return (
    <span className="eng-dots">
      <span className="eng-dots-row" role="img" aria-label={words} title={words}>
        {engines.map((engine, index) => (
          <Dot key={engine} kind={kinds[index] ?? 'none'} />
        ))}
      </span>
      <span className="eng-dots-count faint num">
        {answeredCount > 0 ? `${cited} of ${answeredCount}` : '—'}
      </span>
    </span>
  )
}

/** One engine's status as a dot and words, for the result column of a one-engine view. */
export function EngineStatus({
  status
}: {
  status: EngineAnswerStatus | null | undefined
}): JSX.Element {
  const kind = dotKind(status)
  return (
    <span className={kind === 'none' ? 'eng-status faint' : 'eng-status'}>
      <Dot kind={kind} />
      {statusText(status)}
    </span>
  )
}

/** The dots' key, under a list that shows them. */
export function EngineLegend(): JSX.Element {
  return (
    <ul className="eng-legend" aria-label="What the engine dots mean">
      {LEGEND.map((item) => (
        <li key={item.kind}>
          <Dot kind={item.kind} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * The engine filter: All, then each engine the screen offers as its logo alone, the
 * engine's name as the button's name and its hover tooltip (owner 2026-10-30, "just
 * the logo, so it's more compact"). The logos say what it is, so there is no
 * "Engine" label in front. Its value lives in the screen's URL (`?engine=`), so a link
 * opens the same engine and Back steps out of it. `compact` is a list toolbar's.
 */
export function EngineFilterBar({
  engines,
  value,
  onChange,
  compact = false
}: {
  engines: readonly EngineId[]
  value: EngineFilter
  onChange: (value: EngineFilter) => void
  compact?: boolean
}): JSX.Element {
  return (
    <div className={compact ? 'eng-filter eng-filter-compact' : 'eng-filter'}>
      <SegmentedControl<EngineFilter>
        label="Engine"
        size="sm"
        value={value}
        options={[
          { value: 'all', label: 'All' },
          ...engines.map((engine) => ({
            value: engine,
            label: ENGINE_SHORT_LABEL[engine],
            icon: <EngineLogo engine={engine} size={16} className="eng-filter-logo" />,
            iconOnly: true
          }))
        ]}
        onChange={onChange}
      />
    </div>
  )
}

/**
 * The engine filter's spot when a list has one engine only: its logo alone, fixed, so
 * the toolbar keeps the same layout on every screen; its name and tooltip say whose
 * answers these are ("Google AI Overview only").
 */
export function EngineFixed({ engine }: { engine: EngineId }): JSX.Element {
  const name = `${engineLabel(engine)} only`
  return (
    <span className="eng-fixed" role="img" aria-label={name} data-tip={name}>
      <EngineLogo engine={engine} size={16} className="eng-filter-logo" />
    </span>
  )
}
