import type { JSX, ReactNode } from 'react'
import { ResultDot } from '../../ui/ResultBar'
import { resultBucket, type ResultBucket } from '../../ui/resultTones'
import { UiIcon } from '../../ui/UiIcon'
import { showingText } from './model'

/** One filter chip of a drill page: "Stage: Problem", or a result in its colour. */
export interface DrillChip {
  /** The filter's name in the URL (`f.<name>`). */
  name: string
  label: ReactNode
  /** A result chip: its dot and tint (ui/resultTones.ts). */
  result?: ResultBucket
  /** The URL without this filter (`useDrillFilters().hrefWithout`). */
  removeHref: string
  /** Plain words for the ✕: "Remove Stage: Problem". Default from a string label. */
  removeLabel?: string
}

export interface DrillFiltersProps {
  chips: readonly DrillChip[]
  /** The unfiltered list's URL and size: "Back to all 240". */
  backHref: string
  total: number
  className?: string
}

/**
 * The drill page's filter row (TopicBigDrill): a chip per filter with a ✕
 * that drops it, then "Back to all N". Every chip and the back link are
 * links, so each state has a URL. Put it in the list's toolbar.
 */
export function DrillFilters({
  chips,
  backHref,
  total,
  className
}: DrillFiltersProps): JSX.Element {
  return (
    <div className={['ui-drill-filters', className ?? ''].filter(Boolean).join(' ')}>
      <ul className="ui-drill-chips" aria-label="Filters">
        {chips.map((chip) => {
          const tone = chip.result ? resultBucket(chip.result) : null
          const name =
            chip.removeLabel ??
            `Remove ${typeof chip.label === 'string' ? chip.label : (tone?.label ?? chip.name)}`
          return (
            <li
              key={chip.name}
              className="ui-fchip"
              data-filter={chip.name}
              style={tone ? { background: tone.tint, color: tone.ink } : undefined}
            >
              {chip.result ? <ResultDot result={chip.result} /> : null}
              <span>{chip.label}</span>
              <a className="ui-fchip-remove" href={chip.removeHref} aria-label={name} title={name}>
                <UiIcon name="x" size={12} />
              </a>
            </li>
          )
        })}
      </ul>
      <a className="ui-drill-back" href={backHref}>
        Back to all {total.toLocaleString('en-US')}
      </a>
    </div>
  )
}

/** The drill page footer line: "Showing all 14". */
export function DrillShowing({ count }: { count: number }): JSX.Element {
  return <span className="ui-drill-showing">{showingText(count, count)}</span>
}
