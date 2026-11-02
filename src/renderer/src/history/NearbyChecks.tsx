import type { JSX } from 'react'
import type { HistoryEvent } from '@shared/domain'
import { DrawerSection } from '../ui'
import { ScoreLink } from './EventParts'
import type { HistoryDrillContext } from './historyDrills'
import { changeText, fullDay, nearbyChecks } from './model'

/**
 * The checks just before and just after a date, with their scores and a link
 * to each one's results: lines an edit up with what the checks saw.
 */
export function NearbyChecks({
  events,
  iso,
  exceptId = null,
  context
}: {
  events: readonly HistoryEvent[]
  iso: string
  exceptId?: string | null
  context: HistoryDrillContext
}): JSX.Element {
  const { before, after } = nearbyChecks(events, iso, exceptId)
  return (
    <DrawerSection
      title="Checks before and after"
      description="The check before and the check after. A score opens its results."
      testId="hist-nearby"
    >
      <ul className="hist-nearby">
        <NearbyRow label="Before" event={before} context={context} />
        <NearbyRow label="After" event={after} context={context} />
      </ul>
    </DrawerSection>
  )
}

function NearbyRow({
  label,
  event,
  context
}: {
  label: string
  event: HistoryEvent | null
  context: HistoryDrillContext
}): JSX.Element {
  const check = event?.check ?? null
  return (
    <li className="hist-nearby-row">
      <span className="hist-nearby-label">{label}</span>
      {event && check ? (
        <>
          <span className="hist-nearby-day">{fullDay(event)}</span>
          <span className="hist-nearby-score num">
            <ScoreLink check={check} event={event} context={context} bare />
            {check.scoreChange === null ? null : (
              <span className="faint"> ({changeText(check.scoreChange)})</span>
            )}
          </span>
        </>
      ) : (
        <span className="faint">{label === 'Before' ? 'No earlier check' : 'No check since'}</span>
      )}
    </li>
  )
}
