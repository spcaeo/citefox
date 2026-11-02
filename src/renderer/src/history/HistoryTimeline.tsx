import type { JSX } from 'react'
import type { HistoryEvent } from '@shared/domain'
import { Icon, type IconName } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import type { CompareTarget } from './CompareDialog'
import { ContentLine, NoteBody, type NoteActions } from './EventBody'
import {
  ChangeParts,
  FixParts,
  PartialTag,
  PromptSetLink,
  ScoreLink,
  ViewResults
} from './EventParts'
import type { HistoryDrillContext } from './historyDrills'
import { eventDay, fullDay } from './model'

export type { NoteActions } from './EventBody'

function iconFor(event: HistoryEvent): IconName {
  switch (event.primary) {
    case 'check':
      return event.check?.kind === 'baseline' ? 'activity' : 'refresh'
    case 'content':
      return 'file'
    case 'note':
      return 'message'
    case 'fix':
      return 'pencil'
    case 'prompt_set':
      return 'list'
  }
}

/** Timeline view (FR-15.1): newest first, one item per event. */
export function HistoryTimeline({
  events,
  context,
  notes,
  onCompare
}: {
  events: readonly HistoryEvent[]
  context: HistoryDrillContext
  notes: NoteActions
  onCompare: (target: CompareTarget) => void
}): JSX.Element {
  return (
    <ol className="hist-timeline">
      {events.map((event) => (
        <li key={event.id} className={`hist-item hist-item-${event.primary}`}>
          <span className="hist-date mono" title={fullDay(event)}>
            {eventDay(event)}
          </span>
          <span className={`hist-icon hist-icon-${event.primary}`}>
            <Icon name={iconFor(event)} />
          </span>
          <div className="hist-body stack-tight">
            <div className="hist-head">
              <h3 className="hist-title">
                <Markdown inline baseLevel={4}>
                  {event.title}
                </Markdown>
              </h3>
              <EventChips event={event} context={context} />
            </div>
            <ContentLine event={event} onCompare={onCompare} />
            {event.note ? <NoteBody event={event} notes={notes} /> : null}
            {event.detail ? (
              <Markdown className="faint" baseLevel={4}>
                {event.detail}
              </Markdown>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Score, change, partial, fix and prompt-set chips, then the event's links. */
export function EventChips({
  event,
  context,
  withScore = true
}: {
  event: HistoryEvent
  context: HistoryDrillContext
  /** The table has its own Score and Change columns. */
  withScore?: boolean
}): JSX.Element {
  const check = event.check
  return (
    <>
      {check && withScore ? <ScoreLink check={check} event={event} context={context} /> : null}
      {check?.partial ? <PartialTag check={check} context={context} /> : null}
      {check && withScore ? <ChangeParts check={check} context={context} /> : null}
      <FixParts event={event} context={context} />
      <ViewResults event={event} context={context} />
      <PromptSetLink event={event} context={context} />
    </>
  )
}
