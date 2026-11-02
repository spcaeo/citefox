import type { JSX } from 'react'
import type { Market } from '@shared/domain'
import type { AlertEvent } from '@shared/ipc'
import { marketLabel } from '../../shell/model'
import { pageHash, topicHash } from '../../shell/routes'
import { UrlText } from '../../ui'
import { pathOf, shortWhen } from './ruleModel'

/**
 * Matching checks as a compact list: when, which page (its URL with copy and open),
 * the market, and what changed. The dry run's rail and the Alert log's rows use it.
 */
export function EventList({
  events,
  markets,
  site,
  empty,
  testId
}: {
  events: readonly AlertEvent[]
  markets: readonly Market[]
  site: string | null
  empty: string
  testId?: string
}): JSX.Element {
  if (events.length === 0) {
    return (
      <p className="hint ar-events-empty" data-testid={testId}>
        {empty}
      </p>
    )
  }
  return (
    <ol className="ar-events" data-testid={testId}>
      {events.map((event) => {
        const market = markets.find((item) => item.id === event.marketId)
        return (
          <li key={`${event.runId}-${event.when}`} className="ar-event">
            <div className="ar-event-top">
              <time className="num" dateTime={event.at}>
                {shortWhen(event.at)}
              </time>
              <span className="faint">{market ? marketLabel(market) : event.marketId}</span>
            </div>
            <a
              className="ar-event-page"
              href={
                event.pageUrl === null ? topicHash(event.pageId) : pageHash(event.pageId, 'results')
              }
            >
              {event.pageLabel}
            </a>
            {event.pageUrl ? (
              <UrlText
                url={event.pageUrl}
                site={site}
                label={pathOf(event.pageUrl)}
                variant="path"
                icon={false}
              />
            ) : null}
            <p className="ar-event-what">{event.summary}</p>
            {event.details.length > 0 ? (
              <ul className="ar-event-details">
                {event.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
