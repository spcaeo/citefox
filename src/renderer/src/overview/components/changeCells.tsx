import type { JSX } from 'react'
import type { OverviewOwnPage, OverviewQuestion, OverviewYouStatus } from '@shared/ipc'
import { ResultChip, UrlText, type ResultKind } from '../../ui'
import { isNamedOnly, sourceText, youLabel } from '../model'

/**
 * Where you stand in one check, as the shared result pill ("Target page", "Not cited"),
 * with a separate Named badge when the brand is in the answer but no page of yours is.
 */
export function YouChip({
  you,
  ownPage
}: {
  you: OverviewYouStatus
  ownPage: OverviewOwnPage | null
}): JSX.Element {
  const result = you === 'cited' && ownPage === 'other' ? 'own_page' : YOU_RESULT[you]
  const chip = <ResultChip result={result} label={youLabel({ you, ownPage })} />
  if (!isNamedOnly({ you })) return chip
  return (
    <span className="ov-you">
      {chip}
      <ResultChip result="named" label="Named" />
    </span>
  )
}

const YOU_RESULT: Readonly<Record<OverviewYouStatus, ResultKind>> = {
  cited: 'cited',
  named: 'not_cited',
  not_cited: 'not_cited',
  no_aio: 'no_overview',
  error: 'failed'
}

/** Where a question comes from: its page (with Copy and Open) or its topic. */
export function SourceCell({ row }: { row: OverviewQuestion }): JSX.Element {
  return row.source.kind === 'page' ? (
    <UrlText url={row.source.url} label={row.source.path} />
  ) : (
    <span className="ov-muted" title={sourceText(row.source)}>
      {sourceText(row.source)}
    </span>
  )
}
