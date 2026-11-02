import type { JSX } from 'react'
import type { ProjectSchedule, QueueStatus } from '@shared/domain'
import { Icon } from '../components/Icon'
import { useTextLabel } from './projectsScreen/hooks/useTextLabel'
import {
  cadenceLine,
  clockDetail,
  keyStatusLine,
  resumeSentence,
  scoreMeterLabel,
  scoreMeterPercent
} from './scoreCopy'

/** Small score bar beside the average. Fill width is the rounded score out of 100. */
export function ScoreMeter({ score }: { score: number }): JSX.Element {
  const value = scoreMeterPercent(score)
  return (
    <span
      className="bar"
      role="meter"
      aria-label={scoreMeterLabel(score)}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${value}%` }} />
    </span>
  )
}

/** Clock row: cadence, then the paused note or the next check. */
export function ClockRow({
  schedule,
  now,
  href,
  onOpen,
  openLabel
}: {
  schedule: ProjectSchedule
  now?: Date
  /** Makes the schedule a link (Alerts & schedules › Check timing). `onOpen` runs instead of following it. */
  href?: string
  onOpen?: () => void
  openLabel?: string
}): JSX.Element {
  const resume = resumeSentence(schedule, now)
  const [ariaLabel, attach] = useTextLabel<HTMLAnchorElement>(openLabel)
  const line = (
    <>
      {cadenceLine(schedule)} · <strong>{clockDetail(schedule, now)}</strong>
    </>
  )
  return (
    <div className="prow">
      <Icon name="clock" />
      <span>
        {href ? (
          <a
            ref={attach}
            href={href}
            aria-label={ariaLabel}
            onClick={(event) => {
              if (!onOpen) return
              event.preventDefault()
              onOpen()
            }}
          >
            {line}
          </a>
        ) : (
          <span>{line}</span>
        )}
        {resume ? <span className="hint clock-next">{resume}</span> : null}
      </span>
    </div>
  )
}

/** Key row: shared or dedicated SerpApi key, then the project's Claude connection. */
export function KeyRow({
  queue,
  projectId,
  claudeLabel = null,
  href
}: {
  queue: QueueStatus | null
  projectId: string
  claudeLabel?: string | null
  /** Makes the line a link, such as Connections. */
  href?: string
}): JSX.Element {
  const line = keyStatusLine(queue, projectId, claudeLabel)
  return (
    <div className="prow">
      <Icon name="key" />
      {href ? (
        <a href={href} aria-label={`${line}: open Connections`}>
          {line}
        </a>
      ) : (
        <span>{line}</span>
      )}
    </div>
  )
}
