import type { JSX, ReactNode } from 'react'
import { clampPercent, goalBarText, type GoalBand } from './componentModels'

export type { GoalBand }

export interface GoalBarProps {
  /** Title above the bar, such as "Goal bar · buyer questions". Omit inside a KPI tile. */
  label?: ReactNode
  /** Current value in percent. Clamped to 0–100. */
  value: number
  /** Target band, drawn as a spruce-mint block behind the fill. */
  band?: GoalBand
  /**
   * Tick labels under the bar. `true` (default with `md`) shows 0, lo, hi, 100;
   * an array shows those values; `false` shows none.
   */
  ticks?: boolean | readonly number[]
  /** Text at the top right, such as "target 50–70%". Default from `band`. */
  targetLabel?: ReactNode
  /** `md` (default) with title row and ticks, `sm` the bare 8px bar for tiles. */
  size?: 'md' | 'sm'
  /**
   * Accessible description. Default "42% cited, target 50–70%". The value
   * must be in it.
   */
  valueLabel?: string
}

function tickValues(ticks: GoalBarProps['ticks'], band: GoalBand | undefined): number[] {
  if (ticks === false || ticks === undefined) return []
  if (ticks === true) return band ? [0, band.lo, band.hi, 100] : [0, 100]
  return [...ticks]
}

/**
 * The goal bar (Theme.dc.html "Data"): an 8px track, the target band 4px
 * taller on each side, and the fox fill for the current value. Exposed as one
 * `meter` with a sentence for screen readers; the parts are decorative.
 */
export function GoalBar({
  label,
  value,
  band,
  ticks,
  targetLabel,
  size = 'md',
  valueLabel
}: GoalBarProps): JSX.Element {
  const pct = clampPercent(value)
  const lo = band ? clampPercent(band.lo) : 0
  const hi = band ? clampPercent(Math.max(band.lo, band.hi)) : 0
  const shownTicks = tickValues(ticks ?? size === 'md', band)
  const target = targetLabel ?? (band ? `target ${band.lo}–${band.hi}%` : null)
  return (
    <div className={size === 'sm' ? 'ui-goal ui-goal-sm' : 'ui-goal'}>
      {size === 'md' && (label || target) ? (
        <div className="ui-goal-head">
          {label ? <p className="ui-goal-title">{label}</p> : <span />}
          {target ? <p className="ui-goal-target num">{target}</p> : null}
        </div>
      ) : null}
      <div
        className="ui-goal-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={valueLabel ?? goalBarText(value, band)}
        aria-label={valueLabel ?? goalBarText(value, band)}
      >
        {band ? (
          <span
            className="ui-goal-band"
            data-part="band"
            style={{ left: `${lo}%`, width: `${hi - lo}%` }}
          />
        ) : null}
        <span className="ui-goal-fill" data-part="fill" style={{ width: `${pct}%` }} />
      </div>
      {shownTicks.length > 0 ? (
        <div className="ui-goal-ticks num" aria-hidden="true">
          {shownTicks.map((tick, index) => {
            const at = clampPercent(tick)
            const edge = at === 0 ? 'start' : at === 100 ? 'end' : 'mid'
            return (
              <span
                key={`${tick}-${index}`}
                className={`ui-goal-tick ui-goal-tick-${edge}`}
                style={edge === 'end' ? { right: 0 } : { left: `${at}%` }}
              >
                {tick}
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
