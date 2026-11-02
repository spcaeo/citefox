import { useState, type JSX } from 'react'
import type { TopicPageBrief } from '@shared/ipc'
import { WRITE_WITH_URL } from '@shared/ipc'
import { copyText } from '../../../components/clipboard'
import { IconButton, UiIcon } from '../../../ui'
import { WRITER_NAME } from '../constants'

/**
 * A page brief for a question with no page yet (Seed-Pages.png): the answer
 * shape, the outline, who Google cites now, Copy brief, and the external
 * "Write with 1000AIOverviews" link. The link is a plain URL opened in the
 * browser through the window's external-link rule; CiteFox sends it nothing.
 */
export function PageBriefPanel({
  brief,
  label,
  onClose
}: {
  brief: TopicPageBrief
  label: string
  onClose: () => void
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <section className="ui-panel tw-brief" aria-label={`Page brief for ${label}`}>
      <div className="tw-brief-main">
        <p className="tw-brief-title">
          <span className="ui-suggest-mark" aria-hidden="true">
            <UiIcon name="sparkle" size={14} />
          </span>
          Page brief · {label}
        </p>
        <p>{brief.summary}</p>
        {brief.citedNow.length > 0 ? (
          <p className="tw-help">Google cites now: {brief.citedNow.join(', ')}</p>
        ) : null}
      </div>
      <ol className="tw-brief-outline">
        {brief.outline.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <div className="tw-brief-actions">
        <IconButton
          icon={copied ? 'check' : 'copy'}
          label={copied ? 'Copied' : 'Copy brief'}
          tip
          size="sm"
          onClick={() => {
            void copyText(brief.text).then(setCopied)
          }}
        />
        {/* Only the fixed site address: never the brief, the question or any project data. */}
        <a className="tw-external" href={WRITE_WITH_URL} target="_blank" rel="noopener noreferrer">
          Write with {WRITER_NAME}
          <UiIcon name="external" size={14} />
          <span className="sr-only"> (opens in your browser)</span>
        </a>
        <p className="tw-help">Opens another site. CiteFox sends it nothing.</p>
      </div>
      <IconButton
        icon="x"
        size="sm"
        label="Close page brief"
        onClick={onClose}
        className="tw-brief-close"
      />
    </section>
  )
}
