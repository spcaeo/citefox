import type { JSX } from 'react'
import type { HistorySubject } from '@shared/ipc'
import { Chip, UrlText } from '../../../ui'
import { pathOf } from '../model'

/**
 * The page or topic a check is for. A topic carries a Topic chip; a page shows its
 * path, with its site icon, copy and open-in-a-new-tab (owner rule: every URL on
 * screen gets both). Pages need no chip of their own, which keeps the column narrow.
 */
export function SubjectCell({ subject }: { subject: HistorySubject | undefined }): JSX.Element {
  if (subject === undefined) return <span className="faint">Removed page</span>
  const topic = subject.kind === 'topic' || subject.url === null
  // A page with no label or title is named by its URL; the path alone says it.
  const named = topic || subject.label !== subject.url
  return (
    <span className="hp-subject">
      {topic ? (
        <Chip size="sm" tone="info">
          Topic
        </Chip>
      ) : null}
      {named ? (
        <span className="hp-subject-name" title={subject.label}>
          {subject.label}
        </span>
      ) : null}
      {subject.url !== null && !topic ? (
        <UrlText className="hp-subject-path" url={subject.url} label={pathOf(subject.url)} />
      ) : null}
    </span>
  )
}
