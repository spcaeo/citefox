import { useId, type JSX } from 'react'
import type { AioReference } from '@shared/domain'
import { Markdown } from '../components/Markdown'
import { displayUrl } from '../m3/model'
import { UiIcon, UrlText } from '../ui'
import { safeExternalUrl } from './targets'

const CLASS_LABEL: Record<AioReference['classification'], string> = {
  target: 'This page',
  own: 'Own',
  competitor: 'Competitor',
  other: 'Other'
}

/** What the AI Overview said (`PromptCheckRow.aioSummary`) and the sources it listed. */
export function OverviewDetail({
  summary,
  references,
  openHref,
  facts = []
}: {
  summary: string | null
  references: readonly AioReference[]
  /** Prompt detail, which has the full overview. */
  openHref: string | null
  /** Short facts above the text, such as "Named: Yes". */
  facts?: readonly string[]
}): JSX.Element {
  const headingId = useId()
  return (
    <div className="drill-overview stack-tight">
      {facts.length > 0 ? <p className="drill-facts num">{facts.join(' · ')}</p> : null}
      <span className="label" id={headingId}>
        What the AI Overview said
      </span>
      {summary ? (
        <div className="drill-overview-text">
          <Markdown baseLevel={4}>{summary}</Markdown>
        </div>
      ) : (
        <p className="faint">No overview text is stored for this check.</p>
      )}
      {references.length > 0 ? (
        <>
          <span className="label">Sources Google listed</span>
          <ol className="drill-sources" aria-label="Sources in the order Google listed them">
            {references.map((ref) => {
              const url = safeExternalUrl(ref.url)
              return (
                <li key={ref.id}>
                  <span className="mono faint">{ref.position}</span>
                  {url ? (
                    <UrlText url={url} label={displayUrl(ref.url)} />
                  ) : (
                    <span className="mono">{displayUrl(ref.url)}</span>
                  )}
                  <span className={ref.classification === 'target' ? 'drill-cited' : 'drill-muted'}>
                    {CLASS_LABEL[ref.classification]}
                  </span>
                </li>
              )
            })}
          </ol>
        </>
      ) : null}
      {openHref ? (
        <a href={openHref} className="drill-open-full">
          Open the full overview and its history
          <UiIcon name="arrow-right" size={14} />
        </a>
      ) : null}
    </div>
  )
}
