import { Fragment, type JSX } from 'react'
import type { CommunitiesReport, CommunitySourceBase } from '@shared/domain'
import { DrillLink, DrillNumber, type ItemDrill } from '../../drill'
import type { CommunityDrills } from '../drills'
import { UrlText } from '../../ui'
import { formatMoment } from '../../utils/dates'
import { citedOnLabel, marketName, plural } from '../utils/model'

/**
 * A source (a Reddit thread, a YouTube video) with the platform's icon in front,
 * shown by its title (or its URL without one), with Copy and Open in the browser
 * on hover or focus. The tooltip and the copy are always the full URL.
 */
export function SourceLink({ url, title }: { url: string; title: string | null }): JSX.Element {
  if (title === null) return <UrlText url={url} />
  return <UrlText url={url} label={title} plain className="cm-source-link" />
}

/** "Times cited": the answers citing this source, with its facts on top (NFR-14). */
export function TimesCited({
  row,
  drill
}: {
  row: CommunitySourceBase
  drill: ItemDrill
}): JSX.Element {
  return (
    <DrillNumber
      drill={drill}
      label={`${row.title ?? row.url}: cited in ${plural(row.timesCited, 'answer')}`}
    />
  )
}

/** Page scope "Prompts 1, 3": each position opens Prompt detail in that answer's market and check. */
export function PromptLinks({
  row,
  drills
}: {
  row: CommunitySourceBase
  drills: CommunityDrills
}): JSX.Element {
  const label = citedOnLabel('page', row.promptPositions, 0)
  if (row.promptPositions.length === 0) return <>{label}</>
  return (
    <>
      {row.promptPositions.length === 1 ? 'Question ' : 'Questions '}
      {row.promptPositions.map((position, index) => {
        const aio = row.aioKeys
          .map((key) => drills.aio(key))
          .find((item) => item?.promptPosition === position)
        return (
          <Fragment key={position}>
            {index > 0 ? ', ' : null}
            {aio ? (
              <DrillLink
                target={drills.answerTarget(aio)}
                label={`Open question ${position}: ${aio.label}`}
              >
                {position}
              </DrillLink>
            ) : (
              position
            )}
          </Fragment>
        )
      })}
    </>
  )
}

/**
 * FR-17.3 "First seen". The date opens the first check and prompt that cited
 * the source (Prompt detail pinned to that check) when stored data says which;
 * otherwise this page's History, or plain text in project scope.
 */
export function FirstSeen({
  row,
  report
}: {
  row: CommunitySourceBase
  report: CommunitiesReport
}): JSX.Element {
  const day = formatMoment(row.firstSeenAt)
  const first = row.firstSeenIn
  if (first !== null && row.firstSeenAt !== null) {
    const market = marketName(report.markets, first.marketId)
    return (
      <DrillLink
        target={{
          kind: 'prompt',
          pageId: first.pageId,
          promptId: first.promptId,
          marketId: first.marketId,
          runId: first.runId
        }}
        label={`First seen ${formatMoment(row.firstSeenAt)} for question ${first.promptPosition} in ${market}: open that check`}
      >
        {day}
      </DrillLink>
    )
  }
  if (report.scope === 'page' && report.pageId !== null && row.firstSeenAt !== null) {
    return (
      <DrillLink
        target={{ kind: 'page', pageId: report.pageId, tab: 'history' }}
        label={`First seen ${formatMoment(row.firstSeenAt)}: open this page's check history`}
      >
        {day}
      </DrillLink>
    )
  }
  return <span>{day}</span>
}
